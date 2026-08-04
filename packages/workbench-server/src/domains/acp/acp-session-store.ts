import { join } from "node:path";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

/**
 * Remembers which external agent session backs each Nerve conversation.
 *
 * ACP agents keep conversation state on their side, keyed by a session id.
 * Persisting that id is what lets a second message in the same conversation
 * continue the thread instead of starting the agent from a blank slate.
 */
export class AcpSessionStore {
  readonly #path: string;
  readonly #sessions = new Map<string, string>();
  #loading?: Promise<void>;
  #persisting?: Promise<void>;
  #dirty = false;

  constructor(home: string) {
    this.#path = join(home, "acp-sessions.json");
  }

  async get(conversationId: string): Promise<string | undefined> {
    await this.#load();
    return this.#sessions.get(conversationId);
  }

  async set(conversationId: string, sessionId: string): Promise<void> {
    await this.#load();
    if (this.#sessions.get(conversationId) === sessionId) return;
    this.#sessions.set(conversationId, sessionId);
    this.#dirty = true;
    await this.#persist();
  }

  async #load(): Promise<void> {
    this.#loading ??= (async () => {
      const raw = await readJsonFile<Record<string, string>>(this.#path).catch(
        () => undefined,
      );
      for (const [key, value] of Object.entries(raw ?? {})) {
        if (typeof value === "string") this.#sessions.set(key, value);
      }
    })();
    await this.#loading;
  }

  async #persist(): Promise<void> {
    while (this.#dirty) {
      this.#persisting ??= Promise.resolve()
        .then(async () => {
          while (this.#dirty) {
            this.#dirty = false;
            await atomicWriteJson(
              this.#path,
              Object.fromEntries(this.#sessions),
              0o600,
            ).catch(() => undefined);
          }
        })
        .finally(() => {
          this.#persisting = undefined;
        });
      await this.#persisting;
    }
  }
}
