<script lang="ts">
import CircleStop from "@lucide/svelte/icons/circle-stop";
import Mic from "@lucide/svelte/icons/mic";
import MicOff from "@lucide/svelte/icons/mic-off";
import PhoneOff from "@lucide/svelte/icons/phone-off";
import Send from "@lucide/svelte/icons/send";
import Volume2 from "@lucide/svelte/icons/volume-2";
import VolumeX from "@lucide/svelte/icons/volume-x";
import { Badge, type BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { openAuthPane } from "$lib/features/auth";
import { chatGptVoiceSession as session } from "../state/chatgpt-voice-session.svelte";
import type { VoiceScope } from "../state/voice-tools";

let textInput = $state("");

const statusLabel = $derived(
  session.status === "idle"
    ? "Off"
    : session.status === "connecting"
      ? "Connecting"
      : session.status === "listening"
        ? "Listening"
        : session.status === "thinking"
          ? "Thinking"
          : session.status === "speaking"
            ? "Speaking"
            : session.status === "confirming"
              ? "Confirm action"
              : "Connection error",
);

const statusTone = $derived<BadgeTone>(
  session.status === "error"
    ? "danger"
    : session.status === "confirming"
      ? "warn"
      : session.connected
        ? "running"
        : "neutral",
);

function setScope(value: string | null | undefined): void {
  if (value === "chat" || value === "project" || value === "all") {
    session.setScope(value satisfies VoiceScope);
  }
}

function submitText(): void {
  const text = textInput.trim();
  if (!text) return;
  session.sendText(text);
  textInput = "";
}
</script>

<span class="inline-flex">
  <Popover
    ariaLabel="Open ChatGPT Voice"
    triggerTitle="ChatGPT Voice"
    side="bottom"
    align="end"
    size="xl"
    class="overflow-y-auto"
    triggerClass={`size-8 rounded-[min(var(--radius-md),10px)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground ${session.connected ? "text-info" : ""}`}
  >
    {#snippet trigger()}
      <span class="relative inline-flex size-8 items-center justify-center">
        {#if session.pending}
          <Spinner class="size-4" />
        {:else if session.muted}
          <MicOff class="size-4" strokeWidth={2.1} />
        {:else}
          <Mic class="size-4" strokeWidth={2.1} />
        {/if}
        {#if session.connected}
          <span
            class="absolute right-1 top-1 size-1.5 rounded-full bg-info"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
    {/snippet}

    <PopoverBody class="gap-3.5">
      <PopoverHeader title="ChatGPT Voice" meta="gpt-realtime-2.1">
        {#snippet action()}
          <Badge size="xs" tone={statusTone}>{statusLabel}</Badge>
        {/snippet}
      </PopoverHeader>

      <PopoverSection label="Access">
        <ToggleGroup.Root
          type="single"
          size="sm"
          spacing={1}
          variant="outline"
          value={session.scope}
          aria-label="ChatGPT Voice access scope"
          class="w-full"
          onValueChange={setScope}
        >
          <ToggleGroup.Item value="chat" class="flex-1">Chat</ToggleGroup.Item>
          <ToggleGroup.Item value="project" class="flex-1"
            >Project</ToggleGroup.Item
          >
          <ToggleGroup.Item value="all" class="flex-1"
            >All projects</ToggleGroup.Item
          >
        </ToggleGroup.Root>
        <p class="text-muted-foreground">
          {session.scope === "all"
            ? "Can inspect and navigate every project. Sending work still needs your confirmation."
            : session.scope === "project"
              ? "Limited to the currently selected project."
              : "Limited to the currently selected chat."}
        </p>
      </PopoverSection>

      <PopoverSection label="Live conversation" separated>
        <div
          class="grid min-h-24 gap-2 rounded-md border border-border bg-muted/30 p-2.5"
          aria-live="polite"
        >
          {#if session.userTranscript}
            <div class="grid gap-0.5">
              <span class="text-xs font-medium text-muted-foreground">You</span>
              <p class="text-sm text-foreground">{session.userTranscript}</p>
            </div>
          {/if}
          {#if session.assistantTranscript}
            <div class="grid gap-0.5">
              <span class="text-xs font-medium text-muted-foreground"
                >ChatGPT</span
              >
              <p class="text-sm text-foreground">
                {session.assistantTranscript}
              </p>
            </div>
          {/if}
          {#if !session.userTranscript && !session.assistantTranscript}
            <p class="self-center text-center text-sm text-muted-foreground">
              {session.connected
                ? "Speak naturally. You can interrupt ChatGPT at any time."
                : "Start a live voice session, then speak or type below."}
            </p>
          {/if}
        </div>
      </PopoverSection>

      {#if session.confirmation}
        <PopoverSection label="Approval required" separated>
          <div
            class="grid gap-2 rounded-md border border-warning/40 bg-warning/8 p-2.5"
          >
            <p class="text-sm text-foreground">
              {session.confirmation.description}
            </p>
            <div class="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onclick={() => session.cancelAction()}>Cancel</Button
              >
              <Button size="sm" onclick={() => session.confirmAction()}
                >Confirm</Button
              >
            </div>
          </div>
        </PopoverSection>
      {/if}

      {#if session.error}
        <PopoverSection label="Could not connect" separated>
          <div
            class="grid gap-2 rounded-md border border-destructive/40 bg-destructive/8 p-2.5"
          >
            <p class="text-sm text-destructive">{session.error}</p>
            <Button size="sm" variant="outline" onclick={openAuthPane}
              >Open Providers</Button
            >
          </div>
        </PopoverSection>
      {/if}

      <PopoverSection separated>
        <div class="flex flex-wrap items-center gap-2">
          {#if session.connected}
            <Button
              size="sm"
              variant="destructive"
              onclick={() => session.stop()}
            >
              <PhoneOff /> End
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              ariaLabel={session.muted
                ? "Unmute microphone"
                : "Mute microphone"}
              title={session.muted ? "Unmute microphone" : "Mute microphone"}
              pressed={session.muted}
              onclick={() => session.toggleMuted()}
            >
              {#if session.muted}<MicOff />{:else}<Mic />{/if}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              ariaLabel={session.outputMuted
                ? "Unmute ChatGPT"
                : "Mute ChatGPT"}
              title={session.outputMuted ? "Unmute ChatGPT" : "Mute ChatGPT"}
              pressed={session.outputMuted}
              onclick={() => session.toggleOutputMuted()}
            >
              {#if session.outputMuted}<VolumeX />{:else}<Volume2 />{/if}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={() => session.interrupt()}
              title="Stop the current ChatGPT response"
            >
              <CircleStop /> Interrupt
            </Button>
          {:else}
            <Button
              size="sm"
              disabled={session.pending || !session.isSupported()}
              onclick={() => void session.start()}
            >
              {#if session.pending}<Spinner />{:else}<Mic />{/if}
              {session.status === "error" ? "Try again" : "Start voice"}
            </Button>
          {/if}
          <span class="ml-auto text-xs text-muted-foreground"
            >Uses OpenAI API billing</span
          >
        </div>

        <form
          class="flex gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            submitText();
          }}
        >
          <Input
            size="sm"
            bind:value={textInput}
            placeholder="Type to ChatGPT Voice"
            ariaLabel="Type to ChatGPT Voice"
            disabled={!session.connected}
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="outline"
            ariaLabel="Send typed message"
            title="Send"
            disabled={!session.connected || !textInput.trim()}
          >
            <Send />
          </Button>
        </form>
      </PopoverSection>

      <p class="text-muted-foreground">
        A standard OpenAI API key is required; a ChatGPT subscription by itself
        does not authorize Realtime API calls.
      </p>
    </PopoverBody>
  </Popover>
</span>
