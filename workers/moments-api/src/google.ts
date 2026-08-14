import { ApiError } from "./errors.ts";
import type { Env, Fetcher, UploadTicketPayload } from "./types.ts";
import type { ValidatedInitFile } from "./validation.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ACCESS_TOKEN_SKEW_MS = 60_000;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let refreshPromise: Promise<string> | null = null;

export function resetGoogleTokenCacheForTests(): void {
  cachedAccessToken = null;
  refreshPromise = null;
}

function required(value: string | undefined, label: string): string {
  const result = value?.trim();
  if (!result) {
    throw new ApiError(
      500,
      "SERVER_MISCONFIGURED",
      `${label} is not configured for the Moments API.`,
    );
  }
  return result;
}

export async function getGoogleAccessToken(
  env: Env,
  fetcher: Fetcher = fetch,
  forceRefresh = false,
  now = Date.now(),
): Promise<string> {
  if (!forceRefresh && cachedAccessToken && cachedAccessToken.expiresAt - ACCESS_TOKEN_SKEW_MS > now) {
    return cachedAccessToken.token;
  }
  if (!forceRefresh && refreshPromise) return refreshPromise;

  const refresh = async (): Promise<string> => {
    const body = new URLSearchParams({
      client_id: required(env.GOOGLE_OAUTH_CLIENT_ID, "Google OAuth client ID"),
      client_secret: required(env.GOOGLE_OAUTH_CLIENT_SECRET, "Google OAuth client secret"),
      refresh_token: required(env.GOOGLE_OAUTH_REFRESH_TOKEN, "Google OAuth refresh token"),
      grant_type: "refresh_token",
    });
    let response: Response;
    try {
      response = await fetcher(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (cause) {
      throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.", {
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.", {
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
      throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.");
    }
    cachedAccessToken = {
      token: payload.access_token,
      expiresAt: now + payload.expires_in * 1000,
    };
    return payload.access_token;
  };

  refreshPromise = refresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function driveFetch(
  env: Env,
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
  allowAuthRetry = true,
): Promise<Response> {
  let token = await getGoogleAccessToken(env, fetcher);
  const perform = () => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetcher(url, { ...init, headers, redirect: "manual" }).catch((cause: unknown) => {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.", {
        retryable: true,
        cause,
      });
    });
  };
  let response = await perform();
  if (response.status === 401 && allowAuthRetry) {
    token = await getGoogleAccessToken(env, fetcher, true);
    response = await perform();
  }
  return response;
}

export async function generateDriveFileIds(
  count: number,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const url = `${DRIVE_API}/files/generateIds?count=${count}&space=drive&type=files`;
  const response = await driveFetch(env, url, { method: "GET" }, fetcher);
  if (!response.ok) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.", {
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  const payload = (await response.json()) as { ids?: unknown };
  if (!Array.isArray(payload.ids) || payload.ids.length !== count || payload.ids.some((id) => typeof id !== "string")) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Uploads are temporarily unavailable.");
  }
  return payload.ids as string[];
}

function serverDriveName(momentId: string, extension: string): string {
  return `${momentId}.${extension}`;
}

export async function initiateDriveUpload(
  options: {
    file: ValidatedInitFile;
    momentId: string;
    submissionId: string;
    driveFileId: string;
  },
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const folderId =
    options.file.mediaType === "video"
      ? required(env.GOOGLE_DRIVE_VIDEOS_FOLDER_ID, "Google Drive videos folder ID")
      : required(env.GOOGLE_DRIVE_ORIGINALS_FOLDER_ID, "Google Drive originals folder ID");
  const response = await driveFetch(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,size,mimeType,parents`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-length": String(options.file.fileSize),
        "x-upload-content-type": options.file.mimeType,
      },
      body: JSON.stringify({
        id: options.driveFileId,
        name: serverDriveName(options.momentId, options.file.extension),
        mimeType: options.file.mimeType,
        parents: [folderId],
        appProperties: {
          momentsId: options.momentId,
          submissionId: options.submissionId,
        },
      }),
    },
    fetcher,
  );
  const location = response.headers.get("location");
  if (!response.ok || !location) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "That upload could not be prepared just now.", {
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "That upload could not be prepared just now.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.googleapis.com") {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "That upload could not be prepared just now.");
  }
  return parsed.toString();
}

function nextOffsetFromRange(range: string | null): number {
  const match = /^bytes=0-(\d+)$/.exec(range ?? "");
  return match ? Number(match[1]) + 1 : 0;
}

export interface DriveUploadStatus {
  complete: boolean;
  nextOffset: number;
}

export async function getDriveUploadStatus(
  ticket: UploadTicketPayload,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<DriveUploadStatus> {
  const response = await driveFetch(
    env,
    ticket.driveUploadUri,
    {
      method: "PUT",
      headers: {
        "content-length": "0",
        "content-range": `bytes */${ticket.fileSize}`,
      },
    },
    fetcher,
  );
  if (response.status === 200 || response.status === 201) {
    return { complete: true, nextOffset: ticket.fileSize };
  }
  if (response.status === 308) {
    return { complete: false, nextOffset: nextOffsetFromRange(response.headers.get("range")) };
  }
  if (response.status === 404) {
    const file = await getDriveFile(ticket.driveFileId, env, fetcher, true);
    if (file) return { complete: true, nextOffset: ticket.fileSize };
    throw new ApiError(
      410,
      "UPLOAD_SESSION_EXPIRED",
      "That upload session expired. Please start the upload again.",
    );
  }
  throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The upload could not be resumed just now.", {
    retryable: response.status >= 500 || response.status === 429,
  });
}

export async function uploadDriveChunk(
  ticket: UploadTicketPayload,
  body: BodyInit,
  bodyLength: number,
  start: number,
  end: number,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<DriveUploadStatus> {
  const response = await driveFetch(
    env,
    ticket.driveUploadUri,
    {
      method: "PUT",
      headers: {
        "content-length": String(bodyLength),
        "content-range": `bytes ${start}-${end}/${ticket.fileSize}`,
        "content-type": ticket.mimeType,
      },
      body,
    },
    fetcher,
    !(body instanceof ReadableStream),
  );
  if (response.status === 401) {
    // A streamed request body cannot be replayed safely. Refresh now so the
    // client's bounded chunk retry can use a fresh token on its next request.
    await getGoogleAccessToken(env, fetcher, true);
  }
  if (response.status === 200 || response.status === 201) {
    return { complete: true, nextOffset: ticket.fileSize };
  }
  if (response.status === 308) {
    return { complete: false, nextOffset: nextOffsetFromRange(response.headers.get("range")) };
  }
  if (response.status === 404) {
    // A resumable session can expire after the caller's status probe but before
    // this chunk reaches Google. Reconcile a possibly completed final request
    // once, otherwise tell the client to discard the dead session and restart.
    const file = await getDriveFile(ticket.driveFileId, env, fetcher, true);
    if (file) return { complete: true, nextOffset: ticket.fileSize };
    throw new ApiError(
      410,
      "UPLOAD_SESSION_EXPIRED",
      "That upload session expired. Please start the upload again.",
    );
  }
  throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "That chunk could not be uploaded just now.", {
    retryable: response.status === 401 || response.status >= 500 || response.status === 429,
  });
}

export interface DriveFileRecord {
  id: string;
  size: number;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  originalWidth?: number;
  originalHeight?: number;
}

function driveMediaDimensions(value: Record<string, unknown>): { width: number; height: number } | null {
  for (const key of ["imageMediaMetadata", "videoMediaMetadata"] as const) {
    const metadata = value[key];
    if (typeof metadata !== "object" || metadata === null) continue;
    const width = (metadata as Record<string, unknown>).width;
    const height = (metadata as Record<string, unknown>).height;
    if (
      typeof width === "number" &&
      Number.isSafeInteger(width) &&
      width > 0 &&
      typeof height === "number" &&
      Number.isSafeInteger(height) &&
      height > 0
    ) {
      return { width, height };
    }
  }
  return null;
}

export async function getDriveFile(
  fileId: string,
  env: Env,
  fetcher: Fetcher = fetch,
  allowMissing = false,
): Promise<DriveFileRecord | null> {
  const response = await driveFetch(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,size,mimeType,parents,trashed,imageMediaMetadata(width,height),videoMediaMetadata(width,height)`,
    { method: "GET" },
    fetcher,
  );
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The uploaded original could not be verified just now.", {
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  const value = (await response.json()) as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.size !== "string" ||
    typeof value.mimeType !== "string" ||
    !Array.isArray(value.parents)
  ) {
    throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The uploaded original could not be verified just now.");
  }
  const dimensions = driveMediaDimensions(value);
  return {
    id: value.id,
    size: Number(value.size),
    mimeType: value.mimeType,
    parents: value.parents.filter((parent): parent is string => typeof parent === "string"),
    trashed: value.trashed === true,
    ...(dimensions ? { originalWidth: dimensions.width, originalHeight: dimensions.height } : {}),
  };
}

export function verifyCompletedDriveFile(file: DriveFileRecord, ticket: UploadTicketPayload, env: Env): void {
  const expectedFolder =
    ticket.mediaType === "video"
      ? required(env.GOOGLE_DRIVE_VIDEOS_FOLDER_ID, "Google Drive videos folder ID")
      : required(env.GOOGLE_DRIVE_ORIGINALS_FOLDER_ID, "Google Drive originals folder ID");
  if (
    file.id !== ticket.driveFileId ||
    file.size !== ticket.fileSize ||
    file.mimeType !== ticket.mimeType ||
    file.trashed ||
    !file.parents.includes(expectedFolder)
  ) {
    throw new ApiError(409, "UPLOAD_INCOMPLETE", "The uploaded original could not be verified.");
  }
}
