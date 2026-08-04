/**
 * Composer drop media helpers.
 *
 * Image drops (for vision-capable models) are uploaded to a temporary path,
 * matching clipboard paste. Non-image drops remain path mentions on desktop.
 */

export function isImageFile(file: File): boolean {
  return typeof file.type === "string" && file.type.startsWith("image/");
}

export function partitionDroppedFiles(files: readonly File[]): {
  imageFiles: File[];
  pathFiles: File[];
} {
  const imageFiles: File[] = [];
  const pathFiles: File[] = [];
  for (const file of files) {
    if (isImageFile(file)) imageFiles.push(file);
    else pathFiles.push(file);
  }
  return { imageFiles, pathFiles };
}

/** Overlay copy for the composer drop target based on what the host supports. */
export function composerDropOverlayLabel(options: {
  imageDrop: boolean;
  pathDrop: boolean;
}): string {
  if (options.imageDrop && options.pathDrop) {
    return "Drop images for the model, or files/folders for path mentions";
  }
  if (options.imageDrop) {
    return "Drop images to attach for the selected model";
  }
  return "Drop files or folders to add their paths";
}
