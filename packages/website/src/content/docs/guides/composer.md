---
title: Use the composer
description: Send, stop, steer, complete commands and project paths, and monitor context.
sidebar:
  order: 2
---

The composer is the main control surface for a conversation. It combines a Markdown-oriented editor with run controls, model/mode/permission selectors, context usage, to-dos, suggestions, file and folder path mentions, clipboard images, and voice.

## Send and stop

`Enter` and `Ctrl/Cmd+Enter` submit unless a completion menu is open. A new idle conversation starts a run. During an active turn, a normal prompt becomes a steering message and appears as a queued row in the transcript.

A queued prompt can be discarded or **Cancel & Edit**-ed back into the composer. Inline command prompts cannot queue. Stop targets the exact active run; Nerve suppresses duplicate stops and reconciles late completion events.

## Completions

Type `/` to filter available inline commands. Type `@` to search files and directories in the current project. At most 80 completion options are shown.

`@` is project path completion—not a mention system for people, agents, or conversations.

## Drop files, folders, and images

**Images (vision-capable models):** drag image files onto the composer. Nerve uploads them to a temporary local path (same as clipboard paste) and inserts those paths. Available in desktop and browser when the selected model’s catalog includes image input. Text-only models do not accept image drops.

**Other files and folders (desktop):** drag non-image items onto the composer to insert path mentions at the current selection. Items inside the active project use project-relative paths, the project root becomes `.`, and items outside the project keep absolute paths. Multiple paths preserve their order, and paths containing whitespace are quoted. Path mentions require Electron’s native path bridge and are not available in a normal browser or installed PWA—use `@` completion there for project paths.

Dropped path mentions remain editable and are sent only when you submit the prompt. Path drops do not copy or upload items; image drops create temporary paths for the vision pipeline only, not durable project attachments.

## Suggestions

Contextual prompt chips appear above the editor. Selecting one inserts or sends reusable content, depending on the suggestion. Built-ins cover common Git follow-ups; user and project definitions can add more.

## Context and to-dos

The toolbar displays current context-window pressure and cumulative usage when the provider reports it. A context value can remain unknown until a response. The to-do indicator reflects structured agent work state; it is separate from supervised background processes.

## Review gates

A pending approval, question, or plan review disables normal composition. Resolve the card in the transcript. This keeps the decision associated with the exact tool or plan that requested it.

:::note
Non-image drops are path mentions, not uploads. Image paste and image drop (vision models only) create temporary local paths for the model’s image pipeline.
:::

## Next steps

- [Images and voice](/guides/images-and-voice/)
- [Agent controls](/guides/agent-controls/)
- [Prompt suggestions](/guides/prompt-suggestions/)
