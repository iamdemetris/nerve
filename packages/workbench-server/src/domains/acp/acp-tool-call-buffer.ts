import type { ToolCallTranscriptRecord } from "@nervekit/contracts";

/** Coalesces sparse ACP tool patches while keeping every tool independently live. */
export class AcpToolCallBuffer {
  readonly #pending = new Map<string, ToolCallTranscriptRecord>();
  #timer?: ReturnType<typeof setTimeout>;
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    private readonly write: (
      records: readonly ToolCallTranscriptRecord[],
    ) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 100,
  ) {}

  push(record: ToolCallTranscriptRecord): void {
    if (this.#closed) return;
    this.#pending.set(record.id, record);
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#enqueuePending();
    }, this.delayMs);
    this.#timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    do {
      this.#enqueuePending();
      await this.#tail;
    } while (this.#pending.size > 0);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.flush();
  }

  #enqueuePending(): void {
    if (this.#pending.size === 0) return;
    const records = [...this.#pending.values()];
    this.#pending.clear();
    this.#tail = this.#tail
      .then(() => this.write(records))
      .catch((error: unknown) => this.onError(error));
  }
}
