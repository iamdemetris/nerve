import { getProviderCatalog, refreshModels } from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { authState } from "./auth-state.svelte";

const AUTH_TAB = { kind: "auth" as const, id: "auth" as const };

export function openAuthPane() {
  addCenterTab(AUTH_TAB);
  setActiveCenterTab(AUTH_TAB);
  void loadAuthPanel();
}

export function selectCenterAuthTab() {
  addCenterTab(AUTH_TAB);
  setActiveCenterTab(AUTH_TAB);
  if (!authState.catalogLoaded) void loadAuthPanel();
}

export function closeAuthTab() {
  const closingActive = workspaceState.activeCenterTab?.kind === "auth";
  const fallback = nextCenterTabAfterClose(AUTH_TAB);
  removeCenterTab(AUTH_TAB);
  if (closingActive) void selectCenterTab(fallback);
}

/** Load the provider catalog and refresh shared provider/model state. */
export async function loadAuthPanel() {
  const [catalog] = await Promise.all([
    getProviderCatalog(),
    loadSettingsPanel(),
  ]);
  authState.customProviders = catalog.providers;
  authState.modelDefinitions = catalog.models;
  authState.catalogLoaded = true;
}

/** Refresh only the catalog (after a mutation); also refreshes providers. */
export async function refreshProviderCatalog() {
  const catalog = await getProviderCatalog();
  authState.customProviders = catalog.providers;
  authState.modelDefinitions = catalog.models;
  authState.catalogLoaded = true;
  await loadSettingsPanel();
}

export async function refreshAvailableModels(): Promise<void> {
  if (authState.modelsRefreshing) return;
  authState.modelsRefreshing = true;
  try {
    settingsState.models = await refreshModels();
    await loadAuthPanel();
    notify.success("Models refreshed");
  } catch (caught) {
    notify.error("Could not refresh models", {
      description: caught instanceof Error ? caught.message : String(caught),
    });
  } finally {
    authState.modelsRefreshing = false;
  }
}
