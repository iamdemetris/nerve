<script lang="ts">
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import {
  closeDesktopWindow,
  desktopRuntime,
  desktopShutdownState,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "$lib/features/desktop";
import { openAuthPane } from "$lib/features/auth";
import { releaseState } from "$lib/features/releases";
import { openLogsPane } from "$lib/features/logs";
import { openSettingsPane, settingsSelectors } from "$lib/features/settings";
import { workspaceSelectors, workspaceState } from "$lib/features/workspace";

const status = $derived(workspaceSelectors.status);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const desktopQuitting = $derived(
  desktopRuntime.quitting || desktopShutdownState.quitRequested,
);

async function handleDesktopClose() {
  const closeToTray = settingsDraft?.desktop.closeToTray ?? true;
  if (!closeToTray) {
    desktopShutdownState.quitRequested = true;
    desktopRuntime.quitting = true;
  }
  try {
    await closeDesktopWindow({ closeToTray });
  } catch (caught) {
    if (!closeToTray) {
      desktopShutdownState.quitRequested = false;
      desktopRuntime.quitting = false;
    }
    workspaceState.error =
      caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<Titlebar
  desktop={desktopRuntime.isDesktop}
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  authActive={activeCenterTab?.kind === "auth"}
  logsActive={activeCenterTab?.kind === "logs"}
  applicationLogsEnabled={status?.capabilities.applicationLogs ?? false}
  currentVersion={status?.version}
  latestRelease={releaseState.latest}
  onOpenLogs={() => openLogsPane()}
  onOpenAuth={() => openAuthPane()}
  onOpenSettings={() => void openSettingsPane()}
  onMinimize={() => void minimizeDesktopWindow()}
  onToggleMaximize={() => void toggleMaximizeDesktopWindow()}
  onClose={() => void handleDesktopClose()}
/>
