<script lang="ts">
import type {
  ModelInfo,
  ServiceTier,
  ThinkingLevel,
} from "@nervekit/contracts";
import Popover, {
  PopoverBody,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import { contextualModelLabel, modelKey } from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
} from "$lib/presentation/utils/model-catalog";

type Props = {
  models?: ModelInfo[];
  selectedModelKey?: string;
  thinkingLevel?: ThinkingLevel;
  serviceTier?: ServiceTier;
  disabled?: boolean;
  shortcutLabel?: string;
  runtimeChangeHint?: string;
  emptyMessage?: string;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onServiceTierChange?: (value: ServiceTier) => void;
};

let {
  models = [],
  selectedModelKey = "",
  thinkingLevel = "off",
  serviceTier = "default",
  disabled = false,
  shortcutLabel,
  runtimeChangeHint,
  emptyMessage = "No models available. Configure a provider or adjust Scoped Models in Settings.",
  onModelChange,
  onThinkingLevelChange,
  onServiceTierChange,
}: Props = $props();

const SEARCH_THRESHOLD = 10;

let open = $state(false);
let query = $state("");
let providerFilter = $state("all");

const catalog = $derived(buildModelCatalog(models));
const providerChips = $derived(modelProviderFacets(catalog));
const filteredModels = $derived(
  filterModelCatalog(
    catalog,
    models.length > SEARCH_THRESHOLD ? query : "",
    models.length > SEARCH_THRESHOLD ? providerFilter : "all",
  ),
);
const selectedModel = $derived(
  models.find((model) => modelKey(model) === selectedModelKey),
);

const thinkingLevelDetails: Record<ThinkingLevel, string> = {
  off: "No reasoning",
  minimal: "Very brief reasoning",
  low: "Light reasoning",
  medium: "Moderate reasoning",
  high: "Deep reasoning",
  xhigh: "Extra-high reasoning",
  max: "Maximum reasoning",
};

function thinkingLevelLabel(level: ThinkingLevel): string {
  return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
}

function thinkingLevelShortLabel(level: ThinkingLevel): string {
  switch (level) {
    case "minimal":
      return "Mi";
    case "low":
      return "L";
    case "medium":
      return "M";
    case "high":
      return "H";
    case "xhigh":
      return "XH";
    case "max":
      return "Max";
    case "off":
    default:
      return "Off";
  }
}

const thinkingLevels = $derived<ThinkingLevel[]>(
  selectedModel?.supportedThinkingLevels?.length
    ? selectedModel.supportedThinkingLevels
    : ["off"],
);

const hasThinking = $derived(thinkingLevels.length > 1);
/** OpenAI Responses / Codex Responses: Standard vs Fast service tier. */
const hasServiceTier = $derived(Boolean(selectedModel?.supportsServiceTier));

const serviceTierLabel = $derived(
  serviceTier === "priority" ? "Fast" : "Standard",
);

const triggerLabel = $derived(
  selectedModel ? contextualModelLabel(selectedModel, models) : "Select model",
);
const triggerSuffixParts = $derived.by(() => {
  const parts: string[] = [];
  if (hasThinking && thinkingLevel !== "off") {
    parts.push(thinkingLevelLabel(thinkingLevel));
  }
  if (hasServiceTier && serviceTier === "priority") {
    parts.push(serviceTierLabel);
  }
  return parts;
});
const triggerSuffix = $derived(
  triggerSuffixParts.length > 0 ? triggerSuffixParts.join(" · ") : undefined,
);
const triggerShortSuffixParts = $derived.by(() => {
  const parts: string[] = [];
  if (hasThinking && thinkingLevel !== "off") {
    parts.push(thinkingLevelShortLabel(thinkingLevel));
  }
  if (hasServiceTier && serviceTier === "priority") {
    parts.push("F");
  }
  return parts;
});
const triggerShortSuffix = $derived(
  triggerShortSuffixParts.length > 0
    ? triggerShortSuffixParts.join("·")
    : undefined,
);
const triggerTitle = $derived(
  `${triggerSuffix ? `${triggerLabel} (${triggerSuffix})` : triggerLabel}${runtimeChangeHint ? ` · ${runtimeChangeHint}` : ""}${shortcutLabel ? ` · Cycle thinking ${shortcutLabel}` : ""}`,
);

function handleOpenChange(next: boolean) {
  open = disabled ? false : next;
  if (open) {
    query = "";
    providerFilter = "all";
  }
}

function selectModel(model: ModelInfo) {
  if (disabled) return;
  const key = modelKey(model);
  if (key !== selectedModelKey) onModelChange?.(key);
}

function selectThinking(level: ThinkingLevel) {
  if (disabled) return;
  if (level !== thinkingLevel) onThinkingLevelChange?.(level);
}

function selectServiceTier(tier: ServiceTier) {
  if (disabled) return;
  if (tier !== serviceTier) onServiceTierChange?.(tier);
}

$effect(() => {
  if (disabled) open = false;
});
</script>

<Popover
  {open}
  onOpenChange={handleOpenChange}
  size="lg"
  triggerClass="composer-tab model-tab"
  ariaLabel="Model and thinking level"
  {triggerTitle}
  side="top"
  align="end"
  sideOffset={9}
>
  {#snippet trigger()}
    <span class="model-tab-inner" class:disabled aria-disabled={disabled}>
      <span class="model-tab-label">{triggerLabel}</span>
      {#if triggerSuffix}<span class="model-tab-suffix">({triggerSuffix})</span
        >{/if}
      {#if triggerShortSuffix}<span class="model-tab-short-suffix"
          >({triggerShortSuffix})</span
        >{/if}
    </span>
  {/snippet}

  <PopoverBody>
    <PopoverSection label="Model">
      {#if models.length === 0}
        <p class="text-muted-foreground">{emptyMessage}</p>
      {:else}
        <div class="grid gap-2">
          {#if models.length > SEARCH_THRESHOLD}
            <SearchInput
              bind:value={query}
              placeholder="Search models"
              ariaLabel="Search models"
            />
            {#if providerChips.length > 2}
              <div
                class="w-full min-w-0 overflow-x-auto overflow-y-hidden pb-1.5 overscroll-x-contain"
              >
                <ToggleGroup.Root
                  type="single"
                  size="xs"
                  spacing={1}
                  variant="outline"
                  value={providerFilter}
                  aria-label="Filter by provider"
                  class="w-max min-w-full flex-nowrap justify-start"
                  onValueChange={(value) => {
                    if (value) providerFilter = value;
                  }}
                >
                  {#each providerChips as chip (chip.id)}
                    <ToggleGroup.Item
                      value={chip.id}
                      class="flex-none gap-1.5 text-xs"
                    >
                      {chip.label}
                      <span class="text-muted-foreground">{chip.count}</span>
                    </ToggleGroup.Item>
                  {/each}
                </ToggleGroup.Root>
              </div>
            {/if}
          {/if}
          {#if filteredModels.length === 0}
            <p class="text-muted-foreground">No models match.</p>
          {:else}
            <VirtualScroller
              items={filteredModels}
              getKey={(entry) => entry.key}
              estimateSize={() => 36}
              gap={6}
              viewportClass="max-h-[min(36vh,14rem)]"
              viewportAriaLabel="Available models"
            >
              {#snippet row({ item: entry })}
                <PopoverRow
                  label={entry.contextualLabel}
                  selected={entry.key === selectedModelKey}
                  {disabled}
                  onclick={() => selectModel(entry.model)}
                />
              {/snippet}
            </VirtualScroller>
          {/if}
        </div>
      {/if}
    </PopoverSection>

    {#if hasThinking}
      <PopoverSection label="Thinking level" separated>
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="outline"
          value={thinkingLevel}
          aria-label="Thinking level"
          class="flex-wrap justify-start"
          onValueChange={(value) => {
            if (value) selectThinking(value as ThinkingLevel);
          }}
        >
          {#each thinkingLevels as level (level)}
            <ToggleGroup.Item
              value={level}
              class="flex-none rounded-full text-xs data-[state=on]:text-primary"
              title={thinkingLevelDetails[level]}
              {disabled}
            >
              {thinkingLevelLabel(level)}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </PopoverSection>
    {/if}

    {#if hasServiceTier}
      <PopoverSection label="Service tier" separated>
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="outline"
          value={serviceTier}
          aria-label="Service tier"
          class="flex-wrap justify-start"
          onValueChange={(value) => {
            if (value) selectServiceTier(value as ServiceTier);
          }}
        >
          <ToggleGroup.Item
            value="default"
            class="flex-none rounded-full text-xs data-[state=on]:text-primary"
            title="Standard latency and capacity"
            {disabled}
          >
            Standard
          </ToggleGroup.Item>
          <ToggleGroup.Item
            value="priority"
            class="flex-none rounded-full text-xs data-[state=on]:text-primary"
            title="Faster responses via priority service tier (higher cost)"
            {disabled}
          >
            Fast
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </PopoverSection>
    {/if}
  </PopoverBody>
</Popover>

<style>
.model-tab-inner {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: clamp(7rem, 22vw, 16rem);
  color: inherit;
}

.model-tab-inner.disabled {
  opacity: 0.55;
}

.model-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tab-suffix,
.model-tab-short-suffix {
  flex: none;
  color: var(--muted-foreground);
}

.model-tab-short-suffix {
  display: none;
}

@media (max-width: 639px) {
  .model-tab-inner {
    max-width: clamp(5.75rem, 34vw, 9rem);
    gap: 0.22rem;
  }

  .model-tab-suffix {
    display: none;
  }

  .model-tab-short-suffix {
    display: inline;
  }
}
</style>
