<script lang="ts">
import Download from "@lucide/svelte/icons/download";
import FileCode from "@lucide/svelte/icons/file-code";
import FileJson from "@lucide/svelte/icons/file-json";
import FileText from "@lucide/svelte/icons/file-text";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import type { Component } from "svelte";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import type { ConversationRecord } from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import { fetchContextResource } from "./context-export";

let {
  activeConversation,
  exportUrl,
  systemPromptUrl,
}: {
  activeConversation?: ConversationRecord;
  exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
  systemPromptUrl?: () => string | undefined;
} = $props();

type ExportEntry = {
  id: string;
  label: string;
  icon: Component;
  action: "copy" | "download";
  href?: string;
  filename?: string;
  resultLabel: string;
};

const entries = $derived.by<ExportEntry[]>(() => {
  if (!activeConversation) return [];
  const id = activeConversation.id;
  return [
    {
      id: "copy-md",
      label: "Copy Markdown",
      icon: FileText,
      action: "copy",
      href: exportUrl?.("md"),
      resultLabel: "Markdown context",
    },
    {
      id: "copy-system-prompt",
      label: "Copy system prompt",
      icon: ScrollText,
      action: "copy",
      href: systemPromptUrl?.(),
      resultLabel: "system prompt",
    },
    {
      id: "download-json",
      label: "Download JSON",
      icon: FileJson,
      action: "download",
      href: exportUrl?.("json"),
      filename: `conversation-${id}.json`,
      resultLabel: "JSON export",
    },
    {
      id: "download-md",
      label: "Download Markdown",
      icon: FileText,
      action: "download",
      href: exportUrl?.("md"),
      filename: `conversation-${id}.md`,
      resultLabel: "Markdown export",
    },
    {
      id: "download-html",
      label: "Download HTML",
      icon: FileCode,
      action: "download",
      href: exportUrl?.("html"),
      filename: `conversation-${id}.html`,
      resultLabel: "HTML export",
    },
  ];
});

async function copy(entry: ExportEntry): Promise<void> {
  if (!entry.href) return;
  const response = await fetchContextResource(entry.href);
  await writeClipboardText(await response.text());
}

async function download(entry: ExportEntry): Promise<void> {
  if (!entry.href || !entry.filename) return;
  const response = await fetchContextResource(entry.href);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = entry.filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function run(entry: ExportEntry): Promise<void> {
  try {
    if (entry.action === "copy") {
      await copy(entry);
      notify.success(`Copied ${entry.resultLabel}`);
    } else {
      await download(entry);
      notify.success(`Downloaded ${entry.resultLabel}`);
    }
  } catch {
    notify.error(
      entry.action === "copy"
        ? "Could not copy context"
        : "Could not download context",
    );
  }
}
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
    aria-label="Copy or export context"
    title="Copy or export context"
    disabled={!activeConversation}
  >
    <Download class="size-4" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-48">
    {#each entries as entry, index (entry.id)}
      {#if index === 2}<DropdownMenu.Separator />{/if}
      {@const Icon = entry.icon}
      <DropdownMenu.Item
        disabled={!entry.href}
        onSelect={() => void run(entry)}
      >
        <Icon />
        <span>{entry.label}</span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
