import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  eventEnvelopeSchema,
  type EventEnvelope,
  type StreamState,
} from "@nervekit/contracts";
import {
  atomicWriteFile,
  readJsonLines,
  type RenameDependencies,
} from "../storage/index.js";

export interface StreamFlushObservation {
  readonly stream: string;
  readonly eventCount: number;
  readonly durationMs: number;
  readonly succeeded: boolean;
}

export interface StreamLogOptions {
  readonly stream: string;
  readonly logPath: string;
  readonly metaPath: string;
  readonly retentionEvents?: number;
  readonly retentionBytes?: number;
  readonly flushDelayMs?: number;
  readonly flushEventThreshold?: number;
  readonly onFsync?: () => void;
  readonly onFlushCompleted?: (observation: StreamFlushObservation) => void;
  readonly renameDependencies?: RenameDependencies;
}

export class StreamLog {
  readonly stream: string;
  readonly logPath: string;
  readonly metaPath: string;

  readonly #retentionEvents: number;
  readonly #retentionBytes: number;
  readonly #flushDelayMs: number;
  readonly #flushEventThreshold: number;
  readonly #onFsync?: () => void;
  readonly #onFlushCompleted?: (observation: StreamFlushObservation) => void;
  readonly #renameDependencies?: RenameDependencies;
  readonly #events: EventEnvelope[] = [];
  readonly #eventsById = new Map<string, EventEnvelope>();
  readonly #pending: EventEnvelope[] = [];
  #eventBytesById = new Map<string, number>();

  #lastSeq = 0;
  #eventBytesTotal = 0;
  #flushTimer?: ReturnType<typeof setTimeout>;
  #flushTail: Promise<void> = Promise.resolve();
  #unsynced = false;
  #closed = false;

  private constructor(options: StreamLogOptions) {
    this.stream = options.stream;
    this.logPath = options.logPath;
    this.metaPath = options.metaPath;
    this.#retentionEvents = options.retentionEvents ?? 5_000;
    this.#retentionBytes = options.retentionBytes ?? 8 * 1_024 * 1_024;
    this.#flushDelayMs = options.flushDelayMs ?? 200;
    this.#flushEventThreshold = options.flushEventThreshold ?? 256;
    this.#onFsync = options.onFsync;
    this.#onFlushCompleted = options.onFlushCompleted;
    this.#renameDependencies = options.renameDependencies;
  }

  static async open(options: StreamLogOptions): Promise<StreamLog> {
    const log = new StreamLog(options);
    await log.#hydrate();
    return log;
  }

  async append(
    intentId: string,
    type: string,
    data: unknown,
    supersedable: boolean,
    occurredAt = new Date().toISOString(),
  ): Promise<EventEnvelope> {
    const existing = this.#eventsById.get(intentId);
    if (existing) {
      if (
        existing.type !== type ||
        JSON.stringify(existing.data) !== JSON.stringify(data)
      )
        throw new Error(`Conflicting event intent id: ${intentId}`);
      return existing;
    }
    if (this.#closed) throw new Error(`Stream log ${this.stream} is closed`);
    const event = eventEnvelopeSchema.parse({
      seq: this.#lastSeq + 1,
      id: intentId,
      ts: occurredAt,
      type,
      data,
    }) as EventEnvelope;
    this.#lastSeq = event.seq;
    this.#events.push(event);
    this.#eventsById.set(event.id, event);
    const eventBytes = serializedEventBytes(event);
    this.#eventBytesById.set(event.id, eventBytes);
    this.#eventBytesTotal += eventBytes;
    this.#pending.push(event);

    if (!supersedable) {
      await this.flush();
    } else if (this.#pending.length >= this.#flushEventThreshold) {
      this.#flushInBackground();
    } else {
      this.#scheduleFlush();
    }
    return event;
  }

  eventForIntent(intentId: string): EventEnvelope | undefined {
    return this.#eventsById.get(intentId);
  }

  read(fromSeq: number, limit: number): EventEnvelope[] {
    if (limit <= 0) return [];
    const start = lowerBoundBySeq(this.#events, fromSeq);
    return this.#events.slice(start, start + limit);
  }

  bounds(): StreamState {
    return {
      stream: this.stream,
      latestSeq: this.#lastSeq,
      earliestAvailableSeq:
        this.#events[0]?.seq ?? (this.#lastSeq === 0 ? 1 : this.#lastSeq + 1),
    };
  }

  async flush(durable = true): Promise<void> {
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    const pending = this.#pending.splice(0);
    const writtenThroughSeq = pending.at(-1)?.seq;
    const flush = this.#flushTail
      .catch(() => undefined)
      .then(async () => {
        if (pending.length === 0 && !(durable && this.#unsynced)) return;
        const startedAt = performance.now();
        let succeeded = false;
        try {
          await mkdir(dirname(this.logPath), { recursive: true });
          const handle = await open(this.logPath, "a", 0o600);
          try {
            if (pending.length > 0) {
              await handle.write(
                pending.map((event) => `${JSON.stringify(event)}\n`).join(""),
                undefined,
                "utf8",
              );
              this.#unsynced = true;
            }
            if (durable) {
              await handle.sync();
              this.#onFsync?.();
              this.#unsynced = false;
            }
          } finally {
            await handle.close();
          }
          if (
            writtenThroughSeq !== undefined &&
            (await this.#applyRetention(writtenThroughSeq))
          ) {
            this.#unsynced = false;
          }
          succeeded = true;
        } finally {
          safelyObserveFlush(this.#onFlushCompleted, {
            stream: this.stream,
            eventCount: pending.length,
            durationMs: performance.now() - startedAt,
            succeeded,
          });
        }
      });
    this.#flushTail = flush;
    await flush;
  }

  async truncateBelow(seq: number): Promise<void> {
    await this.flush();
    const retained = this.#events.filter((event) => event.seq >= seq);
    this.#replaceEvents(retained);
    if (retained.length === 0 && this.#lastSeq > 0) {
      await writeMeta(
        this.metaPath,
        this.#lastSeq,
        this.#onFsync,
        this.#renameDependencies,
      );
    }
    await rewriteLog(
      this.logPath,
      retained,
      this.#onFsync,
      this.#renameDependencies,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    await this.flush();
  }

  async remove(): Promise<void> {
    await this.close();
    await Promise.all([
      rm(this.logPath, { force: true }),
      rm(this.metaPath, { force: true }),
    ]);
  }

  async #hydrate(): Promise<void> {
    const parsed = (await readJsonLines<unknown>(this.logPath).catch(() => []))
      .map((value) => eventEnvelopeSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data as EventEnvelope)
      .sort((left, right) => left.seq - right.seq);
    this.#replaceEvents(parsed);
    const meta = await readMeta(this.metaPath);
    this.#lastSeq = Math.max(meta, parsed.at(-1)?.seq ?? 0);
    await this.#applyRetention(this.#lastSeq);
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.#flushInBackground();
    }, this.#flushDelayMs);
    this.#flushTimer.unref?.();
  }

  #flushInBackground(): void {
    void this.flush(false).catch((error: unknown) => {
      process.emitWarning(
        `Failed to flush stream ${this.stream}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async #applyRetention(writtenThroughSeq: number): Promise<boolean> {
    const durableEnd = upperBoundBySeq(this.#events, writtenThroughSeq);
    const durableEvents = this.#events.slice(0, durableEnd);
    let bytes = this.#eventBytesTotal;
    for (let index = durableEnd; index < this.#events.length; index += 1) {
      bytes -= this.#eventBytesById.get(this.#events[index]!.id) ?? 0;
    }
    if (
      durableEvents.length <= this.#retentionEvents &&
      bytes <= this.#retentionBytes
    )
      return false;
    const retainedEventTarget =
      this.#retentionEvents <= 10
        ? this.#retentionEvents
        : Math.floor(this.#retentionEvents * 0.8);
    const retainedByteTarget =
      this.#retentionBytes <= 1_024
        ? this.#retentionBytes
        : Math.floor(this.#retentionBytes * 0.8);
    let removeCount = 0;
    while (
      durableEvents.length - removeCount > 1 &&
      (durableEvents.length - removeCount > retainedEventTarget ||
        bytes > retainedByteTarget)
    ) {
      const event = durableEvents[removeCount] as EventEnvelope;
      bytes -=
        this.#eventBytesById.get(event.id) ?? serializedEventBytes(event);
      removeCount += 1;
    }
    if (removeCount === 0) return false;

    const retainedDurableEvents = durableEvents.slice(removeCount);
    const firstRetainedSeq = retainedDurableEvents[0]?.seq;
    if (firstRetainedSeq === undefined) return false;
    const retainedEvents = this.#events.filter(
      (event) => event.seq >= firstRetainedSeq,
    );
    this.#replaceEvents(retainedEvents);
    await rewriteLog(
      this.logPath,
      retainedDurableEvents,
      this.#onFsync,
      this.#renameDependencies,
    );
    return true;
  }

  #replaceEvents(events: readonly EventEnvelope[]): void {
    const previousBytes = this.#eventBytesById;
    const nextBytes = new Map<string, number>();
    let totalBytes = 0;
    this.#events.splice(0, this.#events.length, ...events);
    this.#eventsById.clear();
    for (const event of events) {
      this.#eventsById.set(event.id, event);
      const bytes = previousBytes.get(event.id) ?? serializedEventBytes(event);
      nextBytes.set(event.id, bytes);
      totalBytes += bytes;
    }
    this.#eventBytesById = nextBytes;
    this.#eventBytesTotal = totalBytes;
  }
}

function lowerBoundBySeq(
  events: readonly EventEnvelope[],
  seq: number,
): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const event = events[middle];
    if (event && event.seq < seq) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundBySeq(
  events: readonly EventEnvelope[],
  seq: number,
): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const event = events[middle];
    if (event && event.seq <= seq) low = middle + 1;
    else high = middle;
  }
  return low;
}

function serializedEventBytes(event: EventEnvelope): number {
  return Buffer.byteLength(`${JSON.stringify(event)}\n`);
}

function safelyObserveFlush(
  observer: ((observation: StreamFlushObservation) => void) | undefined,
  observation: StreamFlushObservation,
): void {
  try {
    observer?.(observation);
  } catch {
    // Diagnostics must never affect event durability.
  }
}

async function readMeta(path: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      lastSeq?: unknown;
    };
    return typeof value.lastSeq === "number" &&
      Number.isSafeInteger(value.lastSeq)
      ? Math.max(0, value.lastSeq)
      : 0;
  } catch {
    return 0;
  }
}

async function writeMeta(
  path: string,
  lastSeq: number,
  onFsync?: () => void,
  renameDependencies?: RenameDependencies,
): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify({ lastSeq })}\n`, {
    mode: 0o600,
    onFsync,
    ...renameDependencies,
  });
}

async function rewriteLog(
  path: string,
  events: readonly EventEnvelope[],
  onFsync?: () => void,
  renameDependencies?: RenameDependencies,
): Promise<void> {
  const contents = events.map((event) => JSON.stringify(event)).join("\n");
  await atomicWriteFile(path, contents ? `${contents}\n` : "", {
    mode: 0o600,
    onFsync,
    ...renameDependencies,
  });
}
