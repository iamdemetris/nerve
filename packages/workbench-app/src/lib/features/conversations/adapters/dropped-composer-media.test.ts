import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composerDropOverlayLabel,
  isImageFile,
  partitionDroppedFiles,
} from "./dropped-composer-media";

function file(name: string, type = ""): File {
  return { name, type } as File;
}

describe("dropped composer media", () => {
  it("detects image MIME types", () => {
    assert.equal(isImageFile(file("a.png", "image/png")), true);
    assert.equal(isImageFile(file("a.webp", "image/webp")), true);
    assert.equal(isImageFile(file("a.txt", "text/plain")), false);
    assert.equal(isImageFile(file("no-type")), false);
  });

  it("partitions images from path candidates", () => {
    const files = [
      file("shot.png", "image/png"),
      file("notes.md", "text/markdown"),
      file("diagram.jpg", "image/jpeg"),
      file("folder"),
    ];
    const { imageFiles, pathFiles } = partitionDroppedFiles(files);
    assert.deepEqual(
      imageFiles.map((entry) => entry.name),
      ["shot.png", "diagram.jpg"],
    );
    assert.deepEqual(
      pathFiles.map((entry) => entry.name),
      ["notes.md", "folder"],
    );
  });

  it("picks overlay copy from supported drop modes", () => {
    assert.equal(
      composerDropOverlayLabel({ imageDrop: true, pathDrop: true }),
      "Drop images for the model, or files/folders for path mentions",
    );
    assert.equal(
      composerDropOverlayLabel({ imageDrop: true, pathDrop: false }),
      "Drop images to attach for the selected model",
    );
    assert.equal(
      composerDropOverlayLabel({ imageDrop: false, pathDrop: true }),
      "Drop files or folders to add their paths",
    );
  });
});
