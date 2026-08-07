import {
  openConversation,
  openPendingConversation,
  sendPromptText,
} from "$lib/features/conversations";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/features/workspace";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  OpenAIRealtimeConnection,
  type OpenAIRealtimeEvent,
} from "./openai-realtime-connection";
import {
  createVoiceToolDispatcher,
  OPENAI_VOICE_TOOLS,
  type VoiceScope,
  type VoiceToolDispatcher,
  type VoiceWorkspaceSnapshot,
} from "./voice-tools";

export type ChatGptVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirming"
  | "error";

export type VoiceConfirmation = {
  id: string;
  description: string;
};

const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";

function eventString(event: Record<string, unknown>, key: string): string {
  const value = event[key];
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function workspaceSnapshot(): VoiceWorkspaceSnapshot {
  const activityById = workspaceSelectors.conversationActivityById;
  return {
    projects: workspaceState.projects.map(({ id, name }) => ({ id, name })),
    conversations: workspaceState.conversations.map((conversation) => {
      const activity = activityById[conversation.id];
      return {
        id: conversation.id,
        projectId: conversation.projectId,
        title: conversation.title,
        status: activity?.needsUser
          ? ("needs_user" as const)
          : activity?.busy
            ? ("running" as const)
            : ("idle" as const),
      };
    }),
  };
}

function scopeInstructions(scope: VoiceScope): string {
  const activeProject = workspaceSelectors.activeProject;
  const activeConversation = workspaceSelectors.activeConversation;
  const scopeDescription =
    scope === "all"
      ? "all Nerve projects"
      : scope === "project"
        ? activeProject
          ? `only project “${activeProject.name}” (${activeProject.id})`
          : "the current project, but no project is selected"
        : activeConversation
          ? `only chat “${activeConversation.title}” (${activeConversation.id}) in project “${activeProject?.name ?? "Unknown"}”`
          : "the current chat, but no chat is selected";
  return [
    "You are ChatGPT Voice inside Nerve, a local project and coding-chat workbench.",
    `Your allowed scope is ${scopeDescription}.`,
    "Speak naturally and concisely. Use the list tools when IDs or current run status are needed; never guess IDs or claim a tool succeeded before receiving its result.",
    "You may inspect and open chats. Sending a prompt or creating a chat requires the visible Nerve confirmation that the tool enforces.",
    "You cannot delete anything, run terminal commands, deploy, change settings, or bypass confirmation. Explain that limitation if asked.",
    "Nerve chats run independently and concurrently. Do not imply that opening one stops another.",
  ].join(" ");
}

class ChatGptVoiceSession {
  #status = $state<ChatGptVoiceStatus>("idle");
  #scope = $state<VoiceScope>("all");
  #muted = $state(false);
  #outputMuted = $state(false);
  #userTranscript = $state("");
  #assistantTranscript = $state("");
  #error = $state<string | undefined>(undefined);
  #confirmation = $state<VoiceConfirmation | undefined>(undefined);
  #confirmationResolve?: (confirmed: boolean) => void;
  #connection?: OpenAIRealtimeConnection;
  #generation = 0;

  readonly #dispatchTool: VoiceToolDispatcher = createVoiceToolDispatcher(
    () => ({
      scope: this.#scope,
      activeProjectId: workspaceSelectors.activeProject?.id,
      activeConversationId: selection.conversationId,
      snapshot: workspaceSnapshot(),
    }),
    {
      openConversation: (conversationId) => openConversation(conversationId),
      sendPrompt: async (conversationId, prompt) => {
        await openConversation(conversationId);
        await sendPromptText(prompt);
      },
      createConversation: async (projectId, prompt) => {
        const project = workspaceState.projects.find(
          (candidate) => candidate.id === projectId,
        );
        if (!project) throw new Error(`Project ${projectId} was not found.`);
        await selectProject(project.id, { deferTabActivation: true });
        openPendingConversation(project);
        await sendPromptText(prompt);
      },
      requestConfirmation: (description) =>
        this.#requestConfirmation(description),
    },
  );

  get status(): ChatGptVoiceStatus {
    return this.#status;
  }

  get scope(): VoiceScope {
    return this.#scope;
  }

  get muted(): boolean {
    return this.#muted;
  }

  get outputMuted(): boolean {
    return this.#outputMuted;
  }

  get userTranscript(): string {
    return this.#userTranscript;
  }

  get assistantTranscript(): string {
    return this.#assistantTranscript;
  }

  get error(): string | undefined {
    return this.#error;
  }

  get confirmation(): VoiceConfirmation | undefined {
    return this.#confirmation;
  }

  get connected(): boolean {
    return !["idle", "connecting", "error"].includes(this.#status);
  }

  get pending(): boolean {
    return this.#status === "connecting";
  }

  isSupported(): boolean {
    return OpenAIRealtimeConnection.isSupported();
  }

  async start(): Promise<void> {
    if (this.#status === "connecting" || this.connected) return;
    this.stop();
    const generation = ++this.#generation;
    this.#status = "connecting";
    this.#error = undefined;
    this.#userTranscript = "";
    this.#assistantTranscript = "";
    const connection = new OpenAIRealtimeConnection({
      onEvent: (event) => this.#handleEvent(event, generation),
      onConnectionStateChange: (state) =>
        this.#handleConnectionState(state, generation),
    });
    this.#connection = connection;
    try {
      await connection.connect();
      if (generation !== this.#generation) return;
      connection.send(this.#sessionUpdate());
      connection.setMuted(this.#muted);
      connection.setOutputMuted(this.#outputMuted);
      this.#status = "listening";
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#connection = undefined;
      this.#status = "error";
      this.#error =
        error instanceof Error
          ? error.message
          : "ChatGPT Voice could not start.";
      notify.error("ChatGPT Voice could not start", {
        description: this.#error,
      });
    }
  }

  stop(): void {
    this.#generation += 1;
    this.#connection?.stop();
    this.#connection = undefined;
    this.#resolveConfirmation(false);
    this.#status = "idle";
    this.#error = undefined;
    this.#userTranscript = "";
    this.#assistantTranscript = "";
  }

  setScope(scope: VoiceScope): void {
    this.#scope = scope;
    if (this.connected) this.#connection?.send(this.#sessionUpdate());
  }

  toggleMuted(): void {
    this.#muted = !this.#muted;
    this.#connection?.setMuted(this.#muted);
  }

  toggleOutputMuted(): void {
    this.#outputMuted = !this.#outputMuted;
    this.#connection?.setOutputMuted(this.#outputMuted);
  }

  interrupt(): void {
    if (!this.connected) return;
    this.#connection?.send({ type: "response.cancel" });
    this.#connection?.send({ type: "output_audio_buffer.clear" });
    this.#status = "listening";
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.connected) return;
    this.#userTranscript = trimmed;
    this.#assistantTranscript = "";
    this.#status = "thinking";
    this.#connection?.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: trimmed }],
      },
    });
    this.#connection?.send({ type: "response.create" });
  }

  confirmAction(): void {
    this.#resolveConfirmation(true);
  }

  cancelAction(): void {
    this.#resolveConfirmation(false);
  }

  #sessionUpdate(): Record<string, unknown> {
    return {
      type: "session.update",
      session: {
        type: "realtime",
        model: OPENAI_REALTIME_MODEL,
        output_modalities: ["audio"],
        instructions: scopeInstructions(this.#scope),
        audio: {
          input: {
            transcription: { model: "gpt-4o-transcribe" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: "marin" },
        },
        tools: OPENAI_VOICE_TOOLS,
        tool_choice: "auto",
      },
    };
  }

  #handleConnectionState(
    state: RTCPeerConnectionState,
    generation: number,
  ): void {
    if (generation !== this.#generation || this.#status === "idle") return;
    if (state !== "failed" && state !== "closed") return;
    this.#connection?.stop();
    this.#connection = undefined;
    this.#resolveConfirmation(false);
    this.#status = "error";
    this.#error =
      "The ChatGPT Voice connection ended. Start it again to reconnect.";
  }

  #handleEvent(event: OpenAIRealtimeEvent, generation: number): void {
    if (generation !== this.#generation) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.#userTranscript = "";
        this.#assistantTranscript = "";
        this.#status = "listening";
        break;
      case "input_audio_buffer.speech_stopped":
      case "response.created":
        this.#status = "thinking";
        break;
      case "conversation.item.input_audio_transcription.delta":
        this.#userTranscript += eventString(event, "delta");
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.#userTranscript =
          eventString(event, "transcript") || this.#userTranscript;
        break;
      case "response.output_audio_transcript.delta":
        this.#status = "speaking";
        this.#assistantTranscript += eventString(event, "delta");
        break;
      case "response.output_audio_transcript.done":
        this.#assistantTranscript =
          eventString(event, "transcript") || this.#assistantTranscript;
        break;
      case "response.done":
        void this.#handleResponseDone(event, generation);
        break;
      case "error": {
        const providerError = record(event.error);
        this.#error =
          (providerError && eventString(providerError, "message")) ||
          "ChatGPT Voice reported an error.";
        this.#status = "error";
        break;
      }
    }
  }

  async #handleResponseDone(
    event: OpenAIRealtimeEvent,
    generation: number,
  ): Promise<void> {
    const response = record(event.response);
    const output = Array.isArray(response?.output) ? response.output : [];
    const calls = output
      .map(record)
      .filter(
        (item): item is Record<string, unknown> =>
          item?.type === "function_call" &&
          typeof item.name === "string" &&
          typeof item.call_id === "string",
      );
    if (!calls.length) {
      if (this.#status !== "error") this.#status = "listening";
      return;
    }

    this.#status = "thinking";
    for (const call of calls) {
      if (generation !== this.#generation) return;
      let result: unknown;
      try {
        const rawArguments = eventString(call, "arguments") || "{}";
        result = await this.#dispatchTool(
          eventString(call, "name"),
          JSON.parse(rawArguments),
        );
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (generation !== this.#generation) return;
      this.#connection?.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: eventString(call, "call_id"),
          output: JSON.stringify(result),
        },
      });
    }
    if (generation !== this.#generation) return;
    this.#status = "thinking";
    this.#connection?.send({ type: "response.create" });
  }

  #requestConfirmation(description: string): Promise<boolean> {
    this.#resolveConfirmation(false);
    const id = crypto.randomUUID();
    this.#confirmation = { id, description };
    this.#status = "confirming";
    return new Promise<boolean>((resolve) => {
      this.#confirmationResolve = resolve;
    });
  }

  #resolveConfirmation(confirmed: boolean): void {
    const resolve = this.#confirmationResolve;
    this.#confirmationResolve = undefined;
    this.#confirmation = undefined;
    resolve?.(confirmed);
    if (resolve && this.#connection) this.#status = "thinking";
  }
}

export const chatGptVoiceSession = new ChatGptVoiceSession();
