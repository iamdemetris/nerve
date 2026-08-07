<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { refreshAvailableModels } from "$lib/features/auth/state/auth.svelte";
</script>

<Button
  size="sm"
  variant="outline"
  disabled={authState.modelsRefreshing}
  onclick={() => void refreshAvailableModels()}
>
  <RefreshCw
    class={authState.modelsRefreshing ? "size-3.5 spin" : "size-3.5"}
    aria-hidden="true"
  />
  {authState.modelsRefreshing ? "Refreshing…" : "Refresh models"}
</Button>
