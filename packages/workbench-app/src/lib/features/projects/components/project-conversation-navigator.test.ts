import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectRecord } from "$lib/api";
import type { ProjectGroup } from "$lib/core/utils/project-tree";
import { idleConversationActivity } from "$lib/features/conversations/state/conversation-activity";
import type { PendingConversationTabModel } from "$lib/features/workspace/state/center-tab-models";
import { buildProjectConversationNodes } from "./project-conversation-navigator";

function project(id: string, dir: string): ProjectRecord {
  return {
    id,
    name: id,
    dir,
    createdAt: "2026-08-04T00:00:00.000Z",
  } as ProjectRecord;
}

function group(record: ProjectRecord): ProjectGroup {
  return {
    key: record.dir,
    project: record,
    projects: [record],
    rows: [],
    hiddenRows: 0,
    totalRows: 0,
    label: record.name,
    sortAt: record.createdAt,
  };
}

function pending(
  id: string,
  record: ProjectRecord,
  active = false,
): PendingConversationTabModel {
  return {
    kind: "pending-conversation",
    id,
    title: "New Conversation",
    project: record,
    projectDir: record.dir,
    active,
    hasDraft: false,
    sending: false,
    activity: idleConversationActivity,
  };
}

test("shows every pending conversation under its project instead of the empty state", () => {
  const lude = project("lude", "/projects/LudeHQ");
  const other = project("other", "/projects/Other");
  const [ludeNode, otherNode] = buildProjectConversationNodes(
    [group(lude), group(other)],
    [pending("pending_1", lude), pending("pending_2", lude, true)],
  );

  assert.deepEqual(
    ludeNode?.children?.map((node) => ({
      id: node.id,
      kind: node.kind === "item" ? node.value.kind : node.kind,
      active:
        node.kind === "item" && node.value.kind === "pending-conversation"
          ? node.value.tab.active
          : false,
    })),
    [
      {
        id: "pending-conversation:pending_1",
        kind: "pending-conversation",
        active: false,
      },
      {
        id: "pending-conversation:pending_2",
        kind: "pending-conversation",
        active: true,
      },
    ],
  );
  assert.equal(otherNode?.children?.[0]?.id, "empty:/projects/Other");
});
