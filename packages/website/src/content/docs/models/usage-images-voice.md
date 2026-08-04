---
title: Usage, images, and voice
description: Interpret model usage and understand media capability limits.
sidebar:
  order: 4
---

## Conversation usage

When providers return usage events, the composer can show cumulative input/output tokens, cache activity, estimated cost, and current context fraction. Unknown values remain unknown rather than being guessed.

These figures are operational estimates, not invoices. Provider accounting, cache rules, discounts, and subscription terms remain authoritative.

## Subscription windows

Nerve currently retrieves subscription usage snapshots only for OAuth Anthropic and OpenAI Codex. Refresh attempts are debounced per provider. This is separate from cumulative conversation usage and does not track general API-key billing.

## Image input

Model catalog entries declare accepted modalities via `input` (for example `["text", "image"]`). When the selected model includes `image`, the composer enables **clipboard paste** and **drag-and-drop** of image files. Both store a temporary local path under the OS temp directory and insert it into the draft. Text-only models keep image paste/drop disabled so a non-vision model is not sent unsupported media.

See [Images and voice](/guides/images-and-voice/) for details. Temporary image paths are not durable project attachments.

## Voice input

Voice capture happens in the browser/Electron renderer, then uploads to ChatGPT's transcription endpoint. It requires OpenAI Codex OAuth with an account ID and uses `gpt-4o-transcribe`.

Limits are 8 minutes and 25 MB, with three client retry attempts. The transcript returns as editable text; audio is not added to the conversation as an attachment.

## Next steps

- [Connect a provider](/start/providers/)
- [Composer media guide](/guides/images-and-voice/)
