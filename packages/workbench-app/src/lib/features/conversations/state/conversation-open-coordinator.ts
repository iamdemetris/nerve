export type OpenableConversation = {
  id: string;
  projectId: string;
};

export type ConversationOpenDependencies<
  Conversation extends OpenableConversation,
> = {
  findConversation: (conversationId: string) => Conversation | undefined;
  fetchConversation: (conversationId: string) => Promise<Conversation>;
  selectedProjectId: () => string | undefined;
  selectProject: (
    projectId: string,
    options: { deferTabActivation: true },
  ) => void | Promise<void>;
  activate: (conversation: Conversation) => void | Promise<void>;
  hydrate: (conversation: Conversation) => Promise<void>;
};

/**
 * Skips activation of the project's previously selected tab, then makes the
 * requested conversation visible before its transcript hydration. A
 * monotonically increasing request id prevents a slower earlier click from
 * taking over after the user has selected a different conversation.
 */
export function createConversationOpener<
  Conversation extends OpenableConversation,
>(dependencies: ConversationOpenDependencies<Conversation>) {
  let latestRequestId = 0;

  return async function openConversation(
    conversationId: string,
  ): Promise<void> {
    const requestId = ++latestRequestId;
    const conversation =
      dependencies.findConversation(conversationId) ??
      (await dependencies.fetchConversation(conversationId));
    if (requestId !== latestRequestId) return;

    if (conversation.projectId !== dependencies.selectedProjectId()) {
      await dependencies.selectProject(conversation.projectId, {
        deferTabActivation: true,
      });
      if (requestId !== latestRequestId) return;
    }
    const activation = Promise.resolve(dependencies.activate(conversation));
    await activation;
    if (requestId !== latestRequestId) return;
    await dependencies.hydrate(conversation);
  };
}
