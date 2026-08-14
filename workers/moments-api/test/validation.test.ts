import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectMetadataFreeWebp,
  MAX_PHOTO_BYTES,
  validateFileMagic,
  validateUploadInit,
} from "../src/validation.ts";
import { testEnv } from "./helpers.ts";

function webp(width = 600, height = 400, metadataChunk?: "EXIF" | "XMP " | "META"): Uint8Array {
  const chunks: number[] = [];
  const pushAscii = (value: string) => chunks.push(...[...value].map((character) => character.charCodeAt(0)));
  pushAscii("VP8X");
  chunks.push(10, 0, 0, 0, 0, 0, 0, 0);
  const w = width - 1;
  const h = height - 1;
  chunks.push(w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255);
  pushAscii("VP8 ");
  chunks.push(10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a);
  chunks.push(width & 255, (width >> 8) & 0x3f, height & 255, (height >> 8) & 0x3f);
  if (metadataChunk) {
    pushAscii(metadataChunk);
    chunks.push(4, 0, 0, 0, 1, 2, 3, 4);
  }
  const bytes = new Uint8Array(12 + chunks.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  const riffSize = bytes.length - 8;
  bytes.set([riffSize & 255, (riffSize >> 8) & 255, 0, 0], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(chunks, 12);
  return bytes;
}

test("init validation normalizes photo metadata and rejects MIME/extension mismatch", () => {
  const valid = validateUploadInit(
    {
      guestName: "  Nadia  ",
      caption: " hello ",
      files: [{ clientFileId: "one", fileName: "IMG.JPG", fileSize: 10, mimeType: "image/jpg" }],
    },
    testEnv(),
  );
  assert.equal(valid.files[0]?.mimeType, "image/jpeg");
  assert.equal(valid.guestName, "Nadia");
  assert.throws(() =>
    validateUploadInit(
      { guestName: "N", files: [{ clientFileId: "one", fileName: "x.png", fileSize: 10, mimeType: "image/jpeg" }] },
      testEnv(),
    ),
  );
});

test("oversized files and videos disabled are enforced server-side", () => {
  assert.throws(() =>
    validateUploadInit(
      { guestName: "N", files: [{ clientFileId: "one", fileName: "x.jpg", fileSize: MAX_PHOTO_BYTES + 1, mimeType: "image/jpeg" }] },
      testEnv(),
    ),
  );
  assert.throws(() =>
    validateUploadInit(
      { guestName: "N", files: [{ clientFileId: "one", fileName: "x.mp4", fileSize: 10, mimeType: "video/mp4" }] },
      testEnv(),
    ),
  );
});

test("init rejects database-invalid text before a Drive session can be opened", () => {
  const valid = {
    guestName: "Nadia \u{1f490}",
    caption: "A note\nwith two lines",
    files: [{ clientFileId: "one", fileName: "photo.jpg", fileSize: 10, mimeType: "image/jpeg" }],
  };
  assert.equal(validateUploadInit(valid, testEnv()).guestName, "Nadia \u{1f490}");

  for (const invalid of [
    { ...valid, guestName: "Nadia\u0000" },
    { ...valid, caption: `broken-${String.fromCharCode(0xd800)}` },
    { ...valid, files: [{ ...valid.files[0], fileName: "photo\u0000.jpg" }] },
  ]) {
    assert.throws(
      () => validateUploadInit(invalid, testEnv()),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_REQUEST",
    );
  }
});

test("magic validation rejects renamed data", () => {
  assert.equal(validateFileMagic(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"), true);
  assert.equal(validateFileMagic(new TextEncoder().encode("not a jpeg"), "image/jpeg"), false);
});

test("WebP derivative inspection verifies dimensions and rejects EXIF/XMP", () => {
  const valid = webp();
  assert.deepEqual(inspectMetadataFreeWebp(valid), { width: 600, height: 400 });
  assert.throws(() => inspectMetadataFreeWebp(webp(600, 400, "EXIF")));
  assert.throws(() => inspectMetadataFreeWebp(webp(600, 400, "XMP ")));
  assert.throws(() => inspectMetadataFreeWebp(webp(600, 400, "META")));
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  assert.throws(() => inspectMetadataFreeWebp(trailing));

  const inconsistent = valid.slice();
  inconsistent.fill(0, 24, 30);
  assert.throws(() => inspectMetadataFreeWebp(inconsistent));

  const adversarialOrder = valid.slice();
  adversarialOrder.set(valid.subarray(30, 48), 12);
  adversarialOrder.set(valid.subarray(12, 30), 30);
  assert.throws(() => inspectMetadataFreeWebp(adversarialOrder));
});
