<script lang="ts">
import { onMount } from "svelte";
import type { ProjectRecord, TaskLogQueryResponse, TaskRecord } from "$lib/api";
import { TerminalPanelView } from "$lib/presentation";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";

type Props = {
  activeProject?: ProjectRecord;
  tasks?: readonly TaskRecord[];
  selectedTask?: TaskRecord;
  taskLogs?: TaskLogQueryResponse;
  onSelectTask?: (taskId: string) => void | Promise<void>;
  onRunCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
  }) => void | Promise<unknown>;
  onCancelTask?: (taskId: string) => void | Promise<void>;
  onRestartTask?: (taskId: string) => void | Promise<void>;
  onLoadEarlier?: (taskId: string) => void | Promise<void>;
};

let {
  activeProject,
  tasks = [],
  selectedTask,
  taskLogs,
  onSelectTask,
  onRunCommand,
  onCancelTask,
  onRestartTask,
  onLoadEarlier,
}: Props = $props();

const preferredTask = $derived(
  selectedTask && tasks.some((task) => task.id === selectedTask.id)
    ? selectedTask
    : [...tasks].sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0],
);
let requestedTaskId = $state<string | undefined>();

function requestTask(taskId: string): void {
  if (requestedTaskId === taskId || !onSelectTask) return;
  requestedTaskId = taskId;
  void Promise.resolve(onSelectTask(taskId)).finally(() => {
    if (requestedTaskId === taskId) requestedTaskId = undefined;
  });
}

onMount(() => {
  taskState.terminalPanelVisible = true;
  if (preferredTask) requestTask(preferredTask.id);
  return () => {
    taskState.terminalPanelVisible = false;
  };
});

$effect(() => {
  const taskId = preferredTask?.id;
  if (!taskId || selectedTask?.id === taskId) {
    requestedTaskId = undefined;
    return;
  }
  requestTask(taskId);
});
</script>

<TerminalPanelView
  projectName={activeProject?.name}
  projectCwd={activeProject?.dir}
  {tasks}
  selectedTask={preferredTask}
  {taskLogs}
  {onSelectTask}
  onRunCommand={(command) => {
    if (!activeProject) return;
    return onRunCommand?.({
      projectId: activeProject.id,
      cwd: activeProject.dir,
      command,
    });
  }}
  {onCancelTask}
  {onRestartTask}
  {onLoadEarlier}
/>
