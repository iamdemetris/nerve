<script lang="ts">
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import Folder from "@lucide/svelte/icons/folder";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import Search from "@lucide/svelte/icons/search";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import type { ProjectRecord } from "$lib/api";
import { getShortcutLabel } from "$lib/core/shortcuts/registry";
import {
  buildProjectGroups,
  groupIsActive,
  shortAgentModel,
  shortProjectLabel,
} from "$lib/core/utils/project-tree";
import { dateTimeLabel } from "$lib/core/utils/time";
import {
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
} from "$lib/presentation/panel";
import { conversationActivityForRecord } from "$lib/features/conversations/state/conversation-activity";
import {
  projectActivityIndicator,
  summarizeProjectActivity,
  type ProjectActivityIndicator,
} from "$lib/features/projects/state/project-switcher";
import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
import {
  buildConversationMenu,
  buildProjectMenu,
  countAgeEligible,
  countKeepEligible,
  countProjectConversations,
  type ProjectTreeMenuContext,
} from "./project-tree-menus";
import type {
  DeleteTarget,
  ProjectAgentTreeProps,
  PruneTarget,
} from "./project-agent-tree-props";
import {
  buildProjectConversationNodes,
  type ProjectConversationNavigatorItem as NavigatorItem,
} from "./project-conversation-navigator";

let {
  projects = [],
  conversations = [],
  agents = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  pendingConversationTabs = [],
  conversationActivityById = {},
  searchFocusToken = 0,
  editorAvailability,
  homeDir,
  onSelectProject,
  onOpenProjectPicker,
  onOpenConversation,
  onOpenPendingConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onDeleteProject,
  onDeleteConversation,
  onPruneProjectConversations,
}: ProjectAgentTreeProps = $props();

let pendingDelete = $state<DeleteTarget | undefined>();
let pendingPrune = $state<PruneTarget | undefined>();
let allConversationsOpen = $state(false);
let projectSort = $state<"activity" | "name">("activity");

const activitySortedGroups = $derived(
  buildProjectGroups({
    projects,
    conversations,
    agents,
    homeDir,
    maxProjects: Number.MAX_SAFE_INTEGER,
    maxRowsPerProject: Number.MAX_SAFE_INTEGER,
  }).groups,
);
const groups = $derived(
  projectSort === "name"
    ? [...activitySortedGroups].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )
    : activitySortedGroups,
);
const activeGroup = $derived(
  groups.find((group) => groupIsActive(group, selectedProjectId)) ?? groups[0],
);
const nodes = $derived.by(() =>
  buildProjectConversationNodes(groups, pendingConversationTabs),
);
const projectIndicators = $derived.by(
  () =>
    new Map<string, ProjectActivityIndicator | undefined>(
      groups.map((group) => {
        const projectIds = new Set(group.projects.map((project) => project.id));
        const projectConversations = conversations.filter((conversation) =>
          projectIds.has(conversation.projectId),
        );
        return [
          group.key,
          projectActivityIndicator(
            summarizeProjectActivity(
              projectConversations,
              conversationActivityById,
            ),
          ),
        ];
      }),
    ),
);

const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const searchShortcut = getShortcutLabel("projectSearch.focus");
const emptyStateHint = switchProjectShortcut
  ? `Open a project to get started (${switchProjectShortcut}).`
  : "Open a project to get started.";

let lastSearchFocusToken = 0;
$effect(() => {
  if (searchFocusToken === lastSearchFocusToken) return;
  lastSearchFocusToken = searchFocusToken;
  if (activeGroup) allConversationsOpen = true;
});

const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir,
  newConversationShortcut,
  editorAvailability,
  conversationCount: (projectId) =>
    countProjectConversations(conversations, projectId),
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  requestPrune: (project: ProjectRecord) => {
    pendingPrune = {
      id: project.id,
      label: shortProjectLabel(project.dir, homeDir),
    };
  },
  requestDelete: (target) => (pendingDelete = target),
});

function conversationActivity(
  item: Extract<NavigatorItem, { kind: "conversation" }>,
) {
  return (
    conversationActivityById[item.row.conversation.id] ??
    conversationActivityForRecord({
      conversationId: item.row.conversation.id,
      agent: item.row.agent,
      mode: item.row.agent?.mode ?? item.row.conversation.mode,
    })
  );
}

function itemTitle(item: NavigatorItem): string {
  if (item.kind === "project") {
    const indicator = projectIndicators.get(item.group.key);
    return [item.group.project.dir, indicator?.summary]
      .filter(Boolean)
      .join(" — ");
  }
  if (item.kind === "empty") return `No conversations in ${item.group.label}`;
  if (item.kind === "pending-conversation") {
    return [item.tab.title, "unsent conversation", item.tab.id].join("\n");
  }
  const { row } = item;
  const activity = conversationActivity(item);
  return [
    row.conversation.title,
    `status: ${activity.label ?? row.agent?.status ?? "idle"}`,
    `model: ${shortAgentModel(row.agent)}`,
    `updated: ${dateTimeLabel(row.conversation.updatedAt)}`,
    row.conversation.id,
  ].join("\n");
}

function itemMenu(item: NavigatorItem) {
  if (item.kind === "project") {
    return buildProjectMenu(item.group.project, menuContext);
  }
  if (item.kind === "empty") return [];
  if (item.kind === "pending-conversation") return [];
  const project =
    projects.find(
      (candidate) => candidate.id === item.row.conversation.projectId,
    ) ?? item.group.project;
  return buildConversationMenu(project, item.row.conversation, menuContext);
}

function activateItem(item: NavigatorItem) {
  if (item.kind === "project") {
    onSelectProject?.(item.group.project.id);
    return;
  }
  if (item.kind === "empty") return;
  if (item.kind === "pending-conversation") {
    onOpenPendingConversation?.(item.tab.id);
    return;
  }
  onOpenConversation?.(item.row.conversation.id);
}

function itemClass(item: NavigatorItem): string {
  if (item.kind === "project") return "mx-1 mt-1 h-9";
  if (item.kind === "empty") return "mx-1 h-8";
  return "mx-1 h-9 rounded-md";
}

function itemLabelClass(item: NavigatorItem): string {
  if (item.kind === "project") {
    return "text-sm font-semibold text-foreground";
  }
  if (item.kind === "empty") return "text-xs text-muted-foreground";
  if (item.kind === "pending-conversation") {
    return item.tab.active
      ? "text-sm font-medium text-foreground"
      : "text-sm text-muted-foreground";
  }
  return item.row.conversation.id === selectedConversationId
    ? "text-sm font-medium text-foreground"
    : "text-sm text-muted-foreground";
}

function confirmDelete() {
  if (pendingDelete?.kind === "project") {
    onDeleteProject?.(pendingDelete.id);
  } else if (pendingDelete?.kind === "conversation") {
    onDeleteConversation?.(pendingDelete.id);
  }
}

function confirmPrune(
  request: Parameters<NonNullable<typeof onPruneProjectConversations>>[1],
) {
  if (pendingPrune) onPruneProjectConversations?.(pendingPrune.id, request);
}
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <PanelView padded={false}>
    {#snippet banner()}
      <div class="flex flex-col gap-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          class="h-9 w-full justify-start gap-2 px-2 text-muted-foreground hover:text-foreground"
          ariaLabel="Search conversations"
          title={searchShortcut
            ? `Search conversations (${searchShortcut})`
            : "Search conversations"}
          onclick={() => {
            if (activeGroup) allConversationsOpen = true;
          }}
        >
          <Search class="size-4" aria-hidden="true" />
          <span class="text-sm font-medium">Search</span>
          {#if searchShortcut}
            <kbd
              class="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >{searchShortcut}</kbd
            >
          {/if}
        </Button>

        <PanelHeader title="Projects" class="px-1">
          {#snippet trailing()}
            <PanelToolbarButton
              icon={ArrowDownUp}
              label={projectSort === "activity"
                ? "Sort projects by name"
                : "Sort projects by recent activity"}
              onclick={() =>
                (projectSort =
                  projectSort === "activity" ? "name" : "activity")}
            />
            <PanelToolbarButton
              icon={FolderPlus}
              label="Open project"
              title={switchProjectShortcut
                ? `Open project (${switchProjectShortcut})`
                : "Open project"}
              disabled={!onOpenProjectPicker}
              onclick={() => onOpenProjectPicker?.()}
            />
          {/snippet}
        </PanelHeader>
      </div>
    {/snippet}

    {#if groups.length === 0}
      <PanelEmpty title="No projects open." description={emptyStateHint}>
        {#snippet action()}
          <Button variant="outline" size="sm" onclick={onOpenProjectPicker}
            >Open project</Button
          >
        {/snippet}
      </PanelEmpty>
    {:else}
      <PanelTree
        {nodes}
        ariaLabel="Projects and conversations"
        class="py-1"
        getItemTitle={itemTitle}
        getItemSelected={(item) =>
          (item.kind === "conversation" &&
            item.row.conversation.id === selectedConversationId) ||
          (item.kind === "pending-conversation" && item.tab.active)}
        getItemDisabled={(item) => item.kind === "empty"}
        getItemMenuItems={itemMenu}
        getItemInitiallyExpanded={(item) => item.kind === "project"}
        getItemClass={itemClass}
        getItemLabelClass={itemLabelClass}
        alwaysShowItemActions={false}
        itemDense={false}
        reserveLeafDisclosureSpace={false}
        onItemActivate={activateItem}
      >
        {#snippet itemLeading(item)}
          {#if item.kind === "project"}
            <Folder
              class={groupIsActive(item.group, selectedProjectId)
                ? "size-4 text-foreground"
                : "size-4"}
              aria-hidden="true"
            />
          {/if}
        {/snippet}
        {#snippet itemBadges(item)}
          {#if item.kind === "project"}
            {@const indicator = projectIndicators.get(item.group.key)}
            {#if indicator}
              <StatusDot
                tone={indicator.tone}
                size="xs"
                pulse={indicator.pulse}
                label={indicator.summary}
              />
            {/if}
          {:else if item.kind === "conversation"}
            {@const activity = conversationActivity(item)}
            {#if activity.source !== "none"}
              <StatusDot
                tone={activity.tone}
                variant={openConversationTabIds?.has(item.row.conversation.id)
                  ? "solid"
                  : "outline"}
                pulse={activity.pulse}
                label={activity.label}
              />
            {/if}
          {:else if item.kind === "pending-conversation"}
            {#if item.tab.activity.source !== "none"}
              <StatusDot
                tone={item.tab.activity.tone}
                variant="solid"
                pulse={item.tab.activity.pulse}
                label={item.tab.activity.label}
              />
            {/if}
          {/if}
        {/snippet}
        {#snippet itemActions(item)}
          {#if item.kind === "project"}
            <PanelToolbarButton
              icon={Plus}
              label={`New chat in ${item.group.label}`}
              dense
              onclick={(event) => {
                event.stopPropagation();
                onNewConversationInProject?.(item.group.project.dir);
              }}
            />
          {/if}
        {/snippet}
      </PanelTree>
    {/if}
  </PanelView>
</Tooltip.Provider>

<AlertDialog
  open={!!pendingDelete}
  title={pendingDelete?.kind === "project"
    ? "Remove project?"
    : "Delete conversation?"}
  description={pendingDelete
    ? pendingDelete.kind === "project"
      ? `This removes “${pendingDelete.label}” from Nerve and deletes its Nerve conversations. Files on disk are not deleted.`
      : `This permanently removes “${pendingDelete.label}”.`
    : ""}
  confirmLabel={pendingDelete?.kind === "project" ? "Remove" : "Delete"}
  destructive
  onConfirm={confirmDelete}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>

<PruneConversationsDialog
  open={!!pendingPrune}
  projectLabel={pendingPrune?.label ?? ""}
  totalCount={pendingPrune
    ? countProjectConversations(conversations, pendingPrune.id)
    : 0}
  ageEligible={(days) =>
    pendingPrune ? countAgeEligible(conversations, pendingPrune.id, days) : 0}
  keepEligible={(keep) =>
    pendingPrune ? countKeepEligible(conversations, pendingPrune.id, keep) : 0}
  onConfirm={confirmPrune}
  onOpenChange={(open) => {
    if (!open) pendingPrune = undefined;
  }}
/>

{#if activeGroup}
  <ProjectConversationsDialog
    open={allConversationsOpen}
    projectLabel={activeGroup.label}
    projectIds={activeGroup.projects.map((project) => project.id)}
    {conversations}
    {agents}
    {selectedConversationId}
    {openConversationTabIds}
    {conversationActivityById}
    {onOpenConversation}
    buildMenu={(conversation) =>
      buildConversationMenu(
        projects.find((project) => project.id === conversation.projectId) ??
          activeGroup.project,
        conversation,
        menuContext,
      )}
    onOpenChange={(open) => (allConversationsOpen = open)}
  />
{/if}
