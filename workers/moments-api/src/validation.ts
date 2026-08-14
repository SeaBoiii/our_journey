import { ApiError } from "./errors.ts";
import type {
  Env,
  InitFileInput,
  MediaType,
  UploadInitInput,
} from "./types.ts";

export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_FILES = 10;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const MAX_DERIVATIVE_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_GALLERY_BYTES = 5 * 1024 * 1024;

const PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export interface ValidatedInitFile extends InitFileInput {
  mimeType: string;
  mediaType: MediaType;
  extension: string;
}

export interface ValidatedUploadInit {
  guestName: string;
  caption: string;
  files: ValidatedInitFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isSafeText(value: string, allowLineBreaks: boolean): boolean {
  if (hasUnpairedSurrogate(value)) return false;
  const unsafeControls = allowLineBreaks
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  return !unsafeControls.test(value);
}

function fileExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function normaliseMimeType(raw: string): string {
  const mime = raw.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/heic-sequence") return "image/heic";
  if (mime === "image/heif-sequence") return "image/heif";
  return mime;
}

function validateInitFile(value: unknown, index: number, env: Env): ValidatedInitFile {
  if (!isRecord(value)) {
    throw new ApiError(400, "INVALID_REQUEST", "Each selected file needs metadata.");
  }

  const clientFileId = typeof value.clientFileId === "string" ? value.clientFileId.trim() : "";
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const fileSize = typeof value.fileSize === "number" ? value.fileSize : NaN;
  const declaredMime = typeof value.mimeType === "string" ? normaliseMimeType(value.mimeType) : "";
  const extension = fileExtension(fileName);
  const inferredMime = EXTENSION_TYPES[extension];
  const mimeType =
    !declaredMime || declaredMime === "application/octet-stream"
      ? inferredMime ?? ""
      : declaredMime;

  if (
    !clientFileId ||
    clientFileId.length > 100 ||
    !fileName ||
    fileName.length > 255 ||
    !isSafeText(clientFileId, false) ||
    !isSafeText(fileName, false)
  ) {
    throw new ApiError(400, "INVALID_REQUEST", "That file's metadata is not valid.", {
      details: { fileIndex: index },
    });
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new ApiError(400, "INVALID_REQUEST", "That file's size is not valid.", {
      details: { fileIndex: index },
    });
  }

  const mediaType: MediaType | null = PHOTO_TYPES.has(mimeType)
    ? "photo"
    : VIDEO_TYPES.has(mimeType)
      ? "video"
      : null;
  if (!mediaType || !inferredMime || inferredMime !== mimeType) {
    throw new ApiError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "That file type is not supported. Try a JPEG, PNG, WebP, HEIC, MP4, or MOV file.",
      { details: { fileIndex: index, fileName } },
    );
  }
  if (value.mediaType !== undefined && value.mediaType !== mediaType) {
    throw new ApiError(400, "INVALID_REQUEST", "That file's media type does not match.", {
      details: { fileIndex: index, fileName },
    });
  }
  if (mediaType === "video" && env.MOMENTS_ALLOW_VIDEOS !== "true") {
    throw new ApiError(400, "VIDEOS_DISABLED", "Video uploads are not available just yet.", {
      details: { fileIndex: index, fileName },
    });
  }

  const maximumBytes = mediaType === "video" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (fileSize > maximumBytes) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      "That file is a little too large to upload.",
      { details: { fileIndex: index, fileName, maximumBytes, actualBytes: fileSize } },
    );
  }

  return {
    clientFileId,
    fileName,
    fileSize,
    mimeType,
    mediaType,
    extension,
  };
}

export function validateUploadInit(value: unknown, env: Env): ValidatedUploadInit {
  if (!isRecord(value)) {
    throw new ApiError(400, "INVALID_REQUEST", "That upload request is not valid.");
  }

  const guestName = typeof value.guestName === "string" ? value.guestName.trim() : "";
  const caption = typeof value.caption === "string" ? value.caption.trim() : "";
  if (!guestName) {
    throw new ApiError(400, "GUEST_NAME_REQUIRED", "Please tell us your name before sharing your moment.");
  }
  if (
    guestName.length > 80 ||
    caption.length > 500 ||
    !isSafeText(guestName, false) ||
    !isSafeText(caption, true)
  ) {
    throw new ApiError(400, "INVALID_REQUEST", "The name or note is a little too long.");
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new ApiError(400, "NO_FILES", "Choose at least one photo to share.");
  }
  if (value.files.length > MAX_FILES) {
    throw new ApiError(400, "TOO_MANY_FILES", `Choose up to ${MAX_FILES} files at a time.`, {
      details: { maximumFiles: MAX_FILES },
    });
  }

  const files = value.files.map((file, index) => validateInitFile(file, index, env));
  if (new Set(files.map((file) => file.clientFileId)).size !== files.length) {
    throw new ApiError(400, "INVALID_REQUEST", "Each selected file needs a unique identifier.");
  }
  return { guestName, caption, files };
}

export function validateFileMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  if (mimeType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }

  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const brand = ascii(bytes, 8, 4);
  const compatible = ascii(bytes, 8, Math.min(bytes.length - 8, 64));
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].some(
      (candidate) => brand === candidate || compatible.includes(candidate),
    );
  }
  if (mimeType === "video/quicktime") return brand === "qt  ";
  if (mimeType === "video/mp4") {
    return ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "MSNV"].some(
      (candidate) => brand === candidate || compatible.includes(candidate),
    );
  }
  return false;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

export interface WebpInfo {
  width: number;
  height: number;
}

interface WebpChunk {
  type: "VP8X" | "ALPH" | "VP8 " | "VP8L";
  size: number;
  dataOffset: number;
}

function sameDimensions(left: WebpInfo, right: WebpInfo): boolean {
  return left.width === right.width && left.height === right.height;
}

function lossyWebpDimensions(bytes: Uint8Array, chunk: WebpChunk): WebpInfo | null {
  const offset = chunk.dataOffset;
  if (
    chunk.size < 10 ||
    bytes[offset + 3] !== 0x9d ||
    bytes[offset + 4] !== 0x01 ||
    bytes[offset + 5] !== 0x2a
  ) {
    return null;
  }
  return {
    width: (bytes[offset + 6]! | (bytes[offset + 7]! << 8)) & 0x3fff,
    height: (bytes[offset + 8]! | (bytes[offset + 9]! << 8)) & 0x3fff,
  };
}

function losslessWebpDimensions(bytes: Uint8Array, chunk: WebpChunk): WebpInfo | null {
  const offset = chunk.dataOffset;
  if (chunk.size < 5 || bytes[offset] !== 0x2f) return null;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const b3 = bytes[offset + 3]!;
  const b4 = bytes[offset + 4]!;
  return {
    width: 1 + b1 + ((b2 & 0x3f) << 8),
    height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
  };
}

export function inspectMetadataFreeWebp(bytes: Uint8Array): WebpInfo {
  if (!validateFileMagic(bytes, "image/webp")) {
    throw new ApiError(415, "DERIVATIVE_INVALID", "The gallery copy must be a WebP image.");
  }
  if (bytes.length < 12 || uint32le(bytes, 4) !== bytes.length - 8) {
    throw new ApiError(415, "DERIVATIVE_INVALID", "That WebP image is incomplete.");
  }

  let offset = 12;
  const chunks: WebpChunk[] = [];
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = uint32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + size + (size % 2);
    if (nextOffset > bytes.length) {
      throw new ApiError(415, "DERIVATIVE_INVALID", "That WebP image is incomplete.");
    }
    if (type !== "VP8X" && type !== "ALPH" && type !== "VP8 " && type !== "VP8L") {
      throw new ApiError(
        415,
        "DERIVATIVE_INVALID",
        "Gallery copies must not contain location or profile metadata.",
      );
    }
    chunks.push({ type, size, dataOffset });
    offset = nextOffset;
  }

  if (offset !== bytes.length || chunks.length === 0) {
    throw new ApiError(415, "DERIVATIVE_INVALID", "The WebP dimensions could not be verified.");
  }

  let primary: WebpChunk;
  let containerDimensions: WebpInfo | null = null;
  if (chunks[0]!.type === "VP8X") {
    const extended = chunks[0]!;
    if (extended.size !== 10 || (bytes[extended.dataOffset]! & 0xef) !== 0) {
      throw new ApiError(
        415,
        "DERIVATIVE_INVALID",
        "Gallery copies must not contain location or profile metadata.",
      );
    }
    containerDimensions = {
      width: uint24le(bytes, extended.dataOffset + 4) + 1,
      height: uint24le(bytes, extended.dataOffset + 7) + 1,
    };
    const alphaFlag = (bytes[extended.dataOffset]! & 0x10) !== 0;
    const remainder = chunks.slice(1);
    const lossyWithAlpha =
      remainder.length === 2 && remainder[0]!.type === "ALPH" && remainder[1]!.type === "VP8 ";
    const singlePrimary =
      remainder.length === 1 && (remainder[0]!.type === "VP8 " || remainder[0]!.type === "VP8L");
    if (
      (!lossyWithAlpha && !singlePrimary) ||
      (lossyWithAlpha && !alphaFlag) ||
      (singlePrimary && remainder[0]!.type === "VP8 " && alphaFlag) ||
      (remainder[0]?.type === "ALPH" && remainder[0].size < 1)
    ) {
      throw new ApiError(415, "DERIVATIVE_INVALID", "That WebP image structure is not supported.");
    }
    primary = remainder[remainder.length - 1]!;
  } else {
    if (chunks.length !== 1 || (chunks[0]!.type !== "VP8 " && chunks[0]!.type !== "VP8L")) {
      throw new ApiError(415, "DERIVATIVE_INVALID", "That WebP image structure is not supported.");
    }
    primary = chunks[0]!;
  }

  const dimensions =
    primary.type === "VP8 "
      ? lossyWebpDimensions(bytes, primary)
      : primary.type === "VP8L"
        ? losslessWebpDimensions(bytes, primary)
        : null;
  if (
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    (containerDimensions && !sameDimensions(containerDimensions, dimensions))
  ) {
    throw new ApiError(415, "DERIVATIVE_INVALID", "The WebP dimensions could not be verified.");
  }
  return dimensions;
}
