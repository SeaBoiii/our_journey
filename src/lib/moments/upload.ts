import {
  ACCEPTED_PHOTO_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
  BYTES_PER_MEGABYTE,
  MOMENTS_CONFIG,
} from "../../config/moments";
import { mockMomentsProvider } from "./providers/mock";
import type {
  GetMomentsOptions,
  Moment,
  MomentErrorCode,
  MomentErrorDetails,
  MomentMediaType,
  MomentsProvider,
  MomentStatus,
  MomentUploadInput,
  MomentUploadResult,
  MomentValidationIssue,
  UploadMomentOptions,
} from "./types";

const PHOTO_MIME_TYPES: ReadonlySet<string> = new Set(
  ACCEPTED_PHOTO_MIME_TYPES,
);
const VIDEO_MIME_TYPES: ReadonlySet<string> = new Set(
  ACCEPTED_VIDEO_MIME_TYPES,
);
const PHOTO_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
]);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "mov"]);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "approved",
  "rejected",
  "hidden",
]);

export const MOMENT_ERROR_MESSAGES: Readonly<Record<MomentErrorCode, string>> = {
  NO_FILES: "Choose at least one photo or video to share.",
  TOO_MANY_FILES: `Choose up to ${MOMENTS_CONFIG.maxFilesPerUpload} files at a time.`,
  GUEST_NAME_REQUIRED: "Please tell us your name before sharing your moment.",
  UNSUPPORTED_FILE_TYPE:
    "That file type is not supported. Try a JPEG, PNG, WebP, HEIC, MP4, or MOV file.",
  VIDEOS_DISABLED: "Video uploads are not available just yet.",
  FILE_TOO_LARGE:
    "That file is a little too large to upload. Try choosing a smaller version.",
  FEATURE_DISABLED: "Moments is taking a short pause. Please try again later.",
  UPLOAD_FAILED:
    "Your moment could not be uploaded just now. Please check your connection and try again.",
  LOAD_FAILED: "The gallery could not be loaded just now. Please try again.",
  DELETE_FAILED: "That pending moment could not be removed. Please try again.",
  UPDATE_FAILED: "That moment could not be updated. Please try again.",
  STORAGE_UNAVAILABLE:
    "This browser could not save your moment locally. Check available storage and try again.",
  NOT_FOUND: "That moment could not be found.",
  NOT_PENDING: "Only a moment that is still pending can be removed.",
  INVALID_STATUS: "That moderation choice is not available.",
  ABORTED: "The upload was cancelled before it finished.",
};

export class MomentServiceError extends Error {
  readonly code: MomentErrorCode;
  readonly userMessage: string;
  readonly details?: MomentErrorDetails;

  constructor(
    code: MomentErrorCode,
    userMessage = MOMENT_ERROR_MESSAGES[code],
    options: {
      readonly details?: MomentErrorDetails;
      readonly cause?: unknown;
    } = {},
  ) {
    super(userMessage, { cause: options.cause });
    this.name = "MomentServiceError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = options.details;
  }
}

function fileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex >= 0
    ? fileName.slice(extensionIndex + 1).toLocaleLowerCase()
    : "";
}

export function getMomentMediaType(file: File): MomentMediaType | null {
  const mimeType = file.type.toLocaleLowerCase();
  const extension = fileExtension(file.name);

  if (PHOTO_MIME_TYPES.has(mimeType)) {
    return "photo";
  }

  if (VIDEO_MIME_TYPES.has(mimeType)) {
    return "video";
  }

  // Mobile Safari can leave HEIC/HEIF and MOV MIME types empty. Only trust
  // the extension fallback when the browser supplied no useful MIME type.
  if (!mimeType || mimeType === "application/octet-stream") {
    if (PHOTO_EXTENSIONS.has(extension)) {
      return "photo";
    }

    if (VIDEO_EXTENSIONS.has(extension)) {
      return "video";
    }
  }

  return null;
}

export function isAcceptedMomentFile(file: File): boolean {
  const mediaType = getMomentMediaType(file);
  return (
    mediaType === "photo" ||
    (mediaType === "video" && MOMENTS_CONFIG.allowVideos)
  );
}

function formattedMegabytes(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MEGABYTE)} MB`;
}

export function validateMomentFiles(
  files: readonly File[],
): MomentValidationIssue[] {
  if (files.length === 0) {
    return [{ code: "NO_FILES", message: MOMENT_ERROR_MESSAGES.NO_FILES }];
  }

  const issues: MomentValidationIssue[] = [];

  if (files.length > MOMENTS_CONFIG.maxFilesPerUpload) {
    issues.push({
      code: "TOO_MANY_FILES",
      message: MOMENT_ERROR_MESSAGES.TOO_MANY_FILES,
    });
  }

  for (const [fileIndex, file] of files.entries()) {
    const mediaType = getMomentMediaType(file);

    if (!mediaType) {
      issues.push({
        code: "UNSUPPORTED_FILE_TYPE",
        message: `${file.name || "This file"} is not a supported photo or video.`,
        fileName: file.name,
        fileIndex,
      });
      continue;
    }

    if (mediaType === "video" && !MOMENTS_CONFIG.allowVideos) {
      issues.push({
        code: "VIDEOS_DISABLED",
        message: MOMENT_ERROR_MESSAGES.VIDEOS_DISABLED,
        fileName: file.name,
        fileIndex,
      });
      continue;
    }

    const maximumBytes =
      mediaType === "video"
        ? MOMENTS_CONFIG.maxVideoSize
        : MOMENTS_CONFIG.maxPhotoSize;

    if (file.size > maximumBytes) {
      issues.push({
        code: "FILE_TOO_LARGE",
        message: `${file.name || "That file"} is over the ${formattedMegabytes(maximumBytes)} ${mediaType} limit. Try choosing a smaller version.`,
        fileName: file.name,
        fileIndex,
      });
    }
  }

  return issues;
}

export function validateMomentUpload(
  input: MomentUploadInput,
): MomentValidationIssue[] {
  const issues = validateMomentFiles(input.files);

  if (!input.guestName.trim()) {
    issues.unshift({
      code: "GUEST_NAME_REQUIRED",
      message: MOMENT_ERROR_MESSAGES.GUEST_NAME_REQUIRED,
    });
  }

  return issues;
}

function detailsForIssue(
  issue: MomentValidationIssue,
  input: MomentUploadInput,
): MomentErrorDetails {
  const file =
    issue.fileIndex === undefined ? undefined : input.files[issue.fileIndex];
  const mediaType = file ? getMomentMediaType(file) : null;

  return {
    fileName: issue.fileName,
    fileIndex: issue.fileIndex,
    maximumBytes:
      mediaType === "video"
        ? MOMENTS_CONFIG.maxVideoSize
        : mediaType === "photo"
          ? MOMENTS_CONFIG.maxPhotoSize
          : undefined,
    actualBytes: file?.size,
    maximumFiles: MOMENTS_CONFIG.maxFilesPerUpload,
  };
}

function isNamedError(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === name
  );
}

function serviceErrorFor(
  error: unknown,
  fallbackCode: MomentErrorCode,
): MomentServiceError {
  if (error instanceof MomentServiceError) {
    return error;
  }

  if (isNamedError(error, "AbortError")) {
    return new MomentServiceError("ABORTED", undefined, { cause: error });
  }

  if (isNamedError(error, "MomentsStorageError")) {
    return new MomentServiceError("STORAGE_UNAVAILABLE", undefined, {
      cause: error,
    });
  }

  if (isNamedError(error, "MomentsNotFoundError")) {
    return new MomentServiceError("NOT_FOUND", undefined, { cause: error });
  }

  if (isNamedError(error, "MomentsNotPendingError")) {
    return new MomentServiceError("NOT_PENDING", undefined, { cause: error });
  }

  return new MomentServiceError(fallbackCode, undefined, { cause: error });
}

export function getMomentErrorMessage(error: unknown): string {
  return error instanceof MomentServiceError
    ? error.userMessage
    : MOMENT_ERROR_MESSAGES.UPLOAD_FAILED;
}

let activeProvider: MomentsProvider = mockMomentsProvider;

/** Allows a future Supabase/API adapter to be injected without changing UI. */
export function setMomentsProvider(provider: MomentsProvider): void {
  activeProvider = provider;
}

export function resetMomentsProvider(): void {
  activeProvider = mockMomentsProvider;
}

export function getMomentsProvider(): MomentsProvider {
  return activeProvider;
}

export async function uploadMoment(
  input: MomentUploadInput,
  options: UploadMomentOptions = {},
): Promise<MomentUploadResult> {
  if (!MOMENTS_CONFIG.enabled) {
    throw new MomentServiceError("FEATURE_DISABLED");
  }

  const issues = validateMomentUpload(input);
  const firstIssue = issues[0];

  if (firstIssue) {
    throw new MomentServiceError(firstIssue.code, firstIssue.message, {
      details: detailsForIssue(firstIssue, input),
    });
  }

  try {
    options.onProgress?.({
      phase: "validating",
      completedFiles: 0,
      totalFiles: input.files.length,
      uploadedBytes: 0,
      totalBytes: input.files.reduce((sum, file) => sum + file.size, 0),
      percentage: 0,
    });
  } catch {
    // UI progress rendering must not prevent a valid upload.
  }

  try {
    return await activeProvider.uploadMoment(input, options);
  } catch (error) {
    throw serviceErrorFor(error, "UPLOAD_FAILED");
  }
}

export async function getMoments(
  options: GetMomentsOptions = {},
): Promise<Moment[]> {
  try {
    return await activeProvider.getMoments(options);
  } catch (error) {
    throw serviceErrorFor(error, "LOAD_FAILED");
  }
}

export async function deletePendingUpload(id: string): Promise<void> {
  try {
    await activeProvider.deletePendingUpload(id);
  } catch (error) {
    throw serviceErrorFor(error, "DELETE_FAILED");
  }
}

export async function updateMomentStatus(
  id: string,
  status: MomentStatus,
): Promise<Moment> {
  if (!VALID_STATUSES.has(status)) {
    throw new MomentServiceError("INVALID_STATUS");
  }

  try {
    return await activeProvider.updateMomentStatus(id, status);
  } catch (error) {
    throw serviceErrorFor(error, "UPDATE_FAILED");
  }
}

export type {
  GetMomentsOptions,
  Moment,
  MomentErrorCode,
  MomentMediaType,
  MomentsProvider,
  MomentStatus,
  MomentUploadInput,
  MomentUploadProgress,
  MomentUploadProgressCallback,
  MomentUploadResult,
  MomentValidationIssue,
  UploadMomentOptions,
} from "./types";
