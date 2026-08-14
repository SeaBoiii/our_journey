export type MomentStatus = "pending" | "approved" | "rejected" | "hidden";
export type MomentMediaType = "photo" | "video";

export interface Moment {
  readonly id: string;
  readonly guestName: string;
  readonly caption: string;
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
  readonly previewUrl: string;
  readonly thumbnailUrl?: string;
  readonly originalFileId?: string;
  readonly status: MomentStatus;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly size?: number;
}

export interface MomentUploadInput {
  readonly files: readonly File[];
  readonly guestName: string;
  readonly caption?: string;
}

export type MomentUploadPhase = "validating" | "uploading" | "complete";

export interface MomentUploadProgress {
  readonly phase: MomentUploadPhase;
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly uploadedBytes: number;
  readonly totalBytes: number;
  readonly percentage: number;
  readonly currentFileName?: string;
}

export type MomentUploadProgressCallback = (
  progress: MomentUploadProgress,
) => void;

export interface UploadMomentOptions {
  readonly onProgress?: MomentUploadProgressCallback;
  readonly signal?: AbortSignal;
}

export interface MomentUploadResult {
  readonly moments: Moment[];
}

export interface GetMomentsOptions {
  /** Defaults to approved so guest-facing callers cannot expose moderation. */
  readonly status?: MomentStatus | "all";
}

export type MomentErrorCode =
  | "NO_FILES"
  | "TOO_MANY_FILES"
  | "GUEST_NAME_REQUIRED"
  | "UNSUPPORTED_FILE_TYPE"
  | "VIDEOS_DISABLED"
  | "FILE_TOO_LARGE"
  | "FEATURE_DISABLED"
  | "UPLOAD_FAILED"
  | "LOAD_FAILED"
  | "DELETE_FAILED"
  | "UPDATE_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "INVALID_STATUS"
  | "ABORTED";

export interface MomentErrorDetails {
  readonly fileName?: string;
  readonly fileIndex?: number;
  readonly maximumBytes?: number;
  readonly actualBytes?: number;
  readonly maximumFiles?: number;
}

export interface MomentValidationIssue {
  readonly code: MomentErrorCode;
  readonly message: string;
  readonly fileName?: string;
  readonly fileIndex?: number;
}

export interface MomentsProvider {
  uploadMoment(
    input: MomentUploadInput,
    options?: UploadMomentOptions,
  ): Promise<MomentUploadResult>;
  getMoments(options?: GetMomentsOptions): Promise<Moment[]>;
  deletePendingUpload(id: string): Promise<void>;
  updateMomentStatus(id: string, status: MomentStatus): Promise<Moment>;
}

export type MomentsService = MomentsProvider;
