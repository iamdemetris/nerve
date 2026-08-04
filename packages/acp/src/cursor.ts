/**
 * Cursor-specific behaviour layered on top of the generic ACP agent handling.
 *
 * Everything here exists because Cursor encodes model variants inside the model
 * id rather than exposing them as separate config options.
 */

/** Cursor session modes, ordered from most to least capable. */
export const CURSOR_MODE_AGENT = "agent";
export const CURSOR_MODE_PLAN = "plan";
export const CURSOR_MODE_ASK = "ask";

export interface CursorModelId {
  /** Model id without its bracketed parameters, e.g. `claude-opus-5`. */
  baseId: string;
  /** Bracketed parameters, e.g. `{ thinking: "true", effort: "high" }`. */
  parameters: Record<string, string>;
}

/**
 * Splits Cursor's parameterized model ids.
 *
 * Cursor encodes variant selection inside the id itself, for example
 * `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]`. Parsing it
 * lets the UI offer one entry per model with its options broken out, rather than
 * a flat list of near-duplicate strings.
 */
export function parseCursorModelId(modelId: string): CursorModelId {
  const open = modelId.indexOf("[");
  if (open < 0 || !modelId.endsWith("]")) {
    return { baseId: modelId, parameters: {} };
  }
  const baseId = modelId.slice(0, open);
  const body = modelId.slice(open + 1, -1);
  const parameters: Record<string, string> = {};
  for (const segment of body.split(",")) {
    const entry = segment.trim();
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) {
      parameters[entry] = "true";
      continue;
    }
    parameters[entry.slice(0, separator).trim()] = entry
      .slice(separator + 1)
      .trim();
  }
  return { baseId, parameters };
}

export function formatCursorModelId(model: CursorModelId): string {
  const entries = Object.entries(model.parameters);
  if (entries.length === 0) return model.baseId;
  const body = entries.map(([key, value]) => `${key}=${value}`).join(",");
  return `${model.baseId}[${body}]`;
}

/** Strips parameters, leaving the base model id. */
export function resolveCursorBaseModelId(
  modelId: string | null | undefined,
): string {
  if (!modelId) return "";
  return parseCursorModelId(modelId).baseId;
}

/** Applies parameter overrides to a model id, preserving unlisted parameters. */
export function withCursorModelParameters(
  modelId: string,
  overrides: Record<string, string | undefined>,
): string {
  const parsed = parseCursorModelId(modelId);
  const parameters = { ...parsed.parameters };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete parameters[key];
    else parameters[key] = value;
  }
  return formatCursorModelId({ baseId: parsed.baseId, parameters });
}

/**
 * Cursor's ACP server exposes no per-tool approval switch, so the session mode
 * is the only gate: `plan` is read-only and `ask` blocks edits and commands.
 */
export function cursorModeAllowsEdits(modeId: string | undefined): boolean {
  return modeId === CURSOR_MODE_AGENT;
}
