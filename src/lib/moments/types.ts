export type MomentStatus = "pending" | "approved" | "rejected" | "hidden";
export type MomentMediaType = "photo" | "video";
export type MomentProcessingStatus = "pending" | "ready" | "failed";

export interface Moment {
  readonly id: string;
  readonly guestName: string;
  readonly caption: string;
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
  /** Gallery-sized display asset. Never a Google Drive original URL. */
  readonly previewUrl: string;
  readonly thumbnailUrl?: string;
  readonly status: MomentStatus;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly size?: number;
  /** Present on privileged admin reads; public gallery records are always ready. */
  readonly processingStatus?: MomentProcessingStatus;
}

export interface MomentUploadInput {
  readonly files: readonly File[];
  readonly guestName: string;
  readonly caption?: string;
}

export type MomentUploadPhase =
  | "validating"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "complete";

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

export interface MomentUploadReceipt {
  readonly id: string;
  readonly status: "pending" | "approved";
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
}

export interface MomentUploadResult {
  readonly submissions: readonly MomentUploadReceipt[];
}

export interface GetMomentsOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface MomentsPage {
  readonly moments: readonly Moment[];
  readonly nextOffset: number | null;
}

export interface AdminMomentsOptions extends GetMomentsOptions {
  readonly status?: MomentStatus | "all";
}

export type AdminMomentsPage = MomentsPage;

export type MomentErrorCode =
  | "NO_FILES"
  | "TOO_MANY_FILES"
  | "GUEST_NAME_REQUIRED"
  | "GUEST_NAME_TOO_LONG"
  | "CAPTION_TOO_LONG"
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
  | "ABORTED"
  | "API_NOT_CONFIGURED"
  | "NETWORK_ERROR"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED";

export interface MomentErrorDetails {
  readonly fileName?: string;
  readonly fileIndex?: number;
  readonly maximumBytes?: number;
  readonly actualBytes?: number;
  readonly maximumFiles?: number;
  readonly retryAfterSeconds?: number;
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
  /** Guest-safe, approved-only gallery read. */
  getMoments(options?: GetMomentsOptions): Promise<MomentsPage>;
  /** Privileged moderation read; remote implementations require admin auth. */
  getAdminMoments(options?: AdminMomentsOptions): Promise<AdminMomentsPage>;
  deletePendingUpload(id: string): Promise<void>;
  updateMomentStatus(id: string, status: MomentStatus): Promise<Moment>;
}

export type MomentsService = MomentsProvider;
