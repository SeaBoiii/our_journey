import type {
  Moment,
  MomentErrorCode,
  MomentMediaType,
  MomentProcessingStatus,
  MomentStatus,
  MomentUploadReceipt,
} from "./types";

export interface ApiEnvelope<T> {
  readonly data: T;
}

export interface DisplayUrlPolicy {
  readonly origin: string;
  readonly pathPrefix: string;
}

export interface ApiErrorDto {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly requestId?: string;
    readonly retryAfterSeconds?: number;
  };
}

export interface AnonymousSessionDto {
  readonly sessionToken: string;
  readonly expiresAt: string;
}

export interface UploadFileInitDto {
  readonly clientFileId: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly mediaType: MomentMediaType;
}

export interface UploadInitRequestDto {
  readonly guestName: string;
  readonly caption: string;
  readonly files: readonly UploadFileInitDto[];
}

export interface UploadSessionDto {
  readonly clientFileId: string;
  readonly sessionId: string;
  /** Opaque sealed capability; never a Google resumable session URI. */
  readonly uploadToken: string;
  readonly chunkSize: number;
  readonly nextOffset: number;
  readonly expiresAt: string;
}

export interface UploadInitResponseDto {
  readonly uploadId: string;
  readonly files: readonly UploadSessionDto[];
}

export interface UploadChunkResponseDto {
  readonly sessionId: string;
  readonly nextOffset: number;
  readonly uploadedBytes: number;
  readonly totalBytes: number;
  readonly complete: boolean;
}

export interface UploadStatusResponseDto {
  readonly sessionId: string;
  readonly nextOffset: number;
  readonly totalBytes: number;
  readonly complete: boolean;
  readonly expiresAt: string;
}

export interface UploadDerivativeDto {
  readonly uploaded: true;
  readonly width: number;
  readonly height: number;
}

export interface UploadDerivativesResponseDto {
  /** Replacement sealed state that must be used for finalization. */
  readonly uploadToken: string;
  readonly gallery: UploadDerivativeDto;
  readonly thumbnail: UploadDerivativeDto;
}

export interface UploadCompleteResponseDto {
  readonly moment: MomentUploadReceipt;
}

export interface PublicMomentDto {
  readonly id: string;
  readonly guestName: string;
  readonly caption: string;
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
  readonly galleryUrl: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly status: "approved";
}

export interface AdminMomentDto {
  readonly id: string;
  readonly guestName: string;
  readonly caption: string;
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
  readonly galleryUrl?: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly status: MomentStatus;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly processingStatus: MomentProcessingStatus;
  readonly moderatedAt?: string;
}

export interface MomentsListResponseDto<TMoment> {
  readonly moments: readonly TMoment[];
  readonly nextOffset: number | null;
}

export interface AdminMomentsListResponseDto {
  readonly moments: readonly AdminMomentDto[];
  readonly nextOffset: number | null;
}

export interface AdminIdentityDto {
  readonly authenticated: boolean;
  readonly authorized: boolean;
  readonly user?: {
    readonly id: string;
    readonly email?: string;
  };
}

export interface UpdateMomentStatusRequestDto {
  readonly status: MomentStatus;
}

export interface UpdateMomentStatusResponseDto {
  readonly moment: AdminMomentDto;
}

const KNOWN_ERROR_CODES: ReadonlySet<MomentErrorCode> = new Set([
  "NO_FILES",
  "TOO_MANY_FILES",
  "GUEST_NAME_REQUIRED",
  "GUEST_NAME_TOO_LONG",
  "CAPTION_TOO_LONG",
  "UNSUPPORTED_FILE_TYPE",
  "VIDEOS_DISABLED",
  "FILE_TOO_LARGE",
  "FEATURE_DISABLED",
  "UPLOAD_FAILED",
  "LOAD_FAILED",
  "DELETE_FAILED",
  "UPDATE_FAILED",
  "STORAGE_UNAVAILABLE",
  "NOT_FOUND",
  "NOT_PENDING",
  "INVALID_STATUS",
  "ABORTED",
  "API_NOT_CONFIGURED",
  "NETWORK_ERROR",
  "SESSION_EXPIRED",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "ACCESS_DENIED",
]);

export class MomentsApiError extends Error {
  readonly code: MomentErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    code: MomentErrorCode,
    message: string,
    options: {
      readonly status?: number;
      readonly retryable?: boolean;
      readonly requestId?: string;
      readonly retryAfterSeconds?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MomentsApiError";
    this.code = code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isMediaType(value: unknown): value is MomentMediaType {
  return value === "photo" || value === "video";
}

function isMomentStatus(value: unknown): value is MomentStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "hidden"
  );
}

export function isAnonymousSessionDto(value: unknown): value is AnonymousSessionDto {
  return (
    isObject(value) &&
    isString(value.sessionToken) &&
    isString(value.expiresAt)
  );
}

function isUploadSessionDto(value: unknown): value is UploadSessionDto {
  return (
    isObject(value) &&
    isString(value.clientFileId) &&
    isString(value.sessionId) &&
    isString(value.uploadToken) &&
    isFiniteNumber(value.chunkSize) &&
    isFiniteNumber(value.nextOffset) &&
    isString(value.expiresAt)
  );
}

export function isUploadInitResponseDto(
  value: unknown,
): value is UploadInitResponseDto {
  return (
    isObject(value) &&
    isString(value.uploadId) &&
    Array.isArray(value.files) &&
    value.files.every(isUploadSessionDto)
  );
}

export function isUploadChunkResponseDto(
  value: unknown,
): value is UploadChunkResponseDto {
  return (
    isObject(value) &&
    isString(value.sessionId) &&
    isFiniteNumber(value.nextOffset) &&
    isFiniteNumber(value.uploadedBytes) &&
    isFiniteNumber(value.totalBytes) &&
    typeof value.complete === "boolean"
  );
}

export function isUploadStatusResponseDto(
  value: unknown,
): value is UploadStatusResponseDto {
  return (
    isObject(value) &&
    isString(value.sessionId) &&
    isFiniteNumber(value.nextOffset) &&
    isFiniteNumber(value.totalBytes) &&
    typeof value.complete === "boolean" &&
    isString(value.expiresAt)
  );
}

function isUploadDerivativeDto(value: unknown): value is UploadDerivativeDto {
  return (
    isObject(value) &&
    value.uploaded === true &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

export function isUploadDerivativesResponseDto(
  value: unknown,
): value is UploadDerivativesResponseDto {
  return (
    isObject(value) &&
    isString(value.uploadToken) &&
    isUploadDerivativeDto(value.gallery) &&
    isUploadDerivativeDto(value.thumbnail)
  );
}

function isUploadReceipt(value: unknown): value is MomentUploadReceipt {
  return (
    isObject(value) &&
    isString(value.id) &&
    (value.status === "pending" || value.status === "approved") &&
    isString(value.createdAt) &&
    isMediaType(value.mediaType)
  );
}

export function isUploadCompleteResponseDto(
  value: unknown,
): value is UploadCompleteResponseDto {
  return isObject(value) && isUploadReceipt(value.moment);
}

export function isPublicMomentDto(value: unknown): value is PublicMomentDto {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.guestName) &&
    isString(value.caption) &&
    isString(value.createdAt) &&
    isMediaType(value.mediaType) &&
    isString(value.galleryUrl) &&
    isOptionalString(value.thumbnailUrl) &&
    isOptionalNumber(value.width) &&
    isOptionalNumber(value.height) &&
    value.status === "approved"
  );
}

export function isAdminMomentDto(value: unknown): value is AdminMomentDto {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.guestName) &&
    isString(value.caption) &&
    isString(value.createdAt) &&
    isMediaType(value.mediaType) &&
    isOptionalString(value.galleryUrl) &&
    isOptionalString(value.thumbnailUrl) &&
    isOptionalNumber(value.width) &&
    isOptionalNumber(value.height) &&
    isMomentStatus(value.status) &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.fileName) &&
    isOptionalNumber(value.fileSize) &&
    (value.processingStatus === "pending" ||
      value.processingStatus === "ready" ||
      value.processingStatus === "failed") &&
    isOptionalString(value.moderatedAt)
  );
}

export function momentsListGuard<TMoment>(
  momentGuard: (value: unknown) => value is TMoment,
): (value: unknown) => value is MomentsListResponseDto<TMoment> {
  return (value: unknown): value is MomentsListResponseDto<TMoment> =>
    isObject(value) &&
    Array.isArray(value.moments) &&
    value.moments.every(momentGuard) &&
    (value.nextOffset === null ||
      (typeof value.nextOffset === "number" &&
        Number.isSafeInteger(value.nextOffset) &&
        value.nextOffset >= 0));
}

export function isAdminMomentsListResponseDto(
  value: unknown,
): value is AdminMomentsListResponseDto {
  return (
    isObject(value) &&
    Array.isArray(value.moments) &&
    value.moments.every(isAdminMomentDto) &&
    (value.nextOffset === null ||
      (typeof value.nextOffset === "number" &&
        Number.isSafeInteger(value.nextOffset) &&
        value.nextOffset >= 0))
  );
}

export function isAdminIdentityDto(value: unknown): value is AdminIdentityDto {
  return (
    isObject(value) &&
    typeof value.authenticated === "boolean" &&
    typeof value.authorized === "boolean" &&
    (value.user === undefined ||
      (isObject(value.user) &&
        isString(value.user.id) &&
        isOptionalString(value.user.email)))
  );
}

export function isUpdateMomentStatusResponseDto(
  value: unknown,
): value is UpdateMomentStatusResponseDto {
  return isObject(value) && isAdminMomentDto(value.moment);
}

function errorCodeFor(value: unknown, status: number): MomentErrorCode {
  if (typeof value === "string" && KNOWN_ERROR_CODES.has(value as MomentErrorCode)) {
    return value as MomentErrorCode;
  }

  if (value === "FILE_CONTENT_MISMATCH" || value === "INVALID_MIME_TYPE") {
    return "UNSUPPORTED_FILE_TYPE";
  }
  if (
    value === "UPLOAD_SESSION_EXPIRED" ||
    value === "UPLOAD_NOT_FOUND" ||
    value === "INVALID_UPLOAD_SESSION"
  ) {
    return "SESSION_EXPIRED";
  }
  if (
    value === "UPLOAD_OFFSET_MISMATCH" ||
    value === "CHUNK_TOO_LARGE" ||
    value === "INVALID_REQUEST" ||
    value === "INVALID_ORIGIN"
  ) {
    return "UPLOAD_FAILED";
  }

  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 410) return "SESSION_EXPIRED";
  if (status === 413) return "FILE_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  return "NETWORK_ERROR";
}

export function apiUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    throw new MomentsApiError(
      "API_NOT_CONFIGURED",
      "The Moments API has not been configured.",
    );
  }

  try {
    const base = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error("Unsupported API protocol.");
    }
    return new URL(path.replace(/^\/+/, ""), base).toString();
  } catch (cause) {
    throw new MomentsApiError(
      "API_NOT_CONFIGURED",
      "The Moments API URL is invalid.",
      { cause },
    );
  }
}

export async function readApiResponse<T>(
  response: Response,
  guard?: (value: unknown) => value is T,
): Promise<T> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch (cause) {
    throw new MomentsApiError(
      response.ok ? "NETWORK_ERROR" : errorCodeFor(undefined, response.status),
      "The Moments API returned an unreadable response.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    const apiError =
      isObject(payload) && isObject(payload.error) ? payload.error : undefined;
    const rawCode = apiError?.code;
    const code = errorCodeFor(rawCode, response.status);
    const safeMessage =
      typeof apiError?.message === "string" && apiError.message.trim()
        ? apiError.message
        : "The Moments API could not complete that request.";

    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterValue = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : Number.NaN;
    throw new MomentsApiError(code, safeMessage, {
      status: response.status,
      retryable:
        apiError?.retryable === true ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500 ||
        rawCode === "UPLOAD_OFFSET_MISMATCH",
      requestId:
        typeof apiError?.requestId === "string" ? apiError.requestId : undefined,
      retryAfterSeconds:
        typeof apiError?.retryAfterSeconds === "number"
          ? apiError.retryAfterSeconds
          : Number.isFinite(retryAfterValue)
            ? retryAfterValue
            : undefined,
    });
  }

  if (!isObject(payload) || !("data" in payload)) {
    throw new MomentsApiError(
      "NETWORK_ERROR",
      "The Moments API returned an unexpected response.",
      { status: response.status },
    );
  }

  if (guard && !guard(payload.data)) {
    throw new MomentsApiError(
      "NETWORK_ERROR",
      "The Moments API returned data in an unexpected format.",
      { status: response.status },
    );
  }

  return payload.data as T;
}

function assertDisplayUrl(
  value: string,
  field: string,
  policy: DisplayUrlPolicy,
): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === policy.origin &&
      url.pathname.startsWith(policy.pathPrefix)
    ) {
      return url.toString();
    }
  } catch {
    // Handled below.
  }

  throw new MomentsApiError(
    "LOAD_FAILED",
    `The API returned an invalid ${field} URL.`,
  );
}

export function publicMomentFromDto(
  dto: PublicMomentDto,
  displayUrlPolicy: DisplayUrlPolicy,
): Moment {
  const previewUrl = assertDisplayUrl(
    dto.galleryUrl,
    "gallery",
    displayUrlPolicy,
  );
  const thumbnailUrl = dto.thumbnailUrl
    ? assertDisplayUrl(dto.thumbnailUrl, "thumbnail", displayUrlPolicy)
    : previewUrl;
  if (thumbnailUrl !== previewUrl) {
    throw new MomentsApiError(
      "LOAD_FAILED",
      "The API returned mismatched gallery media.",
    );
  }
  return {
    id: dto.id,
    guestName: dto.guestName,
    caption: dto.caption,
    createdAt: dto.createdAt,
    mediaType: dto.mediaType,
    previewUrl,
    thumbnailUrl,
    status: dto.status,
    width: dto.width,
    height: dto.height,
  };
}

export function adminMomentFromDto(
  dto: AdminMomentDto,
  displayUrlPolicy: DisplayUrlPolicy,
): Moment {
  const previewUrl = dto.galleryUrl
    ? assertDisplayUrl(dto.galleryUrl, "gallery", displayUrlPolicy)
    : "";
  const thumbnailUrl = dto.thumbnailUrl
    ? assertDisplayUrl(dto.thumbnailUrl, "thumbnail", displayUrlPolicy)
    : previewUrl || undefined;
  if (thumbnailUrl && thumbnailUrl !== previewUrl) {
    throw new MomentsApiError(
      "LOAD_FAILED",
      "The API returned mismatched gallery media.",
    );
  }
  return {
    id: dto.id,
    guestName: dto.guestName,
    caption: dto.caption,
    createdAt: dto.createdAt,
    mediaType: dto.mediaType,
    previewUrl,
    thumbnailUrl,
    status: dto.status,
    width: dto.width,
    height: dto.height,
    mimeType: dto.mimeType,
    fileName: dto.fileName,
    size: dto.fileSize,
    processingStatus: dto.processingStatus,
  };
}
