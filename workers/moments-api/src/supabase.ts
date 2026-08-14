import { ApiError } from "./errors.ts";
import type {
  Env,
  Fetcher,
  MomentStatus,
  SupabaseMomentInsert,
  SupabaseMomentRow,
  SupabasePrivilegedMomentRow,
  UploadTicketPayload,
} from "./types.ts";

const PUBLIC_SELECT = [
  "id",
  "guest_name",
  "caption",
  "created_at",
  "media_type",
  "width",
  "height",
  "gallery_path",
  "thumbnail_path",
  "status",
].join(",");
const ADMIN_SELECT = [
  PUBLIC_SELECT,
  "updated_at",
  "mime_type",
  "file_name",
  "file_size",
  "processing_status",
  "moderated_at",
].join(",");

function baseUrl(env: Env): string {
  const value = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!value) {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "Supabase is not configured for the Moments API.");
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "Supabase is not configured for the Moments API.");
  }
}

function keyFor(env: Env, privileged: boolean): string {
  const value = privileged ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!value?.trim()) {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "Supabase API keys are not configured.");
  }
  return value.trim();
}

async function supabaseFetch(
  env: Env,
  path: string,
  options: RequestInit & { privileged?: boolean; jwt?: string } = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const { privileged = false, jwt, ...init } = options;
  const apiKey = keyFor(env, privileged);
  const headers = new Headers(init.headers);
  headers.set("apikey", apiKey);
  if (jwt) {
    headers.set("authorization", `Bearer ${jwt}`);
  } else if (apiKey.startsWith("eyJ")) {
    // Legacy Supabase anon/service-role keys are JWTs. New sb_publishable_ and
    // sb_secret_ keys are opaque and belong only in the apikey header.
    headers.set("authorization", `Bearer ${apiKey}`);
  } else {
    headers.delete("authorization");
  }
  try {
    return await fetcher(`${baseUrl(env)}${path}`, { ...init, headers });
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The Moments data service is temporarily unavailable.", {
      retryable: true,
      cause,
    });
  }
}

function upstreamError(response: Response, message: string): ApiError {
  return new ApiError(503, "UPSTREAM_UNAVAILABLE", message, {
    retryable: response.status >= 500 || response.status === 429,
  });
}

function storagePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function bucket(env: Env): string {
  return env.MOMENTS_DERIVATIVES_BUCKET?.trim() || "moments-gallery";
}

function signedUrlTtl(env: Env): number {
  const configured = Number(env.MOMENTS_SIGNED_URL_TTL_SECONDS ?? 900);
  return Number.isFinite(configured)
    ? Math.max(60, Math.min(3600, Math.trunc(configured)))
    : 900;
}

export async function uploadDerivative(
  path: string,
  bytes: ArrayBuffer,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await supabaseFetch(
    env,
    `/storage/v1/object/${encodeURIComponent(bucket(env))}/${storagePath(path)}`,
    {
      privileged: true,
      method: "POST",
      headers: {
        "content-type": "image/webp",
        "cache-control": String(signedUrlTtl(env)),
        "x-upsert": "false",
      },
      body: bytes,
    },
    fetcher,
  );
  if (response.ok) return;
  if (response.status !== 400 && response.status !== 409) {
    throw upstreamError(response, "The gallery copy could not be stored just now.");
  }

  const matches = await storedDerivativeMatches(path, new Uint8Array(bytes), env, fetcher);
  if (matches === null) {
    throw upstreamError(response, "The gallery copy could not be stored just now.");
  }
  if (!matches) {
    throw new ApiError(
      409,
      "DERIVATIVE_INVALID",
      "Gallery copies were already prepared for that upload.",
    );
  }
}

async function storedDerivativeMatches(
  path: string,
  expected: Uint8Array,
  env: Env,
  fetcher: Fetcher,
): Promise<boolean | null> {
  const response = await supabaseFetch(
    env,
    `/storage/v1/object/${encodeURIComponent(bucket(env))}/${storagePath(path)}`,
    { privileged: true, method: "GET" },
    fetcher,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw upstreamError(response, "The gallery copy could not be verified just now.");
  }

  const declaredHeader = response.headers.get("content-length");
  if (declaredHeader !== null) {
    const declaredLength = Number(declaredHeader);
    if (Number.isFinite(declaredLength) && declaredLength !== expected.byteLength) return false;
  }
  if (!response.body) return false;
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > expected.byteLength) {
        await reader.cancel();
        return false;
      }
      for (let index = 0; index < chunk.value.byteLength; index += 1) {
        if (chunk.value[index] !== expected[offset + index]) {
          await reader.cancel();
          return false;
        }
      }
      offset += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return offset === expected.byteLength;
}

export async function derivativeExists(
  path: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const response = await supabaseFetch(
    env,
    `/storage/v1/object/${encodeURIComponent(bucket(env))}/${storagePath(path)}`,
    { privileged: true, method: "HEAD" },
    fetcher,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw upstreamError(response, "The gallery copy could not be verified just now.");
  return true;
}

export async function signDerivativeUrl(
  path: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const response = await supabaseFetch(
    env,
    `/storage/v1/object/sign/${encodeURIComponent(bucket(env))}/${storagePath(path)}`,
    {
      privileged: true,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: signedUrlTtl(env) }),
    },
    fetcher,
  );
  if (!response.ok) throw upstreamError(response, "A gallery image could not be prepared just now.");
  const payload = (await response.json()) as Record<string, unknown>;
  const signedPath =
    typeof payload.signedURL === "string"
      ? payload.signedURL
      : typeof payload.signedUrl === "string"
        ? payload.signedUrl
        : null;
  if (!signedPath) throw upstreamError(response, "A gallery image could not be prepared just now.");

  const projectBase = baseUrl(env);
  let resolved: URL;
  try {
    if (signedPath.startsWith("/object/")) {
      resolved = new URL(`${projectBase}/storage/v1${signedPath}`);
    } else if (signedPath.startsWith("/storage/v1/object/")) {
      resolved = new URL(`${projectBase}${signedPath}`);
    } else {
      resolved = new URL(signedPath);
    }
  } catch {
    throw upstreamError(response, "A gallery image could not be prepared just now.");
  }
  const project = new URL(projectBase);
  if (
    resolved.origin !== project.origin ||
    !resolved.pathname.startsWith("/storage/v1/object/sign/")
  ) {
    throw upstreamError(response, "A gallery image could not be prepared just now.");
  }
  return resolved.toString();
}

export interface PublicMomentDto {
  id: string;
  guestName: string;
  caption: string;
  createdAt: string;
  mediaType: "photo" | "video";
  status: "approved";
  width?: number;
  height?: number;
  galleryUrl: string;
  thumbnailUrl: string;
}

export interface AdminMomentDto extends Omit<PublicMomentDto, "galleryUrl" | "thumbnailUrl" | "status"> {
  galleryUrl?: string;
  thumbnailUrl?: string;
  status: MomentStatus;
  mimeType: string;
  fileName: string;
  fileSize: number;
  processingStatus: "pending" | "ready" | "failed";
  moderatedAt?: string;
}

async function signDerivativePair(
  galleryPath: string,
  thumbnailPath: string,
  env: Env,
  fetcher: Fetcher,
): Promise<[string, string]> {
  const galleryUrl = await signDerivativeUrl(galleryPath, env, fetcher);
  if (thumbnailPath === galleryPath) return [galleryUrl, galleryUrl];
  return [galleryUrl, await signDerivativeUrl(thumbnailPath, env, fetcher)];
}

async function mapPublicMoment(
  row: SupabaseMomentRow,
  env: Env,
  fetcher: Fetcher,
): Promise<PublicMomentDto> {
  if (row.status !== "approved" || !row.gallery_path || !row.thumbnail_path) {
    throw new ApiError(404, "NOT_FOUND", "That moment is not available in the gallery.");
  }
  const [galleryUrl, thumbnailUrl] = await signDerivativePair(
    row.gallery_path,
    row.thumbnail_path,
    env,
    fetcher,
  );
  return {
    id: row.id,
    guestName: row.guest_name,
    caption: row.caption ?? "",
    createdAt: row.created_at,
    mediaType: row.media_type,
    status: "approved",
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    galleryUrl,
    thumbnailUrl,
  };
}

async function mapAdminMoment(
  row: SupabaseMomentRow,
  env: Env,
  fetcher: Fetcher,
): Promise<AdminMomentDto> {
  const signed =
    row.gallery_path && row.thumbnail_path
      ? await signDerivativePair(row.gallery_path, row.thumbnail_path, env, fetcher)
      : null;
  return {
    id: row.id,
    guestName: row.guest_name,
    caption: row.caption ?? "",
    createdAt: row.created_at,
    mediaType: row.media_type,
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    ...(signed ? { galleryUrl: signed[0], thumbnailUrl: signed[1] } : {}),
    status: row.status,
    mimeType: row.mime_type,
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    processingStatus: row.processing_status ?? "pending",
    ...(row.moderated_at ? { moderatedAt: row.moderated_at } : {}),
  };
}

export async function listApprovedMoments(
  limit: number,
  offset: number,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<{ moments: PublicMomentDto[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    select: PUBLIC_SELECT,
    status: "eq.approved",
    processing_status: "eq.ready",
    gallery_path: "not.is.null",
    thumbnail_path: "not.is.null",
    order: "created_at.desc,id.desc",
    limit: String(limit + 1),
    offset: String(offset),
  });
  const response = await supabaseFetch(env, `/rest/v1/moments?${query}`, {}, fetcher);
  if (!response.ok) throw upstreamError(response, "The gallery could not be loaded just now.");
  const rows = (await response.json()) as SupabaseMomentRow[];
  const pageRows = rows.slice(0, limit);
  return {
    moments: await Promise.all(pageRows.map((row) => mapPublicMoment(row, env, fetcher))),
    hasMore: rows.length > limit,
  };
}

export async function getApprovedMoment(
  id: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<PublicMomentDto> {
  const query = new URLSearchParams({
    select: PUBLIC_SELECT,
    id: `eq.${id}`,
    status: "eq.approved",
    processing_status: "eq.ready",
    limit: "1",
  });
  const response = await supabaseFetch(env, `/rest/v1/moments?${query}`, {}, fetcher);
  if (!response.ok) throw upstreamError(response, "That moment could not be loaded just now.");
  const row = ((await response.json()) as SupabaseMomentRow[])[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "That moment could not be found.");
  return mapPublicMoment(row, env, fetcher);
}

export interface AdminIdentity {
  id: string;
  email?: string;
  jwt: string;
}

export async function requireAdmin(
  jwt: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<AdminIdentity> {
  const userResponse = await supabaseFetch(
    env,
    "/auth/v1/user",
    { method: "GET", jwt },
    fetcher,
  );
  if (!userResponse.ok) {
    throw new ApiError(401, "AUTH_REQUIRED", "Your admin session has expired. Please sign in again.");
  }
  const user = (await userResponse.json()) as Record<string, unknown>;
  if (typeof user.id !== "string") {
    throw new ApiError(401, "AUTH_REQUIRED", "Your admin session is not valid.");
  }
  const query = new URLSearchParams({ select: "user_id", user_id: `eq.${user.id}`, limit: "1" });
  const adminResponse = await supabaseFetch(
    env,
    `/rest/v1/moment_admins?${query}`,
    { method: "GET", jwt },
    fetcher,
  );
  if (!adminResponse.ok) throw upstreamError(adminResponse, "Admin access could not be checked just now.");
  const admins = (await adminResponse.json()) as unknown[];
  if (admins.length === 0) {
    throw new ApiError(403, "ACCESS_DENIED", "This account is not authorized to moderate Moments.");
  }
  return { id: user.id, ...(typeof user.email === "string" ? { email: user.email } : {}), jwt };
}

export async function listAdminMoments(
  admin: AdminIdentity,
  status: MomentStatus | "all",
  limit: number,
  offset: number,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<{ moments: AdminMomentDto[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    select: ADMIN_SELECT,
    order: "created_at.desc,id.desc",
    limit: String(limit + 1),
    offset: String(offset),
  });
  if (status !== "all") query.set("status", `eq.${status}`);
  const response = await supabaseFetch(
    env,
    `/rest/v1/moments?${query}`,
    { method: "GET", jwt: admin.jwt },
    fetcher,
  );
  if (!response.ok) throw upstreamError(response, "The moderation queue could not be loaded just now.");
  const rows = (await response.json()) as SupabaseMomentRow[];
  const pageRows = rows.slice(0, limit);
  return {
    moments: await Promise.all(pageRows.map((row) => mapAdminMoment(row, env, fetcher))),
    hasMore: rows.length > limit,
  };
}

const TRANSITIONS: Readonly<Record<MomentStatus, ReadonlySet<MomentStatus>>> = {
  pending: new Set(["approved", "rejected"]),
  approved: new Set(["hidden", "rejected"]),
  rejected: new Set(["pending"]),
  hidden: new Set(["approved"]),
};

export async function updateAdminMomentStatus(
  admin: AdminIdentity,
  id: string,
  nextStatus: MomentStatus,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<AdminMomentDto> {
  const readQuery = new URLSearchParams({ select: ADMIN_SELECT, id: `eq.${id}`, limit: "1" });
  const readResponse = await supabaseFetch(
    env,
    `/rest/v1/moments?${readQuery}`,
    { method: "GET", jwt: admin.jwt },
    fetcher,
  );
  if (!readResponse.ok) throw upstreamError(readResponse, "That moment could not be updated just now.");
  const current = ((await readResponse.json()) as SupabaseMomentRow[])[0];
  if (!current) throw new ApiError(404, "NOT_FOUND", "That moment could not be found.");
  if (current.status !== nextStatus && !TRANSITIONS[current.status].has(nextStatus)) {
    throw new ApiError(409, "INVALID_STATUS", "That moderation change is not available.");
  }
  if (
    current.status !== nextStatus &&
    nextStatus === "approved" &&
    (current.processing_status !== "ready" ||
      !current.gallery_path ||
      !current.thumbnail_path ||
      current.gallery_path !== current.thumbnail_path ||
      current.width === null ||
      current.width <= 0 ||
      current.height === null ||
      current.height <= 0)
  ) {
    throw new ApiError(409, "INVALID_STATUS", "That moment is not ready to approve yet.");
  }
  if (current.status === nextStatus) return mapAdminMoment(current, env, fetcher);

  const updateQuery = new URLSearchParams({
    select: ADMIN_SELECT,
    id: `eq.${id}`,
    status: `eq.${current.status}`,
  });
  const updateResponse = await supabaseFetch(
    env,
    `/rest/v1/moments?${updateQuery}`,
    {
      method: "PATCH",
      jwt: admin.jwt,
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ status: nextStatus }),
    },
    fetcher,
  );
  if (!updateResponse.ok) throw upstreamError(updateResponse, "That moment could not be updated just now.");
  const updated = ((await updateResponse.json()) as SupabaseMomentRow[])[0];
  if (!updated) {
    throw new ApiError(409, "INVALID_STATUS", "That moment changed in another moderation session. Refresh and try again.");
  }
  return mapAdminMoment(updated, env, fetcher);
}

export async function findMomentByIdPrivileged(
  id: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<SupabasePrivilegedMomentRow | null> {
  const query = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
  const response = await supabaseFetch(
    env,
    `/rest/v1/moments?${query}`,
    { privileged: true },
    fetcher,
  );
  if (!response.ok) throw upstreamError(response, "The upload could not be finalized just now.");
  return ((await response.json()) as SupabasePrivilegedMomentRow[])[0] ?? null;
}

export async function finalizeMoment(
  ticket: UploadTicketPayload,
  env: Env,
  fetcher: Fetcher = fetch,
  originalDimensions?: { width: number; height: number },
): Promise<{ id: string; status: "pending" | "approved"; createdAt: string; mediaType: "photo" | "video" }> {
  const receipt = (row: SupabaseMomentRow) => ({
    id: row.id,
    status:
      row.status === "pending" || row.status === "approved"
        ? row.status
        : env.MOMENTS_REQUIRE_MODERATION === "false"
          ? "approved" as const
          : "pending" as const,
    createdAt: row.created_at,
    mediaType: row.media_type,
  });
  const existing = await findMomentByIdPrivileged(ticket.momentId, env, fetcher);
  if (existing) {
    if (existing.drive_file_id !== ticket.driveFileId) {
      throw new ApiError(409, "UPLOAD_ALREADY_COMPLETED", "That upload identifier is already in use.");
    }
    return receipt(existing);
  }

  const derivativesReady = Boolean(ticket.derivatives?.gallery && ticket.derivatives.thumbnail);
  const body: SupabaseMomentInsert = {
    id: ticket.momentId,
    submission_id: ticket.submissionId,
    guest_name: ticket.guestName,
    caption: ticket.caption,
    created_at: ticket.createdAt,
    media_type: ticket.mediaType,
    mime_type: ticket.mimeType,
    file_name: ticket.fileName,
    file_size: ticket.fileSize,
    width: ticket.derivatives?.gallery.width ?? null,
    height: ticket.derivatives?.gallery.height ?? null,
    original_width: originalDimensions?.width ?? null,
    original_height: originalDimensions?.height ?? null,
    drive_file_id: ticket.driveFileId,
    gallery_path: ticket.derivatives?.gallery.path ?? null,
    thumbnail_path: ticket.derivatives?.thumbnail.path ?? null,
    status: env.MOMENTS_REQUIRE_MODERATION === "false" ? "approved" : "pending",
    guest_session_id: ticket.guestSessionId,
    processing_status: derivativesReady ? "ready" : "pending",
  };
  const response = await supabaseFetch(
    env,
    "/rest/v1/moments?on_conflict=id",
    {
      privileged: true,
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(body),
    },
    fetcher,
  );
  if (!response.ok) throw upstreamError(response, "The upload could not be finalized just now.");
  const inserted = ((await response.json()) as SupabasePrivilegedMomentRow[])[0];
  if (inserted) {
    return receipt(inserted);
  }
  const reconciled = await findMomentByIdPrivileged(ticket.momentId, env, fetcher);
  if (!reconciled || reconciled.drive_file_id !== ticket.driveFileId) {
    throw new ApiError(409, "UPLOAD_ALREADY_COMPLETED", "That upload could not be reconciled safely.");
  }
  return receipt(reconciled);
}
