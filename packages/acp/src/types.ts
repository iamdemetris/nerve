/**
 * Agent Client Protocol (ACP) wire types.
 *
 * ACP lets a client (Nerve) drive an external coding agent that owns its own
 * tool loop. Transport is line-delimited JSON-RPC 2.0 over the agent's stdio.
 *
 * Only the subset Nerve consumes is modelled here. Unknown fields survive round
 * trips because every payload keeps an index signature.
 */

export const ACP_PROTOCOL_VERSION = 1;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

/** Client capabilities advertised during {@link AcpMethod.Initialize}. */
export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
  [key: string]: unknown;
}

export interface AcpAuthMethod {
  id: string;
  name?: string;
  description?: string;
}

export interface AcpAgentInfo {
  name?: string;
  version?: string;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  /** Reported by some agents (OpenCode) and omitted by others (Cursor). */
  agentInfo?: AcpAgentInfo;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: Record<string, boolean>;
    mcpCapabilities?: Record<string, boolean>;
    sessionCapabilities?: Record<string, unknown>;
    [key: string]: unknown;
  };
  authMethods?: AcpAuthMethod[];
  [key: string]: unknown;
}

export interface AcpMode {
  id: string;
  name?: string;
  description?: string;
}

export interface AcpModes {
  currentModeId?: string;
  availableModes?: AcpMode[];
}

export interface AcpModel {
  modelId: string;
  name?: string;
  description?: string;
}

export interface AcpModels {
  currentModelId?: string;
  availableModels?: AcpModel[];
}

/**
 * A single agent-side setting. Cursor exposes `mode` and `model`; other agents
 * may expose more, so the shape stays open.
 */
export interface AcpConfigOption {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: string | boolean | number | null;
  options?: {
    value: string;
    name?: string;
    description?: string;
  }[];
  [key: string]: unknown;
}

export interface AcpNewSessionResult {
  sessionId: string;
  modes?: AcpModes;
  models?: AcpModels;
  configOptions?: AcpConfigOption[];
  [key: string]: unknown;
}

export interface AcpContentBlock {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  [key: string]: unknown;
}

export type AcpToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export interface AcpToolCallLocation {
  path: string;
  line?: number;
}

/**
 * Tool activity reported by the agent. `tool_call` introduces a call and
 * `tool_call_update` patches it, so every field except the id is optional.
 */
export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: AcpToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: { type: string; [key: string]: unknown }[];
  locations?: AcpToolCallLocation[];
  [key: string]: unknown;
}

export type AcpSessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: AcpContentBlock }
  | ({ sessionUpdate: "tool_call" } & AcpToolCall)
  | ({ sessionUpdate: "tool_call_update" } & AcpToolCall)
  | { sessionUpdate: "plan"; entries?: unknown[] }
  | { sessionUpdate: "session_info_update"; title?: string }
  | {
      sessionUpdate: "available_commands_update";
      availableCommands?: unknown[];
    }
  | { sessionUpdate: "current_mode_update"; currentModeId?: string }
  | { sessionUpdate: string; [key: string]: unknown };

export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
  | string;

export interface AcpPromptResult {
  stopReason: AcpStopReason;
  [key: string]: unknown;
}

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | string;

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind?: AcpPermissionOptionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: AcpToolCall;
  options: AcpPermissionOption[];
  [key: string]: unknown;
}

export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

/** Method names used on the wire, kept in one place to avoid typos. */
export const AcpMethod = {
  Initialize: "initialize",
  Authenticate: "authenticate",
  SessionNew: "session/new",
  SessionLoad: "session/load",
  SessionPrompt: "session/prompt",
  SessionCancel: "session/cancel",
  SessionSetMode: "session/set_mode",
  SessionSetModel: "session/set_model",
  SessionSetConfigOption: "session/set_config_option",
  SessionUpdate: "session/update",
  SessionRequestPermission: "session/request_permission",
  FsReadTextFile: "fs/read_text_file",
  FsWriteTextFile: "fs/write_text_file",
} as const;
