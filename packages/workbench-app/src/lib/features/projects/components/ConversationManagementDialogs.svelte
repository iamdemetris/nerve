<script lang="ts">
import type { ConversationRecord, ProjectRecord } from "$lib/api";
import { shortProjectLabel } from "$lib/core/utils/project-tree";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";

type Props = {
  renameTarget?: ConversationRecord;
  moveTarget?: ConversationRecord;
  projects?: ProjectRecord[];
  homeDir?: string;
  onRename?: (conversationId: string, title: string) => void | Promise<void>;
  onMove?: (conversationId: string, projectId: string) => void | Promise<void>;
  onRenameOpenChange?: (open: boolean) => void;
  onMoveOpenChange?: (open: boolean) => void;
};

let {
  renameTarget,
  moveTarget,
  projects = [],
  homeDir,
  onRename,
  onMove,
  onRenameOpenChange,
  onMoveOpenChange,
}: Props = $props();

let title = $state("");
let targetProjectId = $state("");
let busy = $state(false);
let error = $state<string | undefined>();

const moveItems = $derived(
  projects
    .filter((project) => project.id !== moveTarget?.projectId)
    .map((project) => ({
      value: project.id,
      label: shortProjectLabel(project.dir, homeDir),
      detail: project.dir,
    }))
    .sort((left, right) => left.label.localeCompare(right.label)),
);

$effect(() => {
  if (!renameTarget) return;
  title = renameTarget.title;
  busy = false;
  error = undefined;
});

$effect(() => {
  if (!moveTarget) return;
  targetProjectId = moveItems[0]?.value ?? "";
  busy = false;
  error = undefined;
});

async function submitRename(): Promise<void> {
  const target = renameTarget;
  const nextTitle = title.trim();
  if (!target || !nextTitle || busy) return;
  busy = true;
  error = undefined;
  try {
    await onRename?.(target.id, nextTitle);
    onRenameOpenChange?.(false);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy = false;
  }
}

async function submitMove(): Promise<void> {
  const target = moveTarget;
  if (!target || !targetProjectId || busy) return;
  busy = true;
  error = undefined;
  try {
    await onMove?.(target.id, targetProjectId);
    onMoveOpenChange?.(false);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy = false;
  }
}
</script>

<Dialog
  open={Boolean(renameTarget)}
  title="Rename conversation"
  description="Change the name shown in the sidebar and tabs."
  size="sm"
  onOpenChange={onRenameOpenChange}
>
  <div class="grid gap-2">
    <Label for="conversation-title">Name</Label>
    <Input
      id="conversation-title"
      bind:value={title}
      maxlength={200}
      disabled={busy}
      onkeydown={(event) => {
        if (event.key === "Enter") void submitRename();
      }}
    />
    {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
  </div>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onclick={() => onRenameOpenChange?.(false)}>Cancel</Button
    >
    <Button
      size="sm"
      disabled={busy || !title.trim()}
      onclick={() => void submitRename()}>{busy ? "Saving…" : "Save"}</Button
    >
  {/snippet}
</Dialog>

<Dialog
  open={Boolean(moveTarget)}
  title="Move conversation"
  description="The conversation ID and complete chat history stay unchanged."
  size="sm"
  onOpenChange={onMoveOpenChange}
>
  <div class="grid gap-2">
    <Label>Destination project</Label>
    <SelectField
      items={moveItems}
      bind:value={targetProjectId}
      placeholder="Select a project"
      ariaLabel="Destination project"
      disabled={busy}
    />
    {#if moveItems.length === 0}
      <p class="text-xs text-muted-foreground">
        Open another project before moving this conversation.
      </p>
    {/if}
    {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
  </div>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onclick={() => onMoveOpenChange?.(false)}>Cancel</Button
    >
    <Button
      size="sm"
      disabled={busy || !targetProjectId}
      onclick={() => void submitMove()}>{busy ? "Moving…" : "Move"}</Button
    >
  {/snippet}
</Dialog>
