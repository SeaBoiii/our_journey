import { ApiError } from "./errors.ts";
import {
  generateDriveFileIds,
  getDriveFile,
  getDriveUploadStatus,
  initiateDriveUpload,
  uploadDriveChunk,
  verifyCompletedDriveFile,
} from "./google.ts";
import { bearerToken, jsonResponse, readJson } from "./http.ts";
import {
  issueGuestSession,
  openUploadTicket,
  sealUploadTicket,
  sha256Text,
  verifyGuestSession,
} from "./security.ts";
import {
  derivativeExists,
  finalizeMoment,
  findMomentByIdPrivileged,
  getApprovedMoment,
  listAdminMoments,
  listApprovedMoments,
  requireAdmin,
  updateAdminMomentStatus,
  uploadDerivative,
} from "./supabase.ts";
import type {
  Env,
  Fetcher,
  GuestSessionPayload,
  MomentStatus,
  RateLimitBinding,
  UploadTicketPayload,
} from "./types.ts";
import {
  CHUNK_SIZE,
  inspectMetadataFreeWebp,
  MAX_DERIVATIVE_REQUEST_BYTES,
  MAX_GALLERY_BYTES,
  validateFileMagic,
  validateUploadInit,
} from "./validation.ts";

export interface HandlerDependencies {
  fetcher?: Fetcher;
  fixedLengthStreamFactory?: (expectedBytes: number) => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
}

function fetcher(dependencies: HandlerDependencies): Fetcher {
  return dependencies.fetcher ?? fetch;
}

function fixedLengthStream(
  expectedBytes: number,
  dependencies: HandlerDependencies,
): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
  if (dependencies.fixedLengthStreamFactory) {
    return dependencies.fixedLengthStreamFactory(expectedBytes);
  }
  const constructor = (
    globalThis as typeof globalThis & {
      FixedLengthStream?: new (expectedLength: number) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).FixedLengthStream;
  if (!constructor) {
    throw new ApiError(
      500,
      "SERVER_MISCONFIGURED",
      "The upload runtime does not support fixed-length streaming.",
    );
  }
  return new constructor(expectedBytes);
}

async function rateLimit(
  binding: RateLimitBinding | undefined,
  key: string,
): Promise<void> {
  if (!binding) return;
  let result: { success: boolean };
  try {
    result = await binding.limit({ key });
  } catch (cause) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The upload service is temporarily unavailable.", {
      retryable: true,
      cause,
    });
  }
  if (!result.success) {
    throw new ApiError(429, "RATE_LIMITED", "Please wait a moment before trying again.", {
      retryable: true,
      retryAfter: 60,
    });
  }
}

async function rateLimitClientIp(
  request: Request,
  binding: RateLimitBinding | undefined,
  prefix: string,
): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-development";
  await rateLimit(binding, `${prefix}:${await sha256Text(ip)}`);
}

async function requireGuest(request: Request, env: Env): Promise<GuestSessionPayload> {
  const guest = await verifyGuestSession(request.headers.get("x-guest-session"), env);
  await rateLimit(env.UPLOAD_SESSION_RATE_LIMITER, `guest:${guest.sid}`);
  await rateLimitClientIp(request, env.UPLOAD_IP_RATE_LIMITER, "upload-ip");
  return guest;
}

async function requireUpload(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<{ guest: GuestSessionPayload; ticket: UploadTicketPayload }> {
  const guest = await requireGuest(request, env);
  const ticket = await openUploadTicket(
    request.headers.get("x-moments-upload-token"),
    env,
    guest,
    sessionId,
  );
  return { guest, ticket };
}

export async function createAnonymousSession(
  request: Request,
  env: Env,
): Promise<Response> {
  await rateLimitClientIp(request, env.ENTRY_IP_RATE_LIMITER, "entry-ip");
  // Turnstile, if wedding traffic ever needs it, belongs here before a guest
  // capability is issued. Keep it optional; CORS itself is not abuse control.
  const issued = await issueGuestSession(env);
  return jsonResponse(
    { sessionToken: issued.token, expiresAt: new Date(issued.payload.exp * 1000).toISOString() },
    201,
  );
}

export async function initializeUploads(
  request: Request,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const guest = await requireGuest(request, env);
  await rateLimitClientIp(request, env.ENTRY_IP_RATE_LIMITER, "entry-ip");
  const input = validateUploadInit(await readJson(request), env);
  const submissionId = crypto.randomUUID();
  const driveIds = await generateDriveFileIds(input.files.length, env, fetcher(dependencies));
  const uploads: Array<{
    clientFileId: string;
    sessionId: string;
    uploadToken: string;
    chunkSize: number;
    nextOffset: number;
    expiresAt: string;
  }> = [];

  for (const [index, file] of input.files.entries()) {
    const driveFileId = driveIds[index];
    if (!driveFileId) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The upload could not be prepared.");
    const momentId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const driveUploadUri = await initiateDriveUpload(
      { file, momentId, submissionId, driveFileId },
      env,
      fetcher(dependencies),
    );
    const payload = {
      v: 1 as const,
      sessionId,
      submissionId,
      momentId,
      guestSessionId: guest.sid,
      guestName: input.guestName,
      caption: input.caption,
      clientFileId: file.clientFileId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      mediaType: file.mediaType,
      driveFileId,
      driveUploadUri,
      createdAt,
      chunkSize: CHUNK_SIZE,
    };
    const uploadToken = await sealUploadTicket(payload, env);
    const opened = await openUploadTicket(uploadToken, env, guest, sessionId);
    uploads.push({
      clientFileId: file.clientFileId,
      sessionId,
      uploadToken,
      chunkSize: CHUNK_SIZE,
      nextOffset: 0,
      expiresAt: new Date(opened.exp * 1000).toISOString(),
    });
  }

  return jsonResponse({ uploadId: submissionId, files: uploads }, 201);
}

function parseContentRange(request: Request): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(request.headers.get("content-range") ?? "");
  if (!match) {
    throw new ApiError(400, "INVALID_REQUEST", "A valid Content-Range header is required.");
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) {
    throw new ApiError(400, "INVALID_REQUEST", "That chunk range is not valid.");
  }
  return { start, end, total };
}

function boundedBodyStream(
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
): ReadableStream<Uint8Array> {
  let received = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > expectedBytes || received > CHUNK_SIZE) {
          controller.error(new ApiError(413, "CHUNK_TOO_LARGE", "That upload chunk is too large."));
          return;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (received !== expectedBytes) {
          controller.error(new ApiError(400, "INVALID_REQUEST", "That chunk length does not match its range."));
        }
      },
    }),
  );
}

async function collectBoundedBody(
  source: ReadableStream<Uint8Array>,
  maximumBytes: number,
  tooLarge: () => ApiError,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function uploadChunk(
  request: Request,
  env: Env,
  sessionId: string,
  chunkIndex: string,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  if (!/^\d+$/.test(chunkIndex)) {
    throw new ApiError(400, "INVALID_REQUEST", "That chunk index is not valid.");
  }
  const { ticket } = await requireUpload(request, env, sessionId);
  const range = parseContentRange(request);
  if (range.total !== ticket.fileSize) {
    throw new ApiError(400, "INVALID_REQUEST", "That chunk does not match the selected file.");
  }

  const current = await getDriveUploadStatus(ticket, env, fetcher(dependencies));
  if (current.complete) {
    return jsonResponse({
      sessionId,
      nextOffset: ticket.fileSize,
      uploadedBytes: ticket.fileSize,
      totalBytes: ticket.fileSize,
      complete: true,
    });
  }
  if (range.start !== current.nextOffset) {
    throw new ApiError(
      409,
      "UPLOAD_OFFSET_MISMATCH",
      "The upload resumed from a different point. Please retry this chunk.",
      { details: { expectedOffset: current.nextOffset }, retryable: true },
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  const rangeLength = range.end - range.start + 1;
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
    throw new ApiError(411, "INVALID_REQUEST", "A bounded Content-Length header is required.");
  }
  if (rangeLength > CHUNK_SIZE || (Number.isFinite(declaredLength) && declaredLength > CHUNK_SIZE)) {
    throw new ApiError(413, "CHUNK_TOO_LARGE", "That upload chunk is too large.", {
      details: { maximumBytes: CHUNK_SIZE },
    });
  }
  const isFinal = range.end === ticket.fileSize - 1;
  if (!isFinal && rangeLength % (256 * 1024) !== 0) {
    throw new ApiError(400, "INVALID_REQUEST", "Upload chunks must align to 256 KiB boundaries.");
  }

  let body: BodyInit;
  let bodyPump: Promise<void> | undefined;
  if (range.start === 0) {
    if (!request.body) {
      throw new ApiError(400, "INVALID_REQUEST", "That upload chunk is empty.");
    }
    const firstChunk = await collectBoundedBody(
      request.body,
      rangeLength,
      () => new ApiError(413, "CHUNK_TOO_LARGE", "That upload chunk is too large."),
    );
    if (
      firstChunk.byteLength !== rangeLength ||
      (Number.isFinite(declaredLength) && declaredLength !== firstChunk.byteLength)
    ) {
      throw new ApiError(400, "INVALID_REQUEST", "That chunk length does not match its range.");
    }
    if (!validateFileMagic(firstChunk, ticket.mimeType)) {
      throw new ApiError(
        415,
        "FILE_CONTENT_MISMATCH",
        "That file's contents do not match its supported photo or video type.",
      );
    }
    body = firstChunk.buffer;
  } else {
    if (!request.body) {
      throw new ApiError(400, "INVALID_REQUEST", "That upload chunk is empty.");
    }
    if (Number.isFinite(declaredLength) && declaredLength !== rangeLength) {
      throw new ApiError(400, "INVALID_REQUEST", "That chunk length does not match its range.");
    }
    const fixed = fixedLengthStream(rangeLength, dependencies);
    bodyPump = boundedBodyStream(request.body, rangeLength).pipeTo(fixed.writable);
    body = fixed.readable;
  }

  const upload = uploadDriveChunk(
    ticket,
    body,
    rangeLength,
    range.start,
    range.end,
    env,
    fetcher(dependencies),
  );
  const result = bodyPump
    ? (await Promise.all([upload, bodyPump]))[0]
    : await upload;
  return jsonResponse({
    sessionId,
    nextOffset: result.nextOffset,
    uploadedBytes: result.nextOffset,
    totalBytes: ticket.fileSize,
    complete: result.complete,
  });
}

export async function getUploadStatus(
  request: Request,
  env: Env,
  sessionId: string,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const { ticket } = await requireUpload(request, env, sessionId);
  const status = await getDriveUploadStatus(ticket, env, fetcher(dependencies));
  return jsonResponse({
    sessionId,
    nextOffset: status.nextOffset,
    totalBytes: ticket.fileSize,
    complete: status.complete,
    expiresAt: new Date(ticket.exp * 1000).toISOString(),
  });
}

function requireDerivativeFile(value: FormDataEntryValue | null, name: string): File {
  if (!(value instanceof File)) {
    throw new ApiError(400, "DERIVATIVE_INVALID", `A ${name} WebP file is required.`);
  }
  return value;
}

export async function uploadDerivatives(
  request: Request,
  env: Env,
  sessionId: string,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const { ticket } = await requireUpload(request, env, sessionId);
  if (ticket.mediaType !== "photo") {
    throw new ApiError(400, "DERIVATIVE_INVALID", "Photo derivatives are not accepted for videos.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
    throw new ApiError(411, "DERIVATIVE_INVALID", "A bounded derivative request length is required.");
  }
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DERIVATIVE_REQUEST_BYTES) {
    throw new ApiError(413, "DERIVATIVE_INVALID", "Those gallery copies are too large.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new ApiError(415, "DERIVATIVE_INVALID", "Gallery copies must use multipart form data.");
  }

  const driveFile = await getDriveFile(ticket.driveFileId, env, fetcher(dependencies), true);
  if (!driveFile) throw new ApiError(409, "UPLOAD_INCOMPLETE", "Finish the original upload first.");
  verifyCompletedDriveFile(driveFile, ticket, env);
  if (await findMomentByIdPrivileged(ticket.momentId, env, fetcher(dependencies))) {
    throw new ApiError(
      409,
      "UPLOAD_ALREADY_COMPLETED",
      "Gallery copies cannot be replaced after the moment is finalized.",
    );
  }

  if (!request.body) {
    throw new ApiError(400, "DERIVATIVE_INVALID", "Those gallery copies could not be read.");
  }
  const multipartBytes = await collectBoundedBody(
    request.body,
    MAX_DERIVATIVE_REQUEST_BYTES,
    () => new ApiError(413, "DERIVATIVE_INVALID", "Those gallery copies are too large."),
  );
  if (multipartBytes.byteLength !== declaredLength) {
    throw new ApiError(400, "DERIVATIVE_INVALID", "That derivative request length is not valid.");
  }

  let form: FormData;
  try {
    form = await new Response(multipartBytes.buffer, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new ApiError(400, "DERIVATIVE_INVALID", "Those gallery copies could not be read.");
  }
  const gallery = requireDerivativeFile(form.get("gallery"), "gallery");
  if (gallery.type !== "image/webp") {
    throw new ApiError(415, "DERIVATIVE_INVALID", "The gallery copy must use WebP.");
  }
  if (gallery.size > MAX_GALLERY_BYTES) {
    throw new ApiError(413, "DERIVATIVE_INVALID", "Those gallery copies are too large.");
  }
  const galleryBuffer = await gallery.arrayBuffer();
  const galleryInfo = inspectMetadataFreeWebp(new Uint8Array(galleryBuffer));
  if (Math.max(galleryInfo.width, galleryInfo.height) > 1600) {
    throw new ApiError(400, "DERIVATIVE_INVALID", "The gallery copy must be at most 1600 pixels wide or tall.");
  }

  // Until a trusted processor creates a real thumbnail, one canonical image
  // is used for both moderation preview and public display. This prevents a
  // guest from presenting benign thumbnail bytes for a different gallery image.
  const galleryPath = `${ticket.momentId}/gallery.webp`;
  await uploadDerivative(galleryPath, galleryBuffer, env, fetcher(dependencies));
  const canonicalDerivative = {
    path: galleryPath,
    width: galleryInfo.width,
    height: galleryInfo.height,
    size: gallery.size,
    mimeType: "image/webp" as const,
  };
  const derivatives = { gallery: canonicalDerivative, thumbnail: canonicalDerivative };
  const uploadToken = await sealUploadTicket({ ...ticket, derivatives }, env);
  return jsonResponse({
    uploadToken,
    gallery: { uploaded: true, width: galleryInfo.width, height: galleryInfo.height },
    thumbnail: { uploaded: true, width: galleryInfo.width, height: galleryInfo.height },
  });
}

export async function completeUpload(
  request: Request,
  env: Env,
  sessionId: string,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const { ticket } = await requireUpload(request, env, sessionId);
  const driveFile = await getDriveFile(ticket.driveFileId, env, fetcher(dependencies), true);
  if (!driveFile) throw new ApiError(409, "UPLOAD_INCOMPLETE", "Finish uploading this moment first.");
  verifyCompletedDriveFile(driveFile, ticket, env);

  if (ticket.derivatives) {
    const galleryReady = await derivativeExists(
      ticket.derivatives.gallery.path,
      env,
      fetcher(dependencies),
    );
    const thumbnailReady =
      ticket.derivatives.thumbnail.path === ticket.derivatives.gallery.path
        ? galleryReady
        : await derivativeExists(
            ticket.derivatives.thumbnail.path,
            env,
            fetcher(dependencies),
          );
    if (!galleryReady || !thumbnailReady) {
      throw new ApiError(409, "DERIVATIVE_INVALID", "The gallery copies are not ready yet.");
    }
  }
  const originalDimensions =
    driveFile.originalWidth && driveFile.originalHeight
      ? { width: driveFile.originalWidth, height: driveFile.originalHeight }
      : undefined;
  const moment = await finalizeMoment(ticket, env, fetcher(dependencies), originalDimensions);
  return jsonResponse({ moment });
}

export async function cancelUpload(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  await requireUpload(request, env, sessionId);
  // Stateless tickets cannot be revoked. Stopping the client prevents further
  // chunks; an incomplete Google resumable session creates no Drive file and
  // expires independently. The short-lived sealed ticket remains the boundary.
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function publicMoments(
  request: Request,
  url: URL,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  await rateLimitClientIp(request, env.GALLERY_IP_RATE_LIMITER, "gallery-ip");
  if (url.searchParams.has("status")) {
    throw new ApiError(400, "INVALID_REQUEST", "The guest gallery does not accept a status filter.");
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.trunc(requestedLimit))) : 20;
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 10_000) {
    throw new ApiError(400, "INVALID_REQUEST", "That gallery page is not available.");
  }
  const page = await listApprovedMoments(limit, requestedOffset, env, fetcher(dependencies));
  return jsonResponse({
    moments: page.moments,
    nextOffset: page.hasMore ? requestedOffset + page.moments.length : null,
  });
}

export async function publicMoment(
  request: Request,
  id: string,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  await rateLimitClientIp(request, env.GALLERY_IP_RATE_LIMITER, "gallery-ip");
  const moment = await getApprovedMoment(id, env, fetcher(dependencies));
  return jsonResponse({ moment });
}

export async function adminSession(
  request: Request,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const admin = await requireAdmin(bearerToken(request), env, fetcher(dependencies));
  return jsonResponse({ authenticated: true, authorized: true, user: { id: admin.id, ...(admin.email ? { email: admin.email } : {}) } });
}

const MOMENT_STATUSES = new Set<MomentStatus>(["pending", "approved", "rejected", "hidden"]);

export async function adminMoments(
  request: Request,
  url: URL,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const admin = await requireAdmin(bearerToken(request), env, fetcher(dependencies));
  const rawStatus = url.searchParams.get("status") ?? "all";
  if (rawStatus !== "all" && !MOMENT_STATUSES.has(rawStatus as MomentStatus)) {
    throw new ApiError(400, "INVALID_STATUS", "That moderation filter is not available.");
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.trunc(requestedLimit))) : 20;
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 10_000) {
    throw new ApiError(400, "INVALID_REQUEST", "That moderation page is not available.");
  }
  const page = await listAdminMoments(
    admin,
    rawStatus as MomentStatus | "all",
    limit,
    requestedOffset,
    env,
    fetcher(dependencies),
  );
  return jsonResponse({
    moments: page.moments,
    nextOffset: page.hasMore ? requestedOffset + page.moments.length : null,
  });
}

export async function moderateMoment(
  request: Request,
  env: Env,
  id: string,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const admin = await requireAdmin(bearerToken(request), env, fetcher(dependencies));
  const input = await readJson<unknown>(request, 8 * 1024);
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(input, "status") ||
    typeof (input as Record<string, unknown>).status !== "string" ||
    !MOMENT_STATUSES.has((input as Record<string, unknown>).status as MomentStatus)
  ) {
    throw new ApiError(400, "INVALID_STATUS", "That moderation choice is not available.");
  }
  const status = (input as { status: MomentStatus }).status;
  const moment = await updateAdminMomentStatus(
    admin,
    id,
    status,
    env,
    fetcher(dependencies),
  );
  return jsonResponse({ moment });
}
