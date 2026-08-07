import type {
  AgentRecord,
  ConversationRecord,
  ProjectEditor,
  ProjectRecord,
  PruneProjectConversationsRequest,
  StatusResponse,
} from "$lib/api";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
import type { PendingConversationTabModel } from "$lib/features/workspace/state/center-tab-models";

export type DeleteTarget = {
  kind: "project" | "conversation";
  id: string;
  label: string;
};

export type PruneTarget = {
  id: string;
  label: string;
};

export type ProjectAgentTreeProps = {
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
  agents?: AgentRecord[];
  homeDir?: string;
  selectedProjectId?: string;
  selectedConversationId?: string;
  openConversationTabIds?: Set<string>;
  pendingConversationTabs?: PendingConversationTabModel[];
  conversationActivityById?: Record<string, ConversationActivityState>;
  searchFocusToken?: number;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  onSelectProject?: (projectId: string) => void;
  onOpenProjectPicker?: () => void;
  onOpenConversation?: (conversationId: string) => void;
  onOpenPendingConversation?: (pendingId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onRenameConversation?: (
    conversationId: string,
    title: string,
  ) => void | Promise<void>;
  onMoveConversation?: (
    conversationId: string,
    projectId: string,
  ) => void | Promise<void>;
  onPruneProjectConversations?: (
    projectId: string,
    request: PruneProjectConversationsRequest,
  ) => void;
};
