import type {
  ConversationRow,
  ProjectGroup,
} from "$lib/core/utils/project-tree";
import type { PendingConversationTabModel } from "$lib/features/workspace/state/center-tab-models";
import type { PanelTreeNode } from "$lib/presentation/panel";

export type ProjectConversationNavigatorItem =
  | { kind: "project"; group: ProjectGroup }
  | { kind: "conversation"; group: ProjectGroup; row: ConversationRow }
  | {
      kind: "pending-conversation";
      group: ProjectGroup;
      tab: PendingConversationTabModel;
    }
  | { kind: "empty"; group: ProjectGroup };

export function buildProjectConversationNodes(
  groups: ProjectGroup[],
  pendingConversationTabs: PendingConversationTabModel[] = [],
): PanelTreeNode<ProjectConversationNavigatorItem>[] {
  const groupKeyByProjectId = new Map(
    groups.flatMap((group) =>
      group.projects.map((project) => [project.id, group.key] as const),
    ),
  );
  const groupKeys = new Set(groups.map((group) => group.key));
  const pendingByGroupKey = new Map<string, PendingConversationTabModel[]>();
  for (const tab of pendingConversationTabs) {
    const projectKey = tab.project
      ? groupKeyByProjectId.get(tab.project.id)
      : undefined;
    const directoryKey =
      tab.projectDir.replace(/[\\/]+$/, "") || tab.projectDir;
    const groupKey =
      projectKey ?? (groupKeys.has(directoryKey) ? directoryKey : undefined);
    if (!groupKey) continue;
    const pending = pendingByGroupKey.get(groupKey) ?? [];
    pending.push(tab);
    pendingByGroupKey.set(groupKey, pending);
  }

  return groups.map((group) => ({
    kind: "item",
    id: `project:${group.key}`,
    label: group.label,
    path: [group.label],
    value: { kind: "project", group },
    children: (() => {
      const children: PanelTreeNode<ProjectConversationNavigatorItem>[] = [
        ...(pendingByGroupKey.get(group.key) ?? []).map((tab) => ({
          kind: "item" as const,
          id: `pending-conversation:${tab.id}`,
          label: tab.title,
          path: [group.label, tab.title],
          value: {
            kind: "pending-conversation" as const,
            group,
            tab,
          },
          children: [],
        })),
        ...group.rows.map((row) => ({
          kind: "item" as const,
          id: `conversation:${row.conversation.id}`,
          label: row.conversation.title,
          path: [group.label, row.conversation.title],
          value: {
            kind: "conversation" as const,
            group,
            row,
          },
          children: [],
        })),
      ];
      return children.length > 0
        ? children
        : [
            {
              kind: "item" as const,
              id: `empty:${group.key}`,
              label: "No threads yet",
              path: [group.label, "No threads yet"],
              value: { kind: "empty" as const, group },
              children: [],
            },
          ];
    })(),
  }));
}
