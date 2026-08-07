import type { CustomProvider, ModelDefinition } from "$lib/api";

export const authState = $state({
  authTabOpen: false,
  catalogLoaded: false,
  modelsRefreshing: false,
  customProviders: [] as CustomProvider[],
  modelDefinitions: [] as ModelDefinition[],
});
