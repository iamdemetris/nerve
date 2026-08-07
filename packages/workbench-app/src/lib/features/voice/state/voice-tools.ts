export type VoiceScope = "chat" | "project" | "all";
export type VoiceConversationStatus = "running" | "needs_user" | "idle";

export type VoiceWorkspaceSnapshot = {
  projects: { id: string; name: string }[];
  conversations: {
    id: string;
    projectId: string;
    title: string;
    status: VoiceConversationStatus;
  }[];
};

export type VoiceToolContext = {
  scope: VoiceScope;
  activeProjectId?: string;
  activeConversationId?: string;
  snapshot: VoiceWorkspaceSnapshot;
};

type VoiceToolActions = {
  openConversation: (conversationId: string) => Promise<unknown>;
  sendPrompt: (conversationId: string, prompt: string) => Promise<unknown>;
  createConversation: (projectId: string, prompt: string) => Promise<unknown>;
  requestConfirmation: (description: string) => Promise<boolean>;
};

export type VoiceToolDispatcher = (
  name: string,
  argumentsValue: unknown,
) => Promise<unknown>;

export const OPENAI_VOICE_TOOLS = [
  {
    type: "function",
    name: "list_projects",
    description:
      "List projects available in the current voice scope, with stable IDs.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "list_conversations",
    description:
      "List conversations and their running/needs-user/idle status in the current voice scope.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Optional project ID returned by list_projects.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "open_conversation",
    description: "Open an existing conversation in Nerve.",
    parameters: {
      type: "object",
      properties: {
        conversation_id: { type: "string" },
      },
      required: ["conversation_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "send_prompt",
    description:
      "Ask Nerve to send a prompt to an existing conversation. Nerve will require visible user confirmation.",
    parameters: {
      type: "object",
      properties: {
        conversation_id: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["conversation_id", "prompt"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_conversation",
    description:
      "Create a conversation in a project and send its first prompt. Nerve will require visible user confirmation.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["project_id", "prompt"],
      additionalProperties: false,
    },
  },
] as const;

function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voice tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  argumentsValue: Record<string, unknown>,
  key: string,
): string {
  const value = argumentsValue[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Voice tool argument ${key} is required.`);
  }
  return value.trim();
}

function optionalString(
  argumentsValue: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = argumentsValue[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Voice tool argument ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function accessibleProjectIds(context: VoiceToolContext): Set<string> {
  if (context.scope === "all") {
    return new Set(context.snapshot.projects.map((project) => project.id));
  }
  return new Set(context.activeProjectId ? [context.activeProjectId] : []);
}

function assertAccessibleProject(
  context: VoiceToolContext,
  projectId: string,
): void {
  if (!accessibleProjectIds(context).has(projectId)) {
    throw new Error(`Project ${projectId} is outside the current voice scope.`);
  }
}

function accessibleConversations(context: VoiceToolContext) {
  const projectIds = accessibleProjectIds(context);
  return context.snapshot.conversations.filter((conversation) => {
    if (!projectIds.has(conversation.projectId)) return false;
    return (
      context.scope !== "chat" ||
      conversation.id === context.activeConversationId
    );
  });
}

function requireConversation(
  context: VoiceToolContext,
  conversationId: string,
) {
  const conversation = accessibleConversations(context).find(
    (candidate) => candidate.id === conversationId,
  );
  if (!conversation) {
    throw new Error(
      `Conversation ${conversationId} is outside the current voice scope.`,
    );
  }
  return conversation;
}

export function createVoiceToolDispatcher(
  getContext: () => VoiceToolContext,
  actions: VoiceToolActions,
): VoiceToolDispatcher {
  return async (name, rawArguments) => {
    const context = getContext();
    const argumentsValue = objectArguments(rawArguments);
    switch (name) {
      case "list_projects": {
        const projectIds = accessibleProjectIds(context);
        return {
          projects: context.snapshot.projects.filter((project) =>
            projectIds.has(project.id),
          ),
        };
      }
      case "list_conversations": {
        const projectId = optionalString(argumentsValue, "project_id");
        if (projectId) assertAccessibleProject(context, projectId);
        return {
          conversations: accessibleConversations(context).filter(
            (conversation) =>
              !projectId || conversation.projectId === projectId,
          ),
        };
      }
      case "open_conversation": {
        const conversationId = requiredString(
          argumentsValue,
          "conversation_id",
        );
        const conversation = requireConversation(context, conversationId);
        await actions.openConversation(conversation.id);
        return { opened: true };
      }
      case "send_prompt": {
        const conversationId = requiredString(
          argumentsValue,
          "conversation_id",
        );
        const prompt = requiredString(argumentsValue, "prompt");
        const conversation = requireConversation(context, conversationId);
        const confirmed = await actions.requestConfirmation(
          `Send to “${conversation.title}”: ${prompt}`,
        );
        if (!confirmed) return { cancelled: true };
        await actions.sendPrompt(conversation.id, prompt);
        return { sent: true };
      }
      case "create_conversation": {
        const projectId = requiredString(argumentsValue, "project_id");
        const prompt = requiredString(argumentsValue, "prompt");
        assertAccessibleProject(context, projectId);
        const project = context.snapshot.projects.find(
          (candidate) => candidate.id === projectId,
        );
        if (!project) throw new Error(`Project ${projectId} was not found.`);
        const confirmed = await actions.requestConfirmation(
          `Create a chat in “${project.name}” and send: ${prompt}`,
        );
        if (!confirmed) return { cancelled: true };
        await actions.createConversation(project.id, prompt);
        return { created: true };
      }
      default:
        throw new Error(`Unknown voice tool: ${name}`);
    }
  };
}
