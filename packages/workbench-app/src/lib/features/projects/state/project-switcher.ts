import type { StatusTone } from "@nervekit/ui-kit/core/utils/status";
import type { ConversationRecord } from "$lib/api";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";

export type ProjectActivitySummary = {
  needsUser: number;
  running: number;
};

export function summarizeProjectActivity(
  conversations: ConversationRecord[],
  activityById: Record<string, ConversationActivityState>,
): ProjectActivitySummary {
  const summary: ProjectActivitySummary = {
    needsUser: 0,
    running: 0,
  };
  for (const conversation of conversations) {
    const activity = activityById[conversation.id];
    if (!activity) continue;
    if (activity.needsUser) summary.needsUser += 1;
    else if (activity.busy && activity.tone !== "danger") summary.running += 1;
  }
  return summary;
}

export type ProjectActivityIndicator = {
  tone: StatusTone;
  pulse: boolean;
  /** Human-readable breakdown of current actionable activity. */
  summary: string;
};

export function projectActivityIndicator(
  activity: ProjectActivitySummary,
): ProjectActivityIndicator | undefined {
  const parts = [
    activity.needsUser ? `${activity.needsUser} waiting for you` : "",
    activity.running ? `${activity.running} running` : "",
  ].filter(Boolean);
  if (!parts.length) return undefined;
  const tone: StatusTone = activity.needsUser ? "warn" : "running";
  return { tone, pulse: tone === "running", summary: parts.join(", ") };
}
