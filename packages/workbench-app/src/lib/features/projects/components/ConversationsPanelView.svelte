<script lang="ts">
import ProjectConversationNavigator from "$lib/features/projects/components/ProjectConversationNavigator.svelte";
import { projectNavigatorSignals } from "$lib/features/projects/state/project-navigator-signals.svelte";
import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { openConversation } from "$lib/features/conversations/state/tabs";
import { selectPendingConversation } from "$lib/features/conversations/state/pending";
import {
  deleteConversationAndRefresh,
  deleteProjectAndRefresh,
  newConversationInProject,
  openProjectInEditorAndNotify,
  pruneProjectConversationsAndRefresh,
  selectProject,
  updateConversationAndNotify,
} from "$lib/features/workspace/state/workspace-actions.svelte";

const status = $derived(workspaceSelectors.status);
const projects = $derived(workspaceSelectors.projects);
const conversations = $derived(workspaceSelectors.conversations);
const agents = $derived(workspaceSelectors.agents);
const openConversationTabIds = $derived(
  workspaceSelectors.openConversationTabIds,
);
const pendingConversationTabs = $derived(
  workspaceSelectors.openPendingConversationTabs,
);
const conversationActivityById = $derived(
  conversationSelectors.conversationActivityById,
);
</script>

<ProjectConversationNavigator
  {projects}
  {conversations}
  {agents}
  homeDir={status?.storage.userHome}
  selectedProjectId={selection.projectId}
  selectedConversationId={selection.conversationId}
  {openConversationTabIds}
  {pendingConversationTabs}
  {conversationActivityById}
  searchFocusToken={projectNavigatorSignals.searchFocusToken}
  editorAvailability={status?.runtime.editors}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenProjectPicker={() => (workspaceState.projectPickerOpen = true)}
  onOpenConversation={openConversation}
  onOpenPendingConversation={selectPendingConversation}
  onNewConversationInProject={newConversationInProject}
  onOpenProjectInEditor={(projectId, editor) =>
    void openProjectInEditorAndNotify(projectId, editor)}
  onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
  onDeleteConversation={(id) => void deleteConversationAndRefresh(id)}
  onRenameConversation={(id, title) =>
    updateConversationAndNotify(id, { title })}
  onMoveConversation={(id, projectId) =>
    updateConversationAndNotify(id, { projectId })}
  onPruneProjectConversations={(id, request) =>
    void pruneProjectConversationsAndRefresh(id, request)}
/>
