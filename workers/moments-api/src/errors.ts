export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ORIGIN"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "RATE_LIMITED"
  | "NO_FILES"
  | "TOO_MANY_FILES"
  | "GUEST_NAME_REQUIRED"
  | "UNSUPPORTED_FILE_TYPE"
  | "VIDEOS_DISABLED"
  | "FILE_TOO_LARGE"
  | "FILE_CONTENT_MISMATCH"
  | "CHUNK_TOO_LARGE"
  | "UPLOAD_OFFSET_MISMATCH"
  | "UPLOAD_SESSION_EXPIRED"
  | "UPLOAD_INCOMPLETE"
  | "UPLOAD_ALREADY_COMPLETED"
  | "DERIVATIVE_INVALID"
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "UPSTREAM_UNAVAILABLE"
  | "SERVER_MISCONFIGURED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly options: {
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfter?: number;
    cause?: unknown;
  };

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      retryAfter?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.options = options;
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          "INTERNAL_ERROR",
          "Something went wrong while handling that request.",
        );
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": requestId,
  });

  if (apiError.options.retryAfter !== undefined) {
    headers.set("retry-after", String(apiError.options.retryAfter));
  }

  return new Response(
    JSON.stringify({
      error: {
        code: apiError.code,
        message: apiError.message,
        requestId,
        retryable: apiError.options.retryable ?? false,
        ...(apiError.options.retryAfter !== undefined
          ? { retryAfterSeconds: apiError.options.retryAfter }
          : {}),
        ...(apiError.options.details ? { details: apiError.options.details } : {}),
      },
    }),
    { status: apiError.status, headers },
  );
}
