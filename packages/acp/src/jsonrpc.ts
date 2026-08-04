import {
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./types.js";

/** JSON-RPC error codes this client produces or recognises. */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export class AcpRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: JsonRpcError, context?: string) {
    super(context ? `${context}: ${error.message}` : error.message);
    this.name = "AcpRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class AcpClosedError extends Error {
  constructor(reason?: string) {
    super(
      reason ? `ACP connection closed: ${reason}` : "ACP connection closed",
    );
    this.name = "AcpClosedError";
  }
}

export type IncomingRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown>;

export type NotificationHandler = (method: string, params: unknown) => void;

export interface JsonRpcConnectionOptions {
  /** Writes one already-encoded line (newline included) to the peer. */
  write: (line: string) => void;
  /** Handles requests the agent sends to us, such as permission prompts. */
  onRequest?: IncomingRequestHandler;
  onNotification?: NotificationHandler;
  /** Surface for malformed lines, which agents sometimes interleave on stdout. */
  onDecodeError?: (line: string, error: unknown) => void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

/**
 * Line-delimited JSON-RPC 2.0 framing.
 *
 * ACP over stdio separates messages with newlines rather than using
 * Content-Length headers, and agents may emit unrelated diagnostic lines on the
 * same stream, so undecodable lines are reported and skipped instead of
 * poisoning the connection.
 */
export class JsonRpcConnection {
  #buffer = "";
  #nextId = 1;
  #pending = new Map<number | string, PendingCall>();
  #closed: Error | undefined;
  readonly #options: JsonRpcConnectionOptions;

  constructor(options: JsonRpcConnectionOptions) {
    this.#options = options;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Feeds raw bytes from the peer, dispatching every complete line. */
  receive(chunk: string): void {
    this.#buffer += chunk;
    let newlineIndex = this.#buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line) this.#dispatch(line);
      newlineIndex = this.#buffer.indexOf("\n");
    }
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      });
      try {
        this.#options.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.#closed) throw this.#closed;
    const payload: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.#options.write(`${JSON.stringify(payload)}\n`);
  }

  /** Rejects every in-flight call. Safe to call more than once. */
  close(reason?: string): void {
    if (this.#closed) return;
    this.#closed = new AcpClosedError(reason);
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const call of pending) {
      call.reject(
        new AcpClosedError(`${reason ?? "peer closed"} (${call.method})`),
      );
    }
  }

  #dispatch(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.#options.onDecodeError?.(line, error);
      return;
    }

    if (typeof message !== "object" || message === null) {
      this.#options.onDecodeError?.(line, new Error("not a JSON-RPC object"));
      return;
    }

    const hasId =
      "id" in message && message.id !== undefined && message.id !== null;
    const hasMethod = "method" in message && typeof message.method === "string";

    if (hasMethod && hasId) {
      void this.#handleRequest(message as JsonRpcRequest);
      return;
    }
    if (hasMethod) {
      const notification = message as JsonRpcNotification;
      this.#options.onNotification?.(notification.method, notification.params);
      return;
    }
    if (hasId) {
      this.#handleResponse(message as JsonRpcResponse);
      return;
    }
    this.#options.onDecodeError?.(
      line,
      new Error("message has neither id nor method"),
    );
  }

  #handleResponse(response: JsonRpcResponse): void {
    const call = this.#pending.get(response.id);
    if (!call) return;
    this.#pending.delete(response.id);
    if (response.error) {
      call.reject(new AcpRpcError(response.error, call.method));
      return;
    }
    call.resolve(response.result);
  }

  async #handleRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.#options.onRequest;
    if (!handler) {
      this.#respond(request.id, undefined, {
        code: JsonRpcErrorCode.MethodNotFound,
        message: `unhandled method: ${request.method}`,
      });
      return;
    }
    try {
      const result = await handler(request.method, request.params);
      this.#respond(request.id, result ?? null);
    } catch (error) {
      this.#respond(request.id, undefined, {
        code: JsonRpcErrorCode.InternalError,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #respond(id: number | string, result?: unknown, error?: JsonRpcError): void {
    if (this.#closed) return;
    const payload: JsonRpcResponse = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };
    this.#options.write(`${JSON.stringify(payload)}\n`);
  }
}
