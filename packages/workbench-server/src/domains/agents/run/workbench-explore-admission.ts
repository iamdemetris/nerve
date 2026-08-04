import {
  EXPLORE_MAX_ACTIVE_CHILDREN_GLOBAL,
  EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN,
  EXPLORE_MAX_CHILDREN_PER_RUN,
} from "@nervekit/contracts";

export interface ExploreAdmissionBatch {
  acquire(signal?: AbortSignal, onQueued?: () => void): Promise<() => void>;
  finish(): void;
}

type Waiter = {
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
};

type AdmissionState = {
  active: number;
  used: number;
  batches: number;
  local: boolean;
  queue: Waiter[];
};

export class ExploreRunLimitError extends Error {
  constructor(
    readonly requested: number,
    readonly used: number,
    readonly remaining: number,
  ) {
    super(exploreRunLimitMessage(requested, used, remaining));
    this.name = "ExploreRunLimitError";
  }
}

/** Runtime-only Explore limits keyed by the owning parent run. */
export class WorkbenchExploreAdmission {
  private readonly states = new Map<string, AdmissionState>();
  private readonly queuedKeys: string[] = [];
  private globalActive = 0;
  private nextLocalId = 0;

  reserveBatch(
    parentRunId: string | undefined,
    taskCount: number,
  ): ExploreAdmissionBatch {
    const key =
      parentRunId ?? `local-explore-${this.nextLocalId++}-${Date.now()}`;
    const state = this.states.get(key) ?? {
      active: 0,
      used: 0,
      batches: 0,
      local: parentRunId === undefined,
      queue: [],
    };
    const remaining = EXPLORE_MAX_CHILDREN_PER_RUN - state.used;
    if (taskCount > remaining) {
      throw new ExploreRunLimitError(taskCount, state.used, remaining);
    }
    state.used += taskCount;
    state.batches += 1;
    this.states.set(key, state);

    let finished = false;
    return {
      acquire: (signal, onQueued) => this.acquire(key, state, signal, onQueued),
      finish: () => {
        if (finished) return;
        finished = true;
        state.batches -= 1;
        this.deleteLocalStateIfIdle(key, state);
      },
    };
  }

  clearRun(parentRunId: string): void {
    const state = this.states.get(parentRunId);
    if (!state) return;
    this.states.delete(parentRunId);
    this.removeQueuedKey(parentRunId);
    for (const waiter of state.queue.splice(0)) {
      this.detachAbort(waiter);
      waiter.reject(abortError());
    }
  }

  private acquire(
    key: string,
    state: AdmissionState,
    signal?: AbortSignal,
    onQueued?: () => void,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (
      this.states.get(key) === state &&
      this.globalActive < EXPLORE_MAX_ACTIVE_CHILDREN_GLOBAL &&
      state.active < EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN &&
      state.queue.length === 0 &&
      this.queuedKeys.length === 0
    ) {
      state.active += 1;
      this.globalActive += 1;
      return Promise.resolve(this.releaseHandle(key, state));
    }

    onQueued?.();
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = state.queue.indexOf(waiter);
          if (index >= 0) state.queue.splice(index, 1);
          if (state.queue.length === 0) this.removeQueuedKey(key);
          this.detachAbort(waiter);
          reject(abortError());
          this.drain();
          this.deleteLocalStateIfIdle(key, state);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      state.queue.push(waiter);
      if (state.queue.length === 1) this.queuedKeys.push(key);
      this.drain();
    });
  }

  private releaseHandle(key: string, state: AdmissionState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      this.globalActive = Math.max(0, this.globalActive - 1);
      this.drain();
      this.deleteLocalStateIfIdle(key, state);
    };
  }

  private drain(): void {
    let checkedWithoutAdmission = 0;
    while (
      this.globalActive < EXPLORE_MAX_ACTIVE_CHILDREN_GLOBAL &&
      this.queuedKeys.length > 0 &&
      checkedWithoutAdmission < this.queuedKeys.length
    ) {
      const key = this.queuedKeys.shift()!;
      const state = this.states.get(key);
      if (!state || state.queue.length === 0) {
        checkedWithoutAdmission = 0;
        continue;
      }
      if (state.active >= EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN) {
        this.queuedKeys.push(key);
        checkedWithoutAdmission += 1;
        continue;
      }
      const waiter = state.queue.shift()!;
      if (state.queue.length > 0) this.queuedKeys.push(key);
      this.detachAbort(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        checkedWithoutAdmission = 0;
        continue;
      }
      state.active += 1;
      this.globalActive += 1;
      waiter.resolve(this.releaseHandle(key, state));
      checkedWithoutAdmission = 0;
    }
  }

  private removeQueuedKey(key: string): void {
    let index = this.queuedKeys.indexOf(key);
    while (index >= 0) {
      this.queuedKeys.splice(index, 1);
      index = this.queuedKeys.indexOf(key);
    }
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  private deleteLocalStateIfIdle(key: string, state: AdmissionState): void {
    if (
      state.local &&
      state.active === 0 &&
      state.queue.length === 0 &&
      state.batches === 0
    ) {
      this.states.delete(key);
      this.removeQueuedKey(key);
    }
  }
}

function exploreRunLimitMessage(
  requested: number,
  used: number,
  remaining: number,
): string {
  const base = `Explore run limit reached: requested ${requested} child agents, but only ${remaining} of ${EXPLORE_MAX_CHILDREN_PER_RUN} launches remain (${used} used). No children were started for this call.`;
  return remaining > 0
    ? `${base} Retry with at most ${remaining} tasks, or continue directly with read/grep/find/ls.`
    : `${base} Explore is unavailable for the remainder of this parent run; continue directly with read/grep/find/ls. The allowance resets on the next parent run.`;
}

function abortError(): Error {
  const error = new Error("Agent run aborted.");
  error.name = "AbortError";
  return error;
}
