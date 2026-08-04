<script lang="ts">
import type { LatestRelease } from "@nervekit/contracts";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import { displayVersion, isVersionOutdated } from "$lib/features/releases";

type Props = {
  currentVersion: string;
  latestRelease?: LatestRelease;
};

let { currentVersion, latestRelease }: Props = $props();

const currentLabel = $derived(displayVersion(currentVersion));
const latestLabel = $derived(
  latestRelease ? displayVersion(latestRelease.version) : undefined,
);
const outdated = $derived(
  isVersionOutdated(currentVersion, latestRelease?.version),
);
const accessibleLabel = $derived(
  outdated && latestLabel
    ? `Custom Nerve build ${currentLabel}; upstream release available: ${latestLabel}`
    : latestLabel
      ? `Custom Nerve build ${currentLabel}; no newer upstream release detected`
      : `Custom Nerve build ${currentLabel}; upstream release check unavailable`,
);
</script>

<span
  class={`version-indicator inline-flex ${outdated ? "" : "max-sm:hidden"}`}
>
  <Popover
    ariaLabel={accessibleLabel}
    side="bottom"
    align="end"
    size="md"
    triggerClass={`cursor-pointer rounded-sm border border-border bg-transparent px-1.5 py-0.5 font-mono text-xs font-medium leading-none text-muted-foreground transition-colors hover:bg-accent ${outdated ? "is-outdated" : ""}`}
  >
    {#snippet trigger()}{currentLabel}{/snippet}

    <PopoverBody>
      <PopoverHeader title={`Custom build ${currentLabel}`}>
        {#snippet action()}
          {#if latestLabel && latestRelease}
            <a
              href={latestRelease.releaseUrl}
              target="_blank"
              rel="noreferrer"
              class="flex-none cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
              >Review upstream {latestLabel}</a
            >
          {/if}
        {/snippet}
      </PopoverHeader>

      {#if outdated && latestLabel && latestRelease}
        <p class="text-warning">
          Upstream {latestLabel} is available. Integrate it into your fork so your
          customizations are preserved.
        </p>
        <PopoverSection separated>
          <span class="font-medium text-foreground">Safe update workflow</span>
          <ol class="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Commit your custom changes.</li>
            <li>Merge the upstream release into your fork.</li>
            <li>Test, then rebuild and install the custom Mac app.</li>
          </ol>
        </PopoverSection>
        <span class="text-muted-foreground"
          >The upstream package is not installed automatically.</span
        >
      {:else if latestLabel}
        <p class="text-muted-foreground">
          This custom build is based on the latest upstream stable release.
        </p>
      {:else}
        <p class="text-muted-foreground">
          The upstream release could not be checked. This custom build will not
          be replaced automatically.
        </p>
      {/if}
    </PopoverBody>
  </Popover>
</span>

<style>
/* The Bits UI trigger is rendered by PopoverPanel, so it cannot be reached by
 * this component's scoping. Keep the reach-in confined to the local wrapper.
 * The outdated fill is an opaque two-token mix (escape-hatch reason 8) and has
 * no Tailwind opacity equivalent. */
.version-indicator :global(.popover-trigger.is-outdated) {
  border-color: var(--warning);
  background: color-mix(in oklab, var(--warning) 10%, var(--card));
  color: var(--warning);
}

.version-indicator :global(.popover-trigger.is-outdated:hover) {
  background: color-mix(in oklab, var(--warning) 16%, var(--card));
}
</style>
