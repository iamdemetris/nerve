<script lang="ts">
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import type { TaskLogQueryResponse, TaskRecord } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { taskTone } from "@nervekit/ui-kit/core/utils/status";
import {
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panel";
import TaskLogTerminal from "./TaskLogTerminal.svelte";

type Props = {
  projectName?: string;
  projectCwd?: string;
  tasks?: readonly TaskRecord[];
  selectedTask?: TaskRecord;
  taskLogs?: TaskLogQueryResponse;
  onSelectTask?: (taskId: string) => void | Promise<void>;
  onRunCommand?: (command: string) => void | Promise<unknown>;
  onCancelTask?: (taskId: string) => void | Promise<void>;
  onRestartTask?: (taskId: string) => void | Promise<void>;
  onLoadEarlier?: (taskId: string) => void | Promise<void>;
};

let {
  projectName,
  projectCwd,
  tasks = [],
  selectedTask,
  taskLogs,
  onSelectTask,
  onRunCommand,
  onCancelTask,
  onRestartTask,
  onLoadEarlier,
}: Props = $props();

let command = $state("");
let starting = $state(false);
let commandError = $state<string | undefined>();
let historyIndex = $state(-1);

const activeStatuses = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
  "recovered",
]);
const sortedTasks = $derived(
  [...tasks].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  ),
);
const selected = $derived(
  selectedTask && sortedTasks.some((task) => task.id === selectedTask.id)
    ? selectedTask
    : sortedTasks[0],
);
const selectedLogs = $derived(
  taskLogs?.task.id === selected?.id ? taskLogs : undefined,
);
const selectedIsActive = $derived(
  Boolean(selected && activeStatuses.has(selected.status)),
);
const taskItems = $derived(
  sortedTasks.map((task) => ({
    value: task.id,
    label: task.displayName ?? task.name ?? task.command,
    detail: `${task.status} · ${new Date(task.startedAt).toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      },
    )}`,
  })),
);
const commandHistory = $derived([
  ...new Set(sortedTasks.map((task) => task.command)),
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runCommand(): Promise<void> {
  const next = command.trim();
  if (!next || !projectCwd || !onRunCommand || starting) return;
  starting = true;
  commandError = undefined;
  try {
    await onRunCommand(next);
    command = "";
    historyIndex = -1;
  } catch (error) {
    commandError = errorMessage(error);
  } finally {
    starting = false;
  }
}

function navigateHistory(event: KeyboardEvent): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  if (commandHistory.length === 0) return;
  event.preventDefault();
  if (event.key === "ArrowUp") {
    historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
    command = commandHistory[historyIndex] ?? command;
    return;
  }
  historyIndex = Math.max(historyIndex - 1, -1);
  command = historyIndex === -1 ? "" : (commandHistory[historyIndex] ?? "");
}
</script>

<PanelView scroll={false} padded={false}>
  {#snippet toolbar()}
    <PanelHeader title="Terminal" count={sortedTasks.length || undefined}>
      {#snippet trailing()}
        {#if selected}
          <Badge tone={taskTone(selected.status)} size="xs"
            >{selected.status}</Badge
          >
          {#if selectedIsActive}
            <PanelToolbarButton
              icon={Square}
              label="Stop command"
              disabled={!onCancelTask || selected.status === "stopping"}
              onclick={() => void onCancelTask?.(selected.id)}
            />
          {:else}
            <PanelToolbarButton
              icon={RotateCw}
              label="Run command again"
              disabled={!onRestartTask}
              onclick={() => void onRestartTask?.(selected.id)}
            />
          {/if}
        {/if}
      {/snippet}
    </PanelHeader>
  {/snippet}

  {#if !projectCwd}
    <div class="grid min-h-0 flex-1 place-content-center">
      <PanelEmpty
        icon={Terminal}
        title="No project selected"
        description="Select a project to open its terminal."
      />
    </div>
  {:else}
    {#if sortedTasks.length > 0}
      <div class="shrink-0 border-b border-border/60 py-1.5">
        <SelectField
          value={selected?.id ?? ""}
          ariaLabel="Terminal session"
          items={taskItems}
          triggerClass="h-7 font-mono text-xs"
          contentClass="max-w-[min(28rem,calc(100vw-2rem))]"
          onValueChange={(taskId) => void onSelectTask?.(taskId)}
        />
      </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden py-2">
      {#if selected}
        <div class="h-full min-h-0 overflow-hidden rounded-md border">
          <TaskLogTerminal
            taskId={selected.id}
            taskLogs={selectedLogs}
            command={selected.command}
            onLoadEarlier={() => onLoadEarlier?.(selected.id)}
          />
        </div>
      {:else}
        <div
          class="grid h-full min-h-0 place-content-center rounded-md border bg-sidebar"
        >
          <PanelEmpty
            icon={Terminal}
            title="Ready"
            description="Run a command below to start a terminal session."
          />
        </div>
      {/if}
    </div>

    <form
      class="grid shrink-0 gap-1.5 border-t border-border/60 py-2"
      title={`Commands run in ${projectCwd}`}
      onsubmit={(event) => {
        event.preventDefault();
        void runCommand();
      }}
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0 font-mono text-xs text-primary">$</span>
        <Input
          bind:value={command}
          size="xs"
          class="font-mono"
          placeholder="pnpm dev"
          ariaLabel={`Command for ${projectName ?? "project"}`}
          autocomplete="off"
          spellcheck={false}
          disabled={starting}
          onkeydown={navigateHistory}
          oninput={() => (historyIndex = -1)}
        />
        <Button
          type="submit"
          size="icon-xs"
          ariaLabel="Run command"
          title="Run command"
          disabled={starting || command.trim().length === 0}
        >
          <Play aria-hidden="true" />
        </Button>
      </div>
      {#if commandError}
        <p class="text-xs text-destructive">{commandError}</p>
      {:else}
        <p class="truncate text-xs text-muted-foreground">{projectCwd}</p>
      {/if}
    </form>
  {/if}
</PanelView>
