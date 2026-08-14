import { MOMENTS_CONFIG } from "../../../config/moments";
import {
  adminMomentFromDto,
  apiUrl,
  isAdminMomentsListResponseDto,
  isAnonymousSessionDto,
  isPublicMomentDto,
  isUpdateMomentStatusResponseDto,
  isUploadChunkResponseDto,
  isUploadCompleteResponseDto,
  isUploadDerivativesResponseDto,
  isUploadInitResponseDto,
  isUploadStatusResponseDto,
  momentsListGuard,
  MomentsApiError,
  publicMomentFromDto,
  readApiResponse,
  type AdminMomentsListResponseDto,
  type AnonymousSessionDto,
  type DisplayUrlPolicy,
  type MomentsListResponseDto,
  type PublicMomentDto,
  type UpdateMomentStatusResponseDto,
  type UploadChunkResponseDto,
  type UploadCompleteResponseDto,
  type UploadDerivativesResponseDto,
  type UploadInitRequestDto,
  type UploadInitResponseDto,
  type UploadSessionDto,
  type UploadStatusResponseDto,
} from "../api";
import { sortMomentsNewestFirst } from "../gallery";
import {
  prepareMomentMedia,
  type PreparedMomentMedia,
} from "../media";
import type {
  AdminMomentsOptions,
  AdminMomentsPage,
  GetMomentsOptions,
  Moment,
  MomentMediaType,
  MomentsProvider,
  MomentStatus,
  MomentUploadInput,
  MomentUploadProgress,
  MomentUploadResult,
  MomentsPage,
  UploadMomentOptions,
} from "../types";

const GUEST_SESSION_STORAGE_KEY = "our-journey:moments:guest-session:v1";
const MAX_CHUNK_ATTEMPTS = 3;
const MIN_CHUNK_SIZE = 256 * 1024;
const MAX_CHUNK_SIZE = 10 * 1024 * 1024;
const MOMENTS_PAGE_SIZE = 20;
const SUPABASE_SIGNED_OBJECT_PATH = "/storage/v1/object/sign/";

interface StoredGuestSession {
  readonly sessionToken: string;
  readonly expiresAt: string;
}

interface FileUploadState {
  readonly clientFileId: string;
  session?: UploadSessionDto;
  nextOffset: number;
  prepared?: Promise<PreparedMomentMedia>;
  receipt?: UploadCompleteResponseDto["moment"];
}

export interface RemoteMomentsProviderOptions {
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly prepareMedia?: typeof prepareMomentMedia;
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  readonly allowedDisplayOrigin?: string;
  readonly allowedDisplayPathPrefix?: string;
  readonly getAdminAccessToken?: () => Promise<string>;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function createIdentifier(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mediaTypeFor(file: File): MomentMediaType {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  return file.type.toLocaleLowerCase().startsWith("video/") ||
    extension === "mp4" ||
    extension === "mov"
    ? "video"
    : "photo";
}

function abortError(): DOMException {
  return new DOMException("The upload was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function defaultStorage(): RemoteMomentsProviderOptions["storage"] {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function validStoredSession(value: unknown): value is StoredGuestSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionToken" in value &&
    typeof value.sessionToken === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "string" &&
    Date.parse(value.expiresAt) > Date.now() + 60_000
  );
}

function reportProgress(
  callback: UploadMomentOptions["onProgress"],
  progress: MomentUploadProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // Rendering must never break a valid network upload.
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function defaultWait(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function normaliseChunkSize(chunkSize: number): number {
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < MIN_CHUNK_SIZE ||
    chunkSize > MAX_CHUNK_SIZE
  ) {
    throw new MomentsApiError(
      "UPLOAD_FAILED",
      "The upload service returned an invalid chunk size.",
    );
  }
  return chunkSize;
}

function normalisePageLimit(limit: number | undefined): number {
  const requestedLimit = Math.trunc(limit ?? MOMENTS_PAGE_SIZE);
  return Math.min(
    MOMENTS_PAGE_SIZE,
    Math.max(
      1,
      Number.isSafeInteger(requestedLimit) ? requestedLimit : MOMENTS_PAGE_SIZE,
    ),
  );
}

function normalisePageOffset(offset: number | undefined): number {
  const requestedOffset = Math.trunc(offset ?? 0);
  return Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
    ? requestedOffset
    : 0;
}

function validatedNextOffset(
  nextOffset: number | null,
  currentOffset: number,
  itemCount: number,
): number | null {
  if (
    nextOffset !== null &&
    (nextOffset <= currentOffset || itemCount === 0)
  ) {
    throw new MomentsApiError(
      "LOAD_FAILED",
      "The Moments API returned an invalid pagination cursor.",
    );
  }
  return nextOffset;
}

function createDisplayUrlPolicy(
  originValue: string,
  pathPrefixValue: string,
): DisplayUrlPolicy {
  let origin = "";
  try {
    const url = new URL(originValue);
    if (url.protocol === "https:" || url.protocol === "http:") {
      origin = url.origin;
    }
  } catch {
    // An empty origin makes every remote display URL fail closed.
  }
  const pathPrefix =
    pathPrefixValue.startsWith("/") && pathPrefixValue.endsWith("/")
      ? pathPrefixValue
      : "/__invalid-moments-display-path__/";
  return { origin, pathPrefix };
}

class RemoteMomentsProvider implements MomentsProvider {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly prepareMedia: typeof prepareMomentMedia;
  private readonly storage: RemoteMomentsProviderOptions["storage"];
  private readonly adminToken?: () => Promise<string>;
  private readonly wait: NonNullable<RemoteMomentsProviderOptions["wait"]>;
  private readonly displayUrlPolicy: DisplayUrlPolicy;
  private readonly fileStates = new WeakMap<File, FileUploadState>();
  private guestSession?: StoredGuestSession;

  constructor(options: RemoteMomentsProviderOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? MOMENTS_CONFIG.apiUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.prepareMedia = options.prepareMedia ?? prepareMomentMedia;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.adminToken = options.getAdminAccessToken;
    this.wait = options.wait ?? defaultWait;
    this.displayUrlPolicy = createDisplayUrlPolicy(
      options.allowedDisplayOrigin ?? MOMENTS_CONFIG.supabaseUrl,
      options.allowedDisplayPathPrefix ?? SUPABASE_SIGNED_OBJECT_PATH,
    );
  }

  private async fetchResponse(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(apiUrl(this.apiBaseUrl, path), init);
    } catch (cause) {
      if (isAbortError(cause) || init.signal?.aborted) throw abortError();
      throw new MomentsApiError(
        "NETWORK_ERROR",
        "We could not reach the Moments service. Check your connection and try again.",
        { retryable: true, cause },
      );
    }
  }

  private async jsonRequest<T>(
    path: string,
    init: RequestInit,
    guard?: (value: unknown) => value is T,
  ): Promise<T> {
    return readApiResponse<T>(await this.fetchResponse(path, init), guard);
  }

  private readStoredGuestSession(): StoredGuestSession | undefined {
    if (this.guestSession && validStoredSession(this.guestSession)) {
      return this.guestSession;
    }

    try {
      const rawValue = this.storage?.getItem(GUEST_SESSION_STORAGE_KEY);
      const parsed: unknown = rawValue ? JSON.parse(rawValue) : undefined;
      if (validStoredSession(parsed)) {
        this.guestSession = parsed;
        return parsed;
      }
      this.storage?.removeItem(GUEST_SESSION_STORAGE_KEY);
    } catch {
      // An anonymous token can remain memory-only when storage is unavailable.
    }

    return undefined;
  }

  private async getGuestSession(signal?: AbortSignal): Promise<StoredGuestSession> {
    const storedSession = this.readStoredGuestSession();
    if (storedSession) return storedSession;

    const session = await this.jsonRequest<AnonymousSessionDto>(
      "/v1/sessions/anonymous",
      { method: "POST", signal },
      isAnonymousSessionDto,
    );
    this.guestSession = session;

    try {
      this.storage?.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Memory-only sessions still support the current upload.
    }

    return session;
  }

  private stateFor(file: File): FileUploadState {
    let state = this.fileStates.get(file);
    if (!state) {
      state = {
        clientFileId: createIdentifier("file"),
        nextOffset: 0,
      };
      this.fileStates.set(file, state);
    }
    return state;
  }

  private uploadHeaders(
    guestToken: string,
    uploadToken: string,
    additional: HeadersInit = {},
  ): Headers {
    const headers = new Headers(additional);
    headers.set("X-Guest-Session", guestToken);
    headers.set("X-Moments-Upload-Token", uploadToken);
    return headers;
  }

  private async initializeUpload(
    input: MomentUploadInput,
    states: readonly FileUploadState[],
    guestToken: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const pendingFiles = input.files.flatMap((file, index) =>
      states[index]!.receipt || states[index]!.session ? [] : [{ file, index }],
    );
    if (pendingFiles.length === 0) return;

    const request: UploadInitRequestDto = {
      guestName: input.guestName.trim(),
      caption: input.caption?.trim() ?? "",
      files: pendingFiles.map(({ file, index }) => ({
        clientFileId: states[index]!.clientFileId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        mediaType: mediaTypeFor(file),
      })),
    };
    const response = await this.jsonRequest<UploadInitResponseDto>(
      "/v1/uploads/init",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Guest-Session": guestToken,
        },
        body: JSON.stringify(request),
        signal,
      },
      isUploadInitResponseDto,
    );
    const sessions = new Map(
      response.files.map((session) => [session.clientFileId, session]),
    );

    for (const state of states) {
      if (state.receipt || state.session) continue;
      const session = sessions.get(state.clientFileId);
      if (!session) {
        throw new MomentsApiError(
          "UPLOAD_FAILED",
          "The upload service did not prepare every selected file.",
        );
      }
      normaliseChunkSize(session.chunkSize);
      state.session = session;
      state.nextOffset = session.nextOffset;
    }
  }

  private async getUploadStatus(
    state: FileUploadState,
    guestToken: string,
    signal?: AbortSignal,
  ): Promise<UploadStatusResponseDto> {
    const session = state.session;
    if (!session) throw new MomentsApiError("SESSION_EXPIRED", "Upload session missing.");
    return this.jsonRequest<UploadStatusResponseDto>(
      `/v1/uploads/${encodeURIComponent(session.sessionId)}`,
      {
        headers: this.uploadHeaders(guestToken, session.uploadToken),
        signal,
      },
      isUploadStatusResponseDto,
    );
  }

  private async sendChunk(
    file: File,
    state: FileUploadState,
    guestToken: string,
    signal?: AbortSignal,
  ): Promise<UploadChunkResponseDto> {
    const session = state.session;
    if (!session) throw new MomentsApiError("SESSION_EXPIRED", "Upload session missing.");
    const chunkSize = normaliseChunkSize(session.chunkSize);
    const start = state.nextOffset;
    const end = Math.min(file.size, start + chunkSize);
    const chunkIndex = Math.floor(start / chunkSize);
    const body = file.slice(start, end, file.type || "application/octet-stream");
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await this.jsonRequest<UploadChunkResponseDto>(
          `/v1/uploads/${encodeURIComponent(session.sessionId)}/chunks/${chunkIndex}`,
          {
            method: "PUT",
            headers: this.uploadHeaders(guestToken, session.uploadToken, {
              "Content-Type": file.type || "application/octet-stream",
              "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
            }),
            body,
            signal,
          },
          isUploadChunkResponseDto,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
        const retryable =
          error instanceof MomentsApiError && error.retryable && attempt + 1 < MAX_CHUNK_ATTEMPTS;
        if (!retryable) throw error;

        // A mobile connection may lose the response after Drive accepted the
        // chunk. Reconcile the authoritative offset before resending bytes.
        try {
          const status = await this.getUploadStatus(state, guestToken, signal);
          if (status.nextOffset > start) {
            return {
              sessionId: status.sessionId,
              nextOffset: status.nextOffset,
              uploadedBytes: status.nextOffset,
              totalBytes: status.totalBytes,
              complete: status.complete,
            };
          }
        } catch (statusError) {
          if (isAbortError(statusError)) throw statusError;
        }

        const retryDelay =
          error instanceof MomentsApiError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1000
            : 450 * 2 ** attempt;
        await this.wait(Math.min(retryDelay, 4_000), signal);
      }
    }

    throw lastError;
  }

  private async uploadDerivatives(
    state: FileUploadState,
    prepared: PreparedMomentMedia,
    guestToken: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const session = state.session;
    if (!session || !prepared.gallery) return;
    const formData = new FormData();
    formData.append("gallery", prepared.gallery.blob, "gallery.webp");

    for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.jsonRequest<UploadDerivativesResponseDto>(
          `/v1/uploads/${encodeURIComponent(session.sessionId)}/derivatives`,
          {
            method: "POST",
            headers: this.uploadHeaders(guestToken, session.uploadToken),
            body: formData,
            signal,
          },
          isUploadDerivativesResponseDto,
        );
        // The replacement sealed token binds the server-validated derivative
        // paths and dimensions. Never derive this state in the browser.
        state.session = { ...session, uploadToken: result.uploadToken };
        return;
      } catch (error) {
        if (isAbortError(error)) throw error;
        const retryable =
          error instanceof MomentsApiError &&
          error.retryable &&
          attempt + 1 < MAX_CHUNK_ATTEMPTS;
        if (!retryable) {
          // Derivatives are an optimization. The private original remains valid
          // and backend processing can prepare HEIC or permanent conversion failures.
          return;
        }
        const retryDelay = error.retryAfterSeconds
          ? error.retryAfterSeconds * 1000
          : 450 * 2 ** attempt;
        await this.wait(Math.min(retryDelay, 4_000), signal);
      }
    }
  }

  private async completeUpload(
    state: FileUploadState,
    guestToken: string,
    signal?: AbortSignal,
  ): Promise<UploadCompleteResponseDto["moment"]> {
    const session = state.session;
    if (!session) throw new MomentsApiError("SESSION_EXPIRED", "Upload session missing.");
    const result = await this.jsonRequest<UploadCompleteResponseDto>(
      `/v1/uploads/${encodeURIComponent(session.sessionId)}/complete`,
      {
        method: "POST",
        headers: this.uploadHeaders(guestToken, session.uploadToken, {
          "Content-Type": "application/json",
        }),
        body: "{}",
        signal,
      },
      isUploadCompleteResponseDto,
    );
    state.receipt = result.moment;
    return result.moment;
  }

  private aggregateProgress(
    files: readonly File[],
    states: readonly FileUploadState[],
    phase: MomentUploadProgress["phase"],
    currentFileName?: string,
  ): MomentUploadProgress {
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    const uploadedBytes = states.reduce(
      (total, state, index) =>
        total + Math.min(files[index]?.size ?? 0, state.receipt ? files[index]!.size : state.nextOffset),
      0,
    );
    const completedFiles = states.filter((state) => state.receipt).length;
    return {
      phase,
      completedFiles,
      totalFiles: files.length,
      uploadedBytes,
      totalBytes,
      percentage:
        totalBytes === 0 ? 0 : Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)),
      currentFileName,
    };
  }

  private async abandonSessions(
    files: readonly File[],
    states: readonly FileUploadState[],
    guestToken: string,
  ): Promise<void> {
    await Promise.allSettled(
      states.map(async (state) => {
        if (!state.session || state.receipt) return;
        await this.fetchResponse(
          `/v1/uploads/${encodeURIComponent(state.session.sessionId)}`,
          {
            method: "DELETE",
            headers: this.uploadHeaders(guestToken, state.session.uploadToken),
            signal:
              typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(5_000)
                : undefined,
          },
        );
      }),
    );
    for (const file of files) this.fileStates.delete(file);
  }

  async uploadMoment(
    input: MomentUploadInput,
    options: UploadMomentOptions = {},
  ): Promise<MomentUploadResult> {
    const states = input.files.map((file) => this.stateFor(file));
    const totalBytes = input.files.reduce((total, file) => total + file.size, 0);
    reportProgress(options.onProgress, {
      phase: "preparing",
      completedFiles: 0,
      totalFiles: input.files.length,
      uploadedBytes: 0,
      totalBytes,
      percentage: 0,
    });
    const guestSession = await this.getGuestSession(options.signal);

    try {
      await this.initializeUpload(
        input,
        states,
        guestSession.sessionToken,
        options.signal,
      );

      for (const [index, file] of input.files.entries()) {
        const state = states[index]!;
        if (state.receipt) continue;
        if (!state.prepared) {
          const preparation = this.prepareMedia(
            file,
            mediaTypeFor(file),
            options.signal,
          );
          // Chunk upload and media preparation run concurrently. Observe the
          // preparation immediately so an earlier upload abort cannot leave a
          // later preparation rejection unhandled; awaiting the original
          // promise below still preserves its error for the normal path.
          void preparation.catch(() => undefined);
          state.prepared = preparation;
        }

        while (state.nextOffset < file.size) {
          const chunk = await this.sendChunk(
            file,
            state,
            guestSession.sessionToken,
            options.signal,
          );
          if (
            !Number.isSafeInteger(chunk.nextOffset) ||
            chunk.nextOffset <= state.nextOffset ||
            chunk.nextOffset > file.size
          ) {
            throw new MomentsApiError(
              "UPLOAD_FAILED",
              "The upload service returned an invalid file offset.",
            );
          }
          state.nextOffset = chunk.nextOffset;
          reportProgress(
            options.onProgress,
            this.aggregateProgress(input.files, states, "uploading", file.name),
          );
        }

        reportProgress(
          options.onProgress,
          this.aggregateProgress(input.files, states, "finalizing", file.name),
        );
        const prepared = await state.prepared;
        await this.uploadDerivatives(
          state,
          prepared,
          guestSession.sessionToken,
          options.signal,
        );
        await this.completeUpload(
          state,
          guestSession.sessionToken,
          options.signal,
        );
      }

      const submissions = states.flatMap((state) =>
        state.receipt ? [state.receipt] : [],
      );
      reportProgress(options.onProgress, {
        phase: "complete",
        completedFiles: input.files.length,
        totalFiles: input.files.length,
        uploadedBytes: totalBytes,
        totalBytes,
        percentage: 100,
      });
      for (const file of input.files) this.fileStates.delete(file);
      return { submissions };
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        await this.abandonSessions(
          input.files,
          states,
          guestSession.sessionToken,
        );
        throw abortError();
      }
      if (error instanceof MomentsApiError && error.code === "SESSION_EXPIRED") {
        for (const state of states) {
          if (!state.receipt) {
            state.session = undefined;
            state.nextOffset = 0;
          }
        }
      }
      throw error;
    }
  }

  async getMoments(options: GetMomentsOptions = {}): Promise<MomentsPage> {
    const limit = normalisePageLimit(options.limit);
    const offset = normalisePageOffset(options.offset);
    const result = await this.jsonRequest<MomentsListResponseDto<PublicMomentDto>>(
      `/v1/moments?limit=${limit}&offset=${offset}`,
      { headers: { Accept: "application/json" } },
      momentsListGuard(isPublicMomentDto),
    );
    const momentsById = new Map<string, Moment>();
    for (const momentDto of result.moments) {
      if (!momentsById.has(momentDto.id)) {
        momentsById.set(
          momentDto.id,
          publicMomentFromDto(momentDto, this.displayUrlPolicy),
        );
      }
    }
    return {
      moments: sortMomentsNewestFirst([...momentsById.values()]),
      nextOffset: validatedNextOffset(
        result.nextOffset,
        offset,
        result.moments.length,
      ),
    };
  }

  private async getAdminToken(): Promise<string> {
    if (this.adminToken) return this.adminToken();
    const { getAdminAccessToken } = await import("../admin-auth");
    return getAdminAccessToken();
  }

  async getAdminMoments(
    options: AdminMomentsOptions = {},
  ): Promise<AdminMomentsPage> {
    const token = await this.getAdminToken();
    const status = options.status ?? "all";
    const limit = normalisePageLimit(options.limit);
    const offset = normalisePageOffset(options.offset);
    const query = [
      `status=${encodeURIComponent(status)}`,
      `limit=${limit}`,
      `offset=${offset}`,
    ].join("&");
    const result = await this.jsonRequest<AdminMomentsListResponseDto>(
      `/v1/admin/moments?${query}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      isAdminMomentsListResponseDto,
    );
    const momentsById = new Map<string, Moment>();
    for (const momentDto of result.moments) {
      if (!momentsById.has(momentDto.id)) {
        momentsById.set(
          momentDto.id,
          adminMomentFromDto(momentDto, this.displayUrlPolicy),
        );
      }
    }
    return {
      moments: sortMomentsNewestFirst([...momentsById.values()]),
      nextOffset: validatedNextOffset(
        result.nextOffset,
        offset,
        result.moments.length,
      ),
    };
  }

  async deletePendingUpload(): Promise<void> {
    throw new MomentsApiError(
      "DELETE_FAILED",
      "Remote moment deletion is not available in this phase.",
    );
  }

  async updateMomentStatus(id: string, status: MomentStatus): Promise<Moment> {
    const token = await this.getAdminToken();
    const result = await this.jsonRequest<UpdateMomentStatusResponseDto>(
      `/v1/admin/moments/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      },
      isUpdateMomentStatusResponseDto,
    );
    return adminMomentFromDto(result.moment, this.displayUrlPolicy);
  }
}

export function createRemoteMomentsProvider(
  options: RemoteMomentsProviderOptions = {},
): MomentsProvider {
  return new RemoteMomentsProvider(options);
}

export const remoteMomentsProvider = createRemoteMomentsProvider();
