export * from "./api/projects.api";
export { default as ConversationsPanelView } from "./components/ConversationsPanelView.svelte";
export {
  projectActivityIndicator,
  summarizeProjectActivity,
} from "./state/project-switcher";
export type {
  ProjectActivityIndicator,
  ProjectActivitySummary,
} from "./state/project-switcher";
export {
  focusProjectSearch,
  projectNavigatorSignals,
} from "./state/project-navigator-signals.svelte";
