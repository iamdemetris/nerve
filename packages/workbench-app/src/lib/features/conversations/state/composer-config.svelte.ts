import { modelKey, parseModelKey } from "$lib/presentation/utils/model";
import type {
  AgentRecord,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import { pendingConversationKey } from "$lib/core/state/state-keys";
import { queueAgentConfigChange } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { queueSettingsSave } from "$lib/features/settings/state/settings-actions.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { mainAgentForConversation } from "./main-agent";
import {
  clampServiceTierForModel,
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "./agent-selection-defaults";

export function currentActiveAgent(): AgentRecord | undefined {
  const conversation = workspaceState.conversations.find(
    (candidate) => candidate.id === selection.conversationId,
  );
  if (!conversation) return undefined;
  return mainAgentForConversation(
    conversation,
    workspaceState.agents,
    selection.agentId,
  );
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(conversationState.selectedModelKey);
}

export function selectedModelInfo(): ModelInfo | undefined {
  return settingsState.models.find(
    (model) => modelKey(model) === conversationState.selectedModelKey,
  );
}

export {
  clampServiceTierForModel,
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
};

export function supportedThinkingLevelsForSelectedModel(): AgentRecord["thinkingLevel"][] {
  return supportedThinkingLevelsForModel(selectedModelInfo());
}

type LastAgentSelectionPatch = Partial<Settings["lastAgentSelection"]>;

function rememberLastAgentSelection(patch: LastAgentSelectionPatch): void {
  const settings = settingsState.settingsDraft;
  if (!settings?.rememberLastAgentSelection) return;
  settings.lastAgentSelection = {
    ...settings.lastAgentSelection,
    ...patch,
  };
  queueSettingsSave({ lastAgentSelection: patch }, { immediate: true });
}

function activePendingComposerConversation() {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

export function selectedThinkingLevel(): AgentRecord["thinkingLevel"] {
  return clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    selectedModelInfo(),
  );
}

export function selectedServiceTier(): AgentRecord["serviceTier"] {
  return clampServiceTierForModel(
    conversationState.selectedServiceTier,
    selectedModelInfo(),
  );
}

/**
 * Composer setters mutate local state synchronously (immediate display) and
 * enqueue one coalesced, serialized `agent.configure` mutation per agent.
 * Pending-conversation controls stay local-only. The `agent.configured`
 * conversation event owns the coalesced context-usage refresh.
 */
export function setComposerModel(key: string) {
  conversationState.selectedModelKey = key;
  // Clamp thinking / service tier locally from the already-loaded model info.
  const thinkingLevel = clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    selectedModelInfo(),
  );
  const serviceTier = clampServiceTierForModel(
    conversationState.selectedServiceTier,
    selectedModelInfo(),
  );
  conversationState.selectedThinkingLevel = thinkingLevel;
  conversationState.selectedServiceTier = serviceTier;
  const pending = activePendingComposerConversation();
  if (pending) {
    pending.selectedModelKey = key;
    pending.thinkingLevel = thinkingLevel;
    pending.serviceTier = serviceTier;
  }
  const model = selectedModel();
  rememberLastAgentSelection({
    ...(model ? { model } : {}),
    thinkingLevel,
    serviceTier,
  });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, {
    model: model ?? null,
    thinkingLevel,
    serviceTier,
  });
}

export function setComposerThinkingLevel(level: AgentRecord["thinkingLevel"]) {
  const thinkingLevel = clampThinkingLevelForModel(level, selectedModelInfo());
  conversationState.selectedThinkingLevel = thinkingLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.thinkingLevel = thinkingLevel;
  rememberLastAgentSelection({ thinkingLevel });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { thinkingLevel });
}

export function setComposerServiceTier(tier: AgentRecord["serviceTier"]) {
  const serviceTier = clampServiceTierForModel(tier, selectedModelInfo());
  conversationState.selectedServiceTier = serviceTier;
  const pending = activePendingComposerConversation();
  if (pending) pending.serviceTier = serviceTier;
  rememberLastAgentSelection({ serviceTier });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { serviceTier });
}

export function setComposerMode(mode: AgentRecord["mode"]) {
  conversationState.selectedMode = mode;
  const pending = activePendingComposerConversation();
  if (pending) pending.mode = mode;
  rememberLastAgentSelection({ mode });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { mode });
}

export function setComposerPermission(
  permissionLevel: AgentRecord["permissionLevel"],
) {
  conversationState.selectedPermissionLevel = permissionLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.permissionLevel = permissionLevel;
  rememberLastAgentSelection({ permissionLevel });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { permissionLevel });
}

export function setComposerApprovalPolicy(
  approvalPolicy: AgentRecord["approvalPolicy"],
) {
  conversationState.selectedApprovalPolicy = approvalPolicy;
  const pending = activePendingComposerConversation();
  if (pending) pending.approvalPolicy = approvalPolicy;
  rememberLastAgentSelection({ approvalPolicy });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { approvalPolicy });
}

function approvalPoliciesEqual(
  left: AgentRecord["approvalPolicy"] | undefined,
  right: AgentRecord["approvalPolicy"],
): boolean {
  return left?.autoApproveReadOnly === right.autoApproveReadOnly;
}

export function agentNeedsComposerUpdate(agent: AgentRecord | undefined) {
  const desired = selectedModel();
  const thinkingLevel = selectedThinkingLevel();
  const serviceTier = selectedServiceTier();
  const needsModel =
    desired &&
    modelKey(agent?.model ?? { provider: "", modelId: "" }) !==
      modelKey(desired);
  const needsMode = agent?.mode !== conversationState.selectedMode;
  const needsPermission =
    agent?.permissionLevel !== conversationState.selectedPermissionLevel;
  const needsApprovalPolicy = !approvalPoliciesEqual(
    agent?.approvalPolicy,
    conversationState.selectedApprovalPolicy,
  );
  const needsThinking = agent?.thinkingLevel !== thinkingLevel;
  const needsServiceTier = (agent?.serviceTier ?? "default") !== serviceTier;
  return {
    desired,
    thinkingLevel,
    serviceTier,
    needsModel,
    needsMode,
    needsPermission,
    needsApprovalPolicy,
    needsThinking,
    needsServiceTier,
  };
}
