<script lang="ts">
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import Mic from "@lucide/svelte/icons/mic";
import { isInlineCommandPrompt } from "@nervekit/contracts";
import { uploadClipboardImage } from "$lib/api";
import { getDesktopBridge } from "$lib/features/desktop/state/desktop-bridge.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import TranscriptionActivity from "$lib/core/audio/TranscriptionActivity.svelte";
import {
  voiceInputSession,
  type VoiceInputTarget,
} from "$lib/core/audio/voice-input-session.svelte";
import { AgentComposer } from "$lib/presentation/components/conversation";
import { modelKey, supportsImageInput } from "$lib/presentation/utils/model";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import PromptSuggestionChips from "../components/PromptSuggestionChips.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import type { PromptComposerProps } from "../components/prompt-composer-props";
import { deriveComposerAvailability } from "./composer-availability";
import {
  composerDropOverlayLabel,
  partitionDroppedFiles,
} from "./dropped-composer-media";
import { resolveDroppedPaths } from "./dropped-paths";

let {
  text = "",
  activeProject,
  activeConversation,
  activePendingConversation,
  pendingConversationActive = false,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
  interactive = true,
  sending = false,
  stopping = false,
  compacting = false,
  models = [],
  selectedModelKey = "",
  contextUsage,
  contextWindow = 0,
  todos = [],
  focusToken = 0,
  composerEscapeToken = 0,
  micShortcutToken = 0,
  thinkingLevel = "off",
  serviceTier = "default",
  mode = "coding",
  permissionLevel = "autonomous",
  approvalPolicy = { autoApproveReadOnly: true },
  slashCompletions = [],
  fileCompletions,
  composerSuggestions = [],
  onSendSuggestion,
  onDraftSuggestion,
  onChange,
  onSubmit,
  onAbort,
  onCompact,
  onModelChange,
  onThinkingLevelChange,
  onServiceTierChange,
  onModeChange,
  onPermissionChange,
  onApprovalPolicyChange,
}: PromptComposerProps = $props();

let editorFocusToken = $state(0);
let voiceSubmitPending = $state(false);
let lastFocusToken = $state<number | undefined>(undefined);
let lastComposerEscapeToken = $state<number | undefined>(undefined);
let lastMicShortcutToken = $state<number | undefined>(undefined);
let audioAuthDialogOpen = $state(false);

const micShortcut = getShortcutLabel("composer.toggleMic");
const micShortcutAria = getShortcutAriaLabel("composer.toggleMic");
const cancelMicShortcut = getShortcutLabel("composer.cancelMic");
const modeShortcut = getShortcutLabel("composer.toggleMode");
const modeShortcutAria = getShortcutAriaLabel("composer.toggleMode");
const permissionShortcut = getShortcutLabel("composer.cyclePermission");
const permissionShortcutAria = getShortcutAriaLabel("composer.cyclePermission");
const thinkingShortcut = getShortcutLabel("composer.cycleThinking");
const stopShortcut = getShortcutLabel("composer.stopRun");
const stopShortcutAria = getShortcutAriaLabel("composer.stopRun");

const voiceTarget = $derived.by<VoiceInputTarget | undefined>(() => {
  if (activeConversation)
    return { kind: "conversation", id: activeConversation.id };
  if (activePendingConversation)
    return { kind: "pending-conversation", id: activePendingConversation.id };
  return undefined;
});
const recording = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.recording,
  ),
);
const transcribing = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.transcribing,
  ),
);
const voiceBusyElsewhere = $derived(
  Boolean(voiceTarget && voiceInputSession.isBusyForOtherTarget(voiceTarget)),
);

const pendingApproval = $derived(approvals.length > 0);
const pendingQuestion = $derived(pendingUserQuestions.length > 0);
const pendingPlan = $derived(pendingPlanReviews.length > 0);
const blockedForReview = $derived(
  pendingApproval || pendingQuestion || pendingPlan,
);
const commandMode = $derived(isInlineCommandPrompt(text));
const availability = $derived(
  deriveComposerAvailability({
    interactive,
    hasProject: Boolean(activeProject),
    hasConversation: Boolean(activeConversation || pendingConversationActive),
    hasModels: models.length > 0,
    blockedForReview,
    compacting,
    stopping,
    sending,
    commandMode,
    voiceSubmitPending,
  }),
);
const canPrompt = $derived(availability.canPrompt);
const editorDisabled = $derived(!availability.canEdit);
const submitDisabled = $derived(!availability.canSubmit);
const chatGptAudioConfigured = $derived(chatGptAudioAuth.configured);
const selectedModelInfo = $derived(
  models.find((model) => modelKey(model) === selectedModelKey),
);
/** Vision-capable models accept pasted or dropped images as temp local paths. */
const imageInputSupported = $derived(supportsImageInput(selectedModelInfo));
/** Desktop path mentions for non-image files/folders. */
const pathDropSupported = $derived(Boolean(getDesktopBridge()?.files));
/** Drop target is live when either path mentions or image attach is available. */
const fileDropSupported = $derived(pathDropSupported || imageInputSupported);
const dropOverlayLabel = $derived(
  composerDropOverlayLabel({
    imageDrop: imageInputSupported,
    pathDrop: pathDropSupported,
  }),
);
const supportsAudioRecording = $derived(voiceInputSession.isSupported());
const micDisabled = $derived(
  !interactive ||
    stopping ||
    !voiceTarget ||
    voiceInputSession.pending ||
    (!recording &&
      (!canPrompt || !supportsAudioRecording || voiceBusyElsewhere)),
);
const micTitle = $derived(
  recording
    ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — ${cancelMicShortcut ?? "Esc"} to cancel; right-click to cancel (${formatElapsed(voiceInputSession.elapsedMs)} / ${formatElapsed(voiceInputSession.maxDurationMs)})`
    : voiceBusyElsewhere
      ? "Voice recording is active in another conversation"
      : voiceInputSession.retryAttempt > 0 &&
          voiceTarget &&
          voiceInputSession.isTargetActive(voiceTarget)
        ? `Retrying transcription ${voiceInputSession.retryAttempt}/${voiceInputSession.maxRetries}…`
        : transcribing
          ? "Transcribing audio…"
          : !chatGptAudioConfigured
            ? "Connect ChatGPT to use voice input"
            : micShortcut
              ? `Record voice prompt (${micShortcut})`
              : "Record voice prompt",
);
const sendAriaLabel = $derived(
  voiceSubmitPending
    ? "Transcribing and sending prompt"
    : recording
      ? "Transcribe and send prompt"
      : compacting
        ? "Compacting context"
        : availability.canEdit && models.length === 0
          ? "Waiting for an available model"
          : commandMode
            ? "Run command"
            : sending
              ? "Queue prompt"
              : "Send prompt",
);
const sendTitle = $derived(
  voiceSubmitPending
    ? "Transcribing audio, then sending prompt"
    : recording
      ? "Stop recording, transcribe, and send prompt"
      : compacting
        ? "Compacting context"
        : availability.canEdit && models.length === 0
          ? "Models are loading; you can continue drafting"
          : commandMode
            ? sending
              ? "Wait for the current agent turn before running a command"
              : "Run command"
            : sending
              ? "Queue prompt for the next agent turn"
              : "Send prompt",
);

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function submitComposer() {
  if (!availability.canSubmit) return;

  if (recording && voiceTarget) {
    voiceSubmitPending = true;
    try {
      const transcribed = await voiceInputSession.stop(voiceTarget);
      if (transcribed) onSubmit?.();
    } finally {
      voiceSubmitPending = false;
    }
    return;
  }

  onSubmit?.();
}

async function pasteImage(file: File): Promise<string> {
  if (!imageInputSupported) {
    const message =
      "The selected model does not support image input. Switch to a vision-capable model.";
    notify.error("Could not paste image", { description: message });
    throw new Error(message);
  }
  try {
    return await uploadClipboardImage(file);
  } catch (caught) {
    const description =
      caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not paste image", { description });
    throw caught;
  }
}

/**
 * Image files → temporary paths (same pipeline as clipboard paste) when the
 * model supports vision. Other files/folders → desktop path mentions.
 */
async function dropFiles(files: readonly File[]): Promise<readonly string[]> {
  const { imageFiles, pathFiles } = partitionDroppedFiles(files);
  const mentions: string[] = [];

  if (imageFiles.length > 0) {
    if (!imageInputSupported) {
      notify.error("Could not add dropped images", {
        description:
          "The selected model does not support image input. Switch to a vision-capable model, or drop non-image files for path mentions on desktop.",
      });
    } else {
      try {
        for (const file of imageFiles) {
          mentions.push(await uploadClipboardImage(file));
        }
      } catch (caught) {
        const description =
          caught instanceof Error ? caught.message : String(caught);
        notify.error("Could not add dropped images", { description });
        throw caught;
      }
    }
  }

  if (pathFiles.length > 0) {
    try {
      const bridge = getDesktopBridge();
      if (!bridge?.files || !activeProject) {
        throw new Error(
          pathFiles.length === files.length
            ? "Native file paths are unavailable in this window. On desktop, drop files for path mentions; image drops work when the model supports vision."
            : "Non-image files need the desktop app for path mentions. Images were still attached when supported.",
        );
      }
      mentions.push(
        ...resolveDroppedPaths(
          pathFiles,
          activeProject.dir,
          bridge.files.getPathForFile,
        ),
      );
    } catch (caught) {
      // If images already succeeded, keep them and surface a soft error for paths.
      if (mentions.length > 0) {
        const description =
          caught instanceof Error ? caught.message : String(caught);
        notify.error("Could not add all dropped paths", { description });
      } else {
        const description =
          caught instanceof Error ? caught.message : String(caught);
        notify.error("Could not add dropped paths", { description });
        throw caught;
      }
    }
  }

  if (mentions.length === 0) {
    throw new Error("Nothing could be added from the drop.");
  }
  return mentions;
}

const controlsDisabled = $derived(
  !interactive ||
    !(activeConversation || pendingConversationActive) ||
    stopping ||
    compacting ||
    blockedForReview,
);
const modeDisabled = $derived(
  !interactive || !(activeConversation || pendingConversationActive),
);
const modelDisabled = $derived(
  !interactive ||
    !(activeConversation || pendingConversationActive) ||
    models.length === 0 ||
    compacting ||
    stopping,
);
const modelRuntimeChangeHint = $derived(
  sending ? "Changes apply to the next model request" : undefined,
);

function toggleRecording() {
  if (!interactive || micDisabled || compacting || stopping || !voiceTarget)
    return;
  if (!recording && !chatGptAudioConfigured) {
    audioAuthDialogOpen = true;
    return;
  }
  void voiceInputSession.toggle(voiceTarget);
}

function cancelRecordingShortcut() {
  if (!recording || !voiceTarget) return false;
  void voiceInputSession.cancel(voiceTarget);
  return true;
}

$effect(() => {
  if (lastFocusToken === undefined || !interactive) {
    lastFocusToken = focusToken;
    return;
  }
  if (focusToken === lastFocusToken) return;
  lastFocusToken = focusToken;
  editorFocusToken += 1;
});

$effect(() => {
  if (lastComposerEscapeToken === undefined || !interactive) {
    lastComposerEscapeToken = composerEscapeToken;
    return;
  }
  if (composerEscapeToken === lastComposerEscapeToken) return;
  lastComposerEscapeToken = composerEscapeToken;
  if (!cancelRecordingShortcut()) editorFocusToken += 1;
});

$effect(() => {
  if (lastMicShortcutToken === undefined || !interactive) {
    lastMicShortcutToken = micShortcutToken;
    return;
  }
  if (micShortcutToken === lastMicShortcutToken) return;
  lastMicShortcutToken = micShortcutToken;
  toggleRecording();
});

function handleMicContextMenu(event: MouseEvent) {
  if (!recording || !voiceTarget) return;
  event.preventDefault();
  void voiceInputSession.cancel(voiceTarget);
}
</script>

<AgentComposer
  model={{
    text,
    disabled: editorDisabled,
    editorDisabled,
    submitDisabled,
    sending,
    stopping,
    compacting,
    showStop: sending || stopping || compacting,
    pendingApproval,
    pendingQuestion,
    pendingPlan,
    models,
    selectedModelKey,
    thinkingLevel,
    serviceTier,
    mode,
    permissionLevel,
    approvalPolicy,
    contextUsage,
    contextWindow,
    placeholder: pendingApproval
      ? "Approval required before the agent can continue"
      : pendingPlan
        ? "Review the plan in the transcript before the agent can continue"
        : pendingQuestion
          ? "Reply in the transcript before the agent can continue"
          : compacting
            ? "Compacting context…"
            : sending
              ? "Queue a prompt for the next agent turn"
              : "Ask the local Nerve agent",
    focusToken: editorFocusToken,
    controlsDisabled,
    modeDisabled,
    modelDisabled,
    runtimeChangeHint: modelRuntimeChangeHint,
    sendAriaLabel,
    sendTitle,
    stopAriaLabel: compacting ? "Stop compaction" : "Stop generation",
    stopShortcutAria,
    stopTitle: stopping
      ? compacting
        ? "Stopping compaction"
        : "Stopping generation"
      : compacting
        ? stopShortcut
          ? `Stop compaction (${stopShortcut})`
          : "Stop compaction"
        : stopShortcut
          ? `Stop generation (${stopShortcut})`
          : "Stop generation",
    permissionShortcut,
    permissionShortcutAria,
    modeShortcut,
    modeShortcutAria,
    thinkingShortcut,
    todos,
    slashCompletions,
    fileCompletions,
    dropOverlayLabel,
    capabilities: {
      voice: true,
      imagePaste: imageInputSupported,
      fileDrop: fileDropSupported,
      completions: true,
      suggestions: true,
      shortcuts: true,
      todos: true,
      queueing: true,
    },
  }}
  actions={{
    onComposerChange: onChange,
    onSubmit: submitComposer,
    onAbort,
    onCompact,
    onModelChange,
    onThinkingLevelChange,
    onServiceTierChange,
    onModeChange,
    onPermissionChange,
    onApprovalPolicyChange,
    onPasteImage: imageInputSupported ? pasteImage : undefined,
    onDropFiles: fileDropSupported ? dropFiles : undefined,
  }}
>
  {#snippet header()}
    {#if composerSuggestions.length > 0 && !blockedForReview && !compacting && canPrompt}
      <PromptSuggestionChips
        suggestions={composerSuggestions}
        disabled={sending}
        onSend={onSendSuggestion}
        onDraft={onDraftSuggestion}
      />
    {/if}
  {/snippet}

  {#snippet sendLeading()}
    <TranscriptionActivity
      {recording}
      {transcribing}
      elapsedMs={voiceInputSession.elapsedMs}
      maxDurationMs={voiceInputSession.maxDurationMs}
      retryAttempt={voiceTarget && voiceInputSession.isTargetActive(voiceTarget)
        ? voiceInputSession.retryAttempt
        : 0}
      maxRetries={voiceInputSession.maxRetries}
      class="composer-transcription-status"
    />
    <Button
      variant={recording ? "destructive" : "secondary"}
      size="icon-sm"
      class={`rounded-full ${recording ? "inset-ring-1 inset-ring-destructive/28" : ""}`}
      type="button"
      disabled={micDisabled}
      onclick={toggleRecording}
      oncontextmenu={handleMicContextMenu}
      aria-label={recording
        ? "Stop recording; right-click to cancel"
        : chatGptAudioConfigured
          ? "Record voice prompt"
          : "Connect ChatGPT to use voice input"}
      aria-keyshortcuts={micShortcutAria}
      title={micTitle}
    >
      {#if transcribing}
        <Spinner class="size-3.5" />
      {:else}
        <Mic size={14} strokeWidth={2.4} />
      {/if}
    </Button>
  {/snippet}
</AgentComposer>

<AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />
