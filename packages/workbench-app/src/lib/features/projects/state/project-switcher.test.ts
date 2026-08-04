import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRecord } from "$lib/api";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
import {
  projectActivityIndicator,
  summarizeProjectActivity,
} from "./project-switcher";

function conversation(
  id: string,
  projectId: string,
  updatedAt: string,
): ConversationRecord {
  return {
    id,
    projectId,
    title: id,
    updatedAt,
    createdAt: updatedAt,
    lastUserMessageAt: updatedAt,
  } as ConversationRecord;
}

function activity(
  input: Partial<ConversationActivityState>,
): ConversationActivityState {
  return {
    tone: "neutral",
    pulse: false,
    busy: false,
    needsUser: false,
    source: "none",
    ...input,
  };
}

test("summarizes only current actionable project activity", () => {
  const conversations = [
    conversation("error", "p", "2026-01-01"),
    conversation("waiting", "p", "2026-01-02"),
    conversation("running", "p", "2026-01-03"),
  ];
  assert.deepEqual(
    summarizeProjectActivity(conversations, {
      error: activity({ tone: "danger", busy: true }),
      waiting: activity({ tone: "warn", needsUser: true }),
      running: activity({ tone: "running", busy: true }),
    }),
    { needsUser: 1, running: 1 },
  );
});

test("omits project indicators for terminal errors", () => {
  const summary = summarizeProjectActivity(
    [conversation("error", "p", "2026-01-01")],
    { error: activity({ tone: "danger" }) },
  );
  assert.deepEqual(summary, { needsUser: 0, running: 0 });
  assert.equal(projectActivityIndicator(summary), undefined);
});

test("collapses actionable project activity into one indicator", () => {
  assert.equal(
    projectActivityIndicator({ needsUser: 0, running: 0 }),
    undefined,
  );
  assert.deepEqual(projectActivityIndicator({ needsUser: 1, running: 2 }), {
    tone: "warn",
    pulse: false,
    summary: "1 waiting for you, 2 running",
  });
  assert.deepEqual(projectActivityIndicator({ needsUser: 0, running: 1 }), {
    tone: "running",
    pulse: true,
    summary: "1 running",
  });
});
