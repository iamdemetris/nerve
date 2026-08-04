---
title: Add images and voice
description: Paste or drop images and transcribe voice into a prompt.
sidebar:
  order: 3
---

## Paste or drop an image

When the **selected model accepts image input** (its catalog `input` includes `image`), you can add images from the composer in two ways:

1. **Paste** — copy an image and press `Ctrl/Cmd+V` in the composer.
2. **Drop** — drag one or more image files onto the composer text area.

Nerve intercepts `image/*` files, stores each under the OS temp directory in `nerve/`, and inserts the resulting local paths at the cursor. Accepted MIME families include PNG, JPEG, GIF, WebP, SVG, BMP, TIFF, and AVIF. The path lets the agent's file-reading pipeline send image content to the model.

Image paste and image drop are **disabled for text-only models**. Switch to a vision-capable model to enable them. Temporary paths are not durable project attachments, and the UI does not promise a file-size or decoded-signature validation boundary.

Dropping **non-image** files or folders on desktop still inserts path mentions only (no copy/upload). See [Use the composer](/guides/composer/#drop-files-and-folders). Mixed drops attach supported images and resolve other items as path mentions when the desktop path bridge is available.

## Record voice

Use the microphone control or its keyboard shortcut. Recording can target the main composer or a user-question reply. Nerve shares one recording session across those surfaces.

- Maximum duration: 8 minutes.
- Maximum upload: 25 MB.
- Client transcription retries: up to 3.
- Right-click an active recording to cancel it.

The transcript is appended to the current draft; it is not sent automatically.

Voice requires OpenAI Codex/ChatGPT OAuth and uploads audio to ChatGPT's audio transcription endpoint using `gpt-4o-transcribe`. An OpenAI API key alone is not sufficient. Common WebM, MP4/M4A, WAV, MPEG/MP3, OGG, and FLAC recordings are accepted.

## Next steps

- [Model usage, images, and voice](/models/usage-images-voice/)
- [Provider troubleshooting](/troubleshooting/providers/)
