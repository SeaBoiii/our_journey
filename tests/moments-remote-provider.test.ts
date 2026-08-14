import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

import {
  AdminMagicLinkUnavailableError,
  createAdminAuthStorage,
  isAccountNeutralMagicLinkError,
  isAdminPageEmbedded,
  normaliseAdminMagicLinkFailure,
} from "../src/lib/moments/admin-auth.ts";
import { MomentsApiError } from "../src/lib/moments/api.ts";
import {
  isMomentReadyForApproval,
  mergeMomentsById,
} from "../src/lib/moments/gallery.ts";
import {
  createRemoteMomentsProvider,
  type RemoteMomentsProviderOptions,
} from "../src/lib/moments/providers/remote.ts";
import type {
  Moment,
  MomentUploadProgress,
  MomentsProvider,
} from "../src/lib/moments/types.ts";

const API_BASE_URL = "https://moments.example.test/api";
const DISPLAY_ORIGIN = "https://project.supabase.co";
const DISPLAY_PATH_PREFIX = "/storage/v1/object/sign/";
const CHUNK_SIZE = 8 * 1024 * 1024;
const FUTURE_EXPIRY = "2099-08-14T00:00:00.000Z";

function signedUrl(fileName: string): string {
  return `${DISPLAY_ORIGIN}${DISPLAY_PATH_PREFIX}moments/${fileName}?token=test-token`;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ data }), { ...init, headers });
}

function errorResponse(
  error: Record<string, unknown>,
  init: ResponseInit,
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error }), { ...init, headers });
}

function pathFor(input: RequestInfo | URL): string {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
  return `${url.pathname}${url.search}`;
}

function requestHeaders(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function makeFile(
  size: number,
  name = "wedding portrait.jpg",
  type = "image/jpeg",
): File {
  return new File([new Uint8Array(size)], name, {
    type,
    lastModified: 1_786_672_800_000,
  });
}

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function makeProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<RemoteMomentsProviderOptions> = {},
): MomentsProvider {
  return createRemoteMomentsProvider({
    apiBaseUrl: API_BASE_URL,
    fetchImpl,
    storage: null,
    wait: async () => {},
    allowedDisplayOrigin: DISPLAY_ORIGIN,
    allowedDisplayPathPrefix: DISPLAY_PATH_PREFIX,
    ...overrides,
  });
}

describe("remote Moments provider", () => {
  test("fails closed when the remote admin page is embedded", () => {
    const topLevelWindow = {};
    assert.equal(
      isAdminPageEmbedded({ self: topLevelWindow, top: topLevelWindow }),
      false,
    );
    assert.equal(isAdminPageEmbedded({ self: {}, top: {} }), true);

    const inaccessibleFrame = Object.create(null) as {
      readonly self: unknown;
      readonly top: unknown;
    };
    Object.defineProperty(inaccessibleFrame, "top", {
      get: () => {
        throw new DOMException("Blocked frame access", "SecurityError");
      },
    });
    assert.equal(isAdminPageEmbedded(inaccessibleFrame), true);
  });

  test("keeps account-specific magic-link errors neutral but surfaces generic temporary failures", () => {
    const unknownAccount = new AuthApiError(
      "User not found",
      404,
      "user_not_found",
    );
    const signupDisabled = new AuthApiError(
      "Signups disabled",
      422,
      "signup_disabled",
    );
    assert.equal(
      isAccountNeutralMagicLinkError(unknownAccount),
      true,
    );
    assert.equal(
      isAccountNeutralMagicLinkError(signupDisabled),
      true,
    );
    assert.equal(normaliseAdminMagicLinkFailure(unknownAccount), null);
    assert.equal(normaliseAdminMagicLinkFailure(signupDisabled), null);
    assert.equal(
      normaliseAdminMagicLinkFailure(
        new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
      ) instanceof AdminMagicLinkUnavailableError,
      true,
    );

    const retryableFailure = normaliseAdminMagicLinkFailure(
      new AuthRetryableFetchError("Upstream detail", 503),
    );
    assert.equal(retryableFailure instanceof AdminMagicLinkUnavailableError, true);
    assert.equal(
      retryableFailure?.message,
      "The sign-in service is temporarily unavailable. Please try again later.",
    );

    const networkFailure = normaliseAdminMagicLinkFailure(
      new TypeError("Private network detail"),
    );
    assert.equal(networkFailure instanceof AdminMagicLinkUnavailableError, true);
    assert.doesNotMatch(networkFailure?.message ?? "", /private|network|rate/i);
  });

  test("shares only short-lived PKCE verifiers across tabs", async () => {
    const persistentVerifierStorage = new MemoryStorage();
    const firstTabSessions = new MemoryStorage();
    const secondTabSessions = new MemoryStorage();
    let now = 1_786_672_800_000;
    const authKey = "our-journey:moments:admin-auth:v1";
    const sessionKey = authKey;
    const legacyVerifierKey = `${authKey}-code-verifier`;
    const flowVerifierKey = `${authKey}-flow-0123456789abcdef0123456789abcdef-code-verifier`;
    const flowIndexKey = `${authKey}-flows-code-verifier`;
    const firstTab = createAdminAuthStorage(
      firstTabSessions,
      persistentVerifierStorage,
      () => now,
    );

    await firstTab.setItem(
      sessionKey,
      JSON.stringify({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
      }),
    );
    await firstTab.setItem(legacyVerifierKey, "legacy-verifier");
    await firstTab.setItem(flowVerifierKey, "flow-verifier");
    await firstTab.setItem(flowIndexKey, JSON.stringify(["flow-id"]));

    assert.ok(firstTabSessions.getItem(sessionKey)?.includes("access_token"));
    assert.equal(persistentVerifierStorage.getItem(sessionKey), null);
    assert.equal(
      [...persistentVerifierStorage.values.values()].some(
        (value) =>
          value.includes("private-access-token") ||
          value.includes("private-refresh-token"),
      ),
      false,
    );

    const secondTab = createAdminAuthStorage(
      secondTabSessions,
      persistentVerifierStorage,
      () => now,
    );
    assert.equal(await secondTab.getItem(sessionKey), null);
    assert.equal(
      await secondTab.getItem(legacyVerifierKey),
      "legacy-verifier",
    );
    assert.equal(await secondTab.getItem(flowVerifierKey), "flow-verifier");
    assert.equal(await secondTab.getItem(flowIndexKey), '["flow-id"]');

    await secondTab.removeItem(flowVerifierKey);
    assert.equal(persistentVerifierStorage.getItem(flowVerifierKey), null);
    now += 60 * 60 * 1000 + 1;
    assert.equal(await secondTab.getItem(legacyVerifierKey), null);
    assert.equal(persistentVerifierStorage.getItem(legacyVerifierKey), null);
  });

  test("allows approval only after a canonical preview is ready", () => {
    const readyMoment: Moment = {
      id: "ready-for-review",
      guestName: "Review Guest",
      caption: "Ready",
      createdAt: "2026-08-14T08:00:00.000Z",
      mediaType: "photo",
      previewUrl: signedUrl("ready.webp"),
      thumbnailUrl: signedUrl("ready.webp"),
      status: "pending",
      processingStatus: "ready",
    };

    assert.equal(isMomentReadyForApproval(readyMoment), true);
    assert.equal(
      isMomentReadyForApproval({
        ...readyMoment,
        processingStatus: "pending",
      }),
      false,
    );
    assert.equal(
      isMomentReadyForApproval({
        ...readyMoment,
        processingStatus: "failed",
      }),
      false,
    );
    assert.equal(
      isMomentReadyForApproval({ ...readyMoment, thumbnailUrl: undefined }),
      false,
    );
  });

  test("uploads chunks, retries a lost derivative response, and completes with the replacement token", async () => {
    const file = makeFile(CHUNK_SIZE + 517);
    const progress: MomentUploadProgress[] = [];
    const calls: Array<{ path: string; method: string }> = [];
    const storage = new MemoryStorage();
    let clientFileId = "";
    let chunkCalls = 0;
    let derivativeCalls = 0;

    const gallery = new Blob(["gallery-webp"], { type: "image/webp" });

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      const method = init?.method ?? "GET";
      const headers = requestHeaders(init);
      calls.push({ path, method });

      if (path === "/api/v1/sessions/anonymous" && method === "POST") {
        return jsonResponse({
          sessionToken: "guest-session-token",
          expiresAt: FUTURE_EXPIRY,
        });
      }

      if (path === "/api/v1/uploads/init" && method === "POST") {
        assert.equal(headers.get("X-Guest-Session"), "guest-session-token");
        assert.equal(headers.get("Content-Type"), "application/json");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.guestName, "Aleem & Ain Guest");
        assert.equal(body.caption, "A lovely evening");
        assert.equal(body.files.length, 1);
        assert.deepEqual(
          {
            fileName: body.files[0].fileName,
            fileSize: body.files[0].fileSize,
            mimeType: body.files[0].mimeType,
            mediaType: body.files[0].mediaType,
          },
          {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            mediaType: "photo",
          },
        );
        clientFileId = body.files[0].clientFileId;
        assert.match(clientFileId, /^file-/);
        return jsonResponse({
          uploadId: "upload-1",
          files: [
            {
              clientFileId,
              sessionId: "session-1",
              uploadToken: "sealed-original-token",
              chunkSize: CHUNK_SIZE,
              nextOffset: 0,
              expiresAt: FUTURE_EXPIRY,
            },
          ],
        });
      }

      if (
        path.startsWith("/api/v1/uploads/session-1/chunks/") &&
        method === "PUT"
      ) {
        assert.equal(headers.get("X-Guest-Session"), "guest-session-token");
        assert.equal(
          headers.get("X-Moments-Upload-Token"),
          "sealed-original-token",
        );
        assert.equal(headers.get("Content-Type"), file.type);
        const range = headers.get("Content-Range")?.match(
          /^bytes (\d+)-(\d+)\/(\d+)$/,
        );
        assert.ok(range);
        const start = Number(range[1]);
        const inclusiveEnd = Number(range[2]);
        const totalBytes = Number(range[3]);
        assert.equal(totalBytes, file.size);
        assert.equal(path, `/api/v1/uploads/session-1/chunks/${chunkCalls}`);
        assert.equal((init?.body as Blob).size, inclusiveEnd - start + 1);
        chunkCalls += 1;
        const nextOffset = inclusiveEnd + 1;
        return jsonResponse({
          sessionId: "session-1",
          nextOffset,
          uploadedBytes: nextOffset,
          totalBytes,
          complete: nextOffset === totalBytes,
        });
      }

      if (
        path === "/api/v1/uploads/session-1/derivatives" &&
        method === "POST"
      ) {
        derivativeCalls += 1;
        assert.equal(headers.get("X-Guest-Session"), "guest-session-token");
        assert.equal(
          headers.get("X-Moments-Upload-Token"),
          "sealed-original-token",
        );
        assert.equal(headers.has("Content-Type"), false);
        assert.ok(init?.body instanceof FormData);
        const sentGallery = init.body.get("gallery");
        assert.ok(sentGallery instanceof File);
        assert.equal(sentGallery.name, "gallery.webp");
        assert.equal(sentGallery.type, "image/webp");
        assert.equal(sentGallery.size, gallery.size);
        assert.equal(init.body.get("thumbnail"), null);
        if (derivativeCalls === 1) {
          throw new TypeError("The derivative response was lost after upload");
        }
        return jsonResponse({
          uploadToken: "sealed-derivatives-token",
          gallery: { uploaded: true, width: 1600, height: 1067 },
          thumbnail: { uploaded: true, width: 1600, height: 1067 },
        });
      }

      if (
        path === "/api/v1/uploads/session-1/complete" &&
        method === "POST"
      ) {
        assert.equal(headers.get("X-Guest-Session"), "guest-session-token");
        assert.equal(
          headers.get("X-Moments-Upload-Token"),
          "sealed-derivatives-token",
        );
        assert.equal(init?.body, "{}");
        return jsonResponse({
          moment: {
            id: "moment-1",
            status: "pending",
            createdAt: "2026-08-14T10:00:00.000Z",
            mediaType: "photo",
          },
        });
      }

      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected ${method} ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    const provider = makeProvider(fetchImpl, {
      storage,
      prepareMedia: async (preparedFile, mediaType) => {
        assert.equal(preparedFile, file);
        assert.equal(mediaType, "photo");
        return {
          mediaType,
          width: 2400,
          height: 1600,
          gallery: {
            blob: gallery,
            width: 1600,
            height: 1067,
            mimeType: "image/webp",
          },
        };
      },
    });

    const result = await provider.uploadMoment(
      {
        files: [file],
        guestName: "  Aleem & Ain Guest  ",
        caption: "  A lovely evening  ",
      },
      { onProgress: (nextProgress) => progress.push(nextProgress) },
    );

    assert.deepEqual(result, {
      submissions: [
        {
          id: "moment-1",
          status: "pending",
          createdAt: "2026-08-14T10:00:00.000Z",
          mediaType: "photo",
        },
      ],
    });
    assert.equal(chunkCalls, 2);
    assert.equal(derivativeCalls, 2);
    assert.deepEqual(
      JSON.parse(
        storage.values.get("our-journey:moments:guest-session:v1") ?? "null",
      ),
      {
        sessionToken: "guest-session-token",
        expiresAt: FUTURE_EXPIRY,
      },
    );
    assert.deepEqual(
      calls.map(({ path, method }) => `${method} ${path}`),
      [
        "POST /api/v1/sessions/anonymous",
        "POST /api/v1/uploads/init",
        "PUT /api/v1/uploads/session-1/chunks/0",
        "PUT /api/v1/uploads/session-1/chunks/1",
        "POST /api/v1/uploads/session-1/derivatives",
        "POST /api/v1/uploads/session-1/derivatives",
        "POST /api/v1/uploads/session-1/complete",
      ],
    );
    assert.deepEqual(
      progress.map(({ phase }) => phase),
      ["preparing", "uploading", "uploading", "finalizing", "complete"],
    );
    assert.equal(progress[1]?.uploadedBytes, CHUNK_SIZE);
    assert.equal(progress[1]?.currentFileName, file.name);
    assert.deepEqual(progress.at(-1), {
      phase: "complete",
      completedFiles: 1,
      totalFiles: 1,
      uploadedBytes: file.size,
      totalBytes: file.size,
      percentage: 100,
    });
  });

  test("reconciles a lost chunk response through upload status without resending accepted bytes", async () => {
    const file = makeFile(CHUNK_SIZE + 41, "original-name.jpeg", "image/jpeg");
    let clientFileId = "";
    let firstChunkAttempts = 0;
    let statusCalls = 0;
    let waitCalls = 0;
    const ranges: string[] = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      const method = init?.method ?? "GET";
      const headers = requestHeaders(init);

      if (path === "/api/v1/sessions/anonymous") {
        return jsonResponse({
          sessionToken: "guest-reconcile",
          expiresAt: FUTURE_EXPIRY,
        });
      }

      if (path === "/api/v1/uploads/init") {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(
          {
            guestName: body.guestName,
            caption: body.caption,
            fileName: body.files[0].fileName,
            fileSize: body.files[0].fileSize,
            mimeType: body.files[0].mimeType,
            mediaType: body.files[0].mediaType,
          },
          {
            guestName: "Metadata Guest",
            caption: "Metadata caption",
            fileName: "original-name.jpeg",
            fileSize: CHUNK_SIZE + 41,
            mimeType: "image/jpeg",
            mediaType: "photo",
          },
        );
        clientFileId = body.files[0].clientFileId;
        return jsonResponse({
          uploadId: "upload-reconcile",
          files: [
            {
              clientFileId,
              sessionId: "session-reconcile",
              uploadToken: "sealed-reconcile",
              chunkSize: CHUNK_SIZE,
              nextOffset: 0,
              expiresAt: FUTURE_EXPIRY,
            },
          ],
        });
      }

      if (
        path === "/api/v1/uploads/session-reconcile/chunks/0" &&
        method === "PUT"
      ) {
        firstChunkAttempts += 1;
        ranges.push(headers.get("Content-Range") ?? "");
        throw new TypeError("The mobile connection dropped the response");
      }

      if (
        path === "/api/v1/uploads/session-reconcile" &&
        method === "GET"
      ) {
        statusCalls += 1;
        assert.equal(headers.get("X-Guest-Session"), "guest-reconcile");
        assert.equal(headers.get("X-Moments-Upload-Token"), "sealed-reconcile");
        return jsonResponse({
          sessionId: "session-reconcile",
          nextOffset: CHUNK_SIZE,
          totalBytes: file.size,
          complete: false,
          expiresAt: FUTURE_EXPIRY,
        });
      }

      if (
        path === "/api/v1/uploads/session-reconcile/chunks/1" &&
        method === "PUT"
      ) {
        ranges.push(headers.get("Content-Range") ?? "");
        return jsonResponse({
          sessionId: "session-reconcile",
          nextOffset: file.size,
          uploadedBytes: file.size,
          totalBytes: file.size,
          complete: true,
        });
      }

      if (path === "/api/v1/uploads/session-reconcile/complete") {
        return jsonResponse({
          moment: {
            id: "moment-reconcile",
            status: "pending",
            createdAt: "2026-08-14T11:00:00.000Z",
            mediaType: "photo",
          },
        });
      }

      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected ${method} ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    const provider = makeProvider(fetchImpl, {
      prepareMedia: async () => ({ mediaType: "photo" }),
      wait: async () => {
        waitCalls += 1;
      },
    });

    const result = await provider.uploadMoment({
      files: [file],
      guestName: "Metadata Guest",
      caption: "Metadata caption",
    });

    assert.equal(result.submissions[0]?.id, "moment-reconcile");
    assert.equal(firstChunkAttempts, 1);
    assert.equal(statusCalls, 1);
    assert.equal(waitCalls, 0);
    assert.deepEqual(ranges, [
      `bytes 0-${CHUNK_SIZE - 1}/${file.size}`,
      `bytes ${CHUNK_SIZE}-${file.size - 1}/${file.size}`,
    ]);
  });

  test("retries the same chunk when status reconciliation confirms no bytes were accepted", async () => {
    const file = makeFile(1024, "retry-me.jpg");
    let chunkAttempts = 0;
    let statusCalls = 0;
    const waits: number[] = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      const method = init?.method ?? "GET";

      if (path === "/api/v1/sessions/anonymous") {
        return jsonResponse({
          sessionToken: "guest-retry",
          expiresAt: FUTURE_EXPIRY,
        });
      }
      if (path === "/api/v1/uploads/init") {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          uploadId: "upload-retry",
          files: [
            {
              clientFileId: body.files[0].clientFileId,
              sessionId: "session-retry",
              uploadToken: "sealed-retry",
              chunkSize: 256 * 1024,
              nextOffset: 0,
              expiresAt: FUTURE_EXPIRY,
            },
          ],
        });
      }
      if (path.endsWith("/session-retry/chunks/0") && method === "PUT") {
        chunkAttempts += 1;
        assert.equal(
          requestHeaders(init).get("Content-Range"),
          `bytes 0-${file.size - 1}/${file.size}`,
        );
        if (chunkAttempts === 1) {
          throw new TypeError("response lost before the chunk reached Drive");
        }
        return jsonResponse({
          sessionId: "session-retry",
          nextOffset: file.size,
          uploadedBytes: file.size,
          totalBytes: file.size,
          complete: true,
        });
      }
      if (path === "/api/v1/uploads/session-retry" && method === "GET") {
        statusCalls += 1;
        return jsonResponse({
          sessionId: "session-retry",
          nextOffset: 0,
          totalBytes: file.size,
          complete: false,
          expiresAt: FUTURE_EXPIRY,
        });
      }
      if (path.endsWith("/session-retry/complete") && method === "POST") {
        return jsonResponse({
          moment: {
            id: "moment-retry",
            status: "pending",
            createdAt: "2026-08-14T11:30:00.000Z",
            mediaType: "photo",
          },
        });
      }

      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected ${method} ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    const provider = makeProvider(fetchImpl, {
      prepareMedia: async () => ({ mediaType: "photo" }),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    const result = await provider.uploadMoment({
      files: [file],
      guestName: "Retry Guest",
    });

    assert.equal(result.submissions[0]?.id, "moment-retry");
    assert.equal(chunkAttempts, 2);
    assert.equal(statusCalls, 1);
    assert.deepEqual(waits, [450]);
  });

  test("an abort after initialization abandons the sealed upload session with DELETE", async () => {
    const file = makeFile(1024, "cancel-me.jpg");
    const controller = new AbortController();
    let deleteCalls = 0;
    let rejectPreparation: ((reason: unknown) => void) | undefined;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      const method = init?.method ?? "GET";
      const headers = requestHeaders(init);

      if (path === "/api/v1/sessions/anonymous") {
        return jsonResponse({
          sessionToken: "guest-cancel",
          expiresAt: FUTURE_EXPIRY,
        });
      }
      if (path === "/api/v1/uploads/init") {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          uploadId: "upload-cancel",
          files: [
            {
              clientFileId: body.files[0].clientFileId,
              sessionId: "session-cancel",
              uploadToken: "sealed-cancel",
              chunkSize: 256 * 1024,
              nextOffset: 0,
              expiresAt: FUTURE_EXPIRY,
            },
          ],
        });
      }
      if (path.endsWith("/chunks/0") && method === "PUT") {
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
      }
      if (path === "/api/v1/uploads/session-cancel" && method === "DELETE") {
        deleteCalls += 1;
        assert.equal(headers.get("X-Guest-Session"), "guest-cancel");
        assert.equal(headers.get("X-Moments-Upload-Token"), "sealed-cancel");
        return new Response(null, { status: 204 });
      }

      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected ${method} ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    const provider = makeProvider(fetchImpl, {
      prepareMedia: () =>
        new Promise((_, reject) => {
          rejectPreparation = reject;
        }),
    });

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await assert.rejects(
        provider.uploadMoment(
          { files: [file], guestName: "Cancel Guest", caption: "" },
          { signal: controller.signal },
        ),
        (error: unknown) =>
          error instanceof DOMException && error.name === "AbortError",
      );
      assert.equal(deleteCalls, 1);

      rejectPreparation?.(new DOMException("preparation cancelled", "AbortError"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(unhandledRejections, []);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  test("maps only explicitly approved public DTO fields and sorts newest first", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(pathFor(input), "/api/v1/moments?limit=20&offset=0");
      assert.equal(init?.method, undefined);
      assert.equal(requestHeaders(init).get("Accept"), "application/json");
      assert.equal(requestHeaders(init).has("Authorization"), false);
      return jsonResponse({
        moments: [
          {
            id: "older",
            guestName: "Older Guest",
            caption: "Older caption",
            createdAt: "2026-08-13T10:00:00.000Z",
            mediaType: "photo",
            galleryUrl: signedUrl("older.webp"),
            thumbnailUrl: signedUrl("older.webp"),
            width: 1200,
            height: 800,
            status: "approved",
            originalFileId: "drive-secret-older",
            originalUrl: "https://drive.google.test/secret",
          },
          {
            id: "newer",
            guestName: "Newer Guest",
            caption: "Newer caption",
            createdAt: "2026-08-14T10:00:00.000Z",
            mediaType: "photo",
            galleryUrl: signedUrl("newer.webp"),
            width: 1600,
            height: 1067,
            status: "approved",
            originalFileId: "drive-secret-newer",
          },
        ],
        nextOffset: null,
      });
    }) as typeof fetch;

    const page = await makeProvider(fetchImpl).getMoments();
    const moments = page.moments;

    assert.equal(page.nextOffset, null);
    assert.deepEqual(moments, [
      {
        id: "newer",
        guestName: "Newer Guest",
        caption: "Newer caption",
        createdAt: "2026-08-14T10:00:00.000Z",
        mediaType: "photo",
        previewUrl: signedUrl("newer.webp"),
        thumbnailUrl: signedUrl("newer.webp"),
        status: "approved",
        width: 1600,
        height: 1067,
      },
      {
        id: "older",
        guestName: "Older Guest",
        caption: "Older caption",
        createdAt: "2026-08-13T10:00:00.000Z",
        mediaType: "photo",
        previewUrl: signedUrl("older.webp"),
        thumbnailUrl: signedUrl("older.webp"),
        status: "approved",
        width: 1200,
        height: 800,
      },
    ]);
    assert.equal("originalFileId" in moments[0]!, false);
    assert.equal("originalUrl" in moments[0]!, false);
  });

  test("exposes public gallery pages that append beyond 20 without duplicate IDs", async () => {
    const publicDtos = Array.from({ length: 21 }, (_, index) => ({
      id: `public-${index}`,
      guestName: `Guest ${index}`,
      caption: `Caption ${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 14, 8, 0, index)).toISOString(),
      mediaType: "photo",
      galleryUrl: signedUrl(`public-${index}.webp`),
      status: "approved",
    }));
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const path = pathFor(input);
      calls.push(path);
      if (path === "/api/v1/moments?limit=20&offset=0") {
        return jsonResponse({
          moments: publicDtos.slice(0, 20),
          nextOffset: 20,
        });
      }
      if (path === "/api/v1/moments?limit=20&offset=20") {
        return jsonResponse({
          moments: [publicDtos[19], publicDtos[20]],
          nextOffset: null,
        });
      }
      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected GET ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;
    const provider = makeProvider(fetchImpl);

    const firstPage = await provider.getMoments({ limit: 20, offset: 0 });
    assert.equal(firstPage.nextOffset, 20);
    const secondPage = await provider.getMoments({
      limit: 20,
      offset: firstPage.nextOffset ?? 0,
    });
    assert.equal(secondPage.nextOffset, null);
    const moments = mergeMomentsById(firstPage.moments, secondPage.moments);

    assert.equal(moments.length, 21);
    assert.deepEqual(
      moments.map((moment) => moment.id),
      publicDtos.map((moment) => moment.id).reverse(),
    );
    assert.deepEqual(calls, [
      "/api/v1/moments?limit=20&offset=0",
      "/api/v1/moments?limit=20&offset=20",
    ]);
  });

  test("rejects a public gallery response that is not explicitly approved", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        moments: [
          {
            id: "hostile-hidden",
            guestName: "Hidden Guest",
            caption: "Must stay private",
            createdAt: "2026-08-14T08:00:00.000Z",
            mediaType: "photo",
            galleryUrl: signedUrl("hidden.webp"),
            status: "hidden",
          },
        ],
        nextOffset: null,
      })) as typeof fetch;

    await assert.rejects(
      makeProvider(fetchImpl).getMoments(),
      (error: unknown) =>
        error instanceof MomentsApiError && error.code === "NETWORK_ERROR",
    );
  });

  test("rejects remote media outside the configured signed Supabase path", async () => {
    const untrustedUrls = [
      "https://drive.google.com/file/d/private-original/view",
      `${DISPLAY_ORIGIN}/storage/v1/object/public/moments/not-signed.webp`,
      "https://cdn.example.test/storage/v1/object/sign/moments/wrong-origin.webp",
    ];

    for (const galleryUrl of untrustedUrls) {
      const fetchImpl = (async () =>
        jsonResponse({
          moments: [
            {
              id: "untrusted-media",
              guestName: "Private Guest",
              caption: "Must not render",
              createdAt: "2026-08-14T08:00:00.000Z",
              mediaType: "photo",
              galleryUrl,
              status: "approved",
            },
          ],
          nextOffset: null,
        })) as typeof fetch;

      await assert.rejects(
        makeProvider(fetchImpl).getMoments(),
        (error: unknown) =>
          error instanceof MomentsApiError && error.code === "LOAD_FAILED",
      );
    }

    const mismatchedMedia = (async () =>
      jsonResponse({
        moments: [
          {
            id: "mismatched-media",
            guestName: "Private Guest",
            caption: "Two different images",
            createdAt: "2026-08-14T08:00:00.000Z",
            mediaType: "photo",
            galleryUrl: signedUrl("canonical.webp"),
            thumbnailUrl: signedUrl("different-content.webp"),
            status: "approved",
          },
        ],
        nextOffset: null,
      })) as typeof fetch;
    await assert.rejects(
      makeProvider(mismatchedMedia).getMoments(),
      (error: unknown) =>
        error instanceof MomentsApiError && error.code === "LOAD_FAILED",
    );
  });

  test("uses the Supabase admin bearer token for filtered list and moderation PATCH", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    const adminDto = {
      id: "moment/admin id",
      guestName: "Admin Review Guest",
      caption: "Awaiting moderation",
      createdAt: "2026-08-14T09:00:00.000Z",
      mediaType: "photo",
      galleryUrl: signedUrl("admin.webp"),
      thumbnailUrl: signedUrl("admin.webp"),
      width: 1440,
      height: 960,
      status: "pending",
      mimeType: "image/jpeg",
      fileName: "private-name.jpg",
      fileSize: 2048,
      processingStatus: "ready",
      originalFileId: "never-map-this-drive-id",
    };

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      const method = init?.method ?? "GET";
      const headers = requestHeaders(init);
      calls.push({ path, method });
      assert.equal(headers.get("Authorization"), "Bearer supabase-admin-jwt");
      assert.equal(headers.get("Accept"), "application/json");

      if (
        path ===
        "/api/v1/admin/moments?status=pending&limit=20&offset=0"
      ) {
        assert.equal(method, "GET");
        return jsonResponse({ moments: [adminDto], nextOffset: null });
      }

      if (
        path === "/api/v1/admin/moments/moment%2Fadmin%20id/status" &&
        method === "PATCH"
      ) {
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          status: "approved",
        });
        return jsonResponse({
          moment: { ...adminDto, status: "approved" },
        });
      }

      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected ${method} ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    let tokenCalls = 0;
    const provider = makeProvider(fetchImpl, {
      getAdminAccessToken: async () => {
        tokenCalls += 1;
        return "supabase-admin-jwt";
      },
    });

    const pendingPage = await provider.getAdminMoments({ status: "pending" });
    const pending = pendingPage.moments;
    assert.equal(pendingPage.nextOffset, null);
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0], {
      id: "moment/admin id",
      guestName: "Admin Review Guest",
      caption: "Awaiting moderation",
      createdAt: "2026-08-14T09:00:00.000Z",
      mediaType: "photo",
      previewUrl: signedUrl("admin.webp"),
      thumbnailUrl: signedUrl("admin.webp"),
      status: "pending",
      width: 1440,
      height: 960,
      mimeType: "image/jpeg",
      fileName: "private-name.jpg",
      size: 2048,
      processingStatus: "ready",
    });
    assert.equal("originalFileId" in pending[0]!, false);

    const approved = await provider.updateMomentStatus(
      "moment/admin id",
      "approved",
    );
    assert.equal(approved.status, "approved");
    assert.equal(tokenCalls, 2);
    assert.deepEqual(calls, [
      {
        path: "/api/v1/admin/moments?status=pending&limit=20&offset=0",
        method: "GET",
      },
      {
        path: "/api/v1/admin/moments/moment%2Fadmin%20id/status",
        method: "PATCH",
      },
    ]);
  });

  test("exposes 20-record admin pages that the UI can append without duplicate IDs", async () => {
    const adminDtos = Array.from({ length: 21 }, (_, index) => ({
      id: `admin-${index}`,
      guestName: `Guest ${index}`,
      caption: `Caption ${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 14, 9, 0, index)).toISOString(),
      mediaType: "photo",
      galleryUrl: signedUrl(`admin-${index}.webp`),
      status: "pending",
      mimeType: "image/jpeg",
      fileName: `photo-${index}.jpg`,
      fileSize: 2048 + index,
      processingStatus: "ready",
    }));
    const calls: string[] = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input);
      calls.push(path);
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(
        requestHeaders(init).get("Authorization"),
        "Bearer supabase-admin-jwt",
      );

      if (path === "/api/v1/admin/moments?status=all&limit=20&offset=0") {
        return jsonResponse({
          moments: adminDtos.slice(0, 20),
          nextOffset: 20,
        });
      }
      if (path === "/api/v1/admin/moments?status=all&limit=20&offset=20") {
        // An overlapping row must not produce a duplicate card or stall paging.
        return jsonResponse({
          moments: [adminDtos[19], adminDtos[20]],
          nextOffset: null,
        });
      }
      return errorResponse(
        { code: "NOT_FOUND", message: `Unexpected GET ${path}` },
        { status: 404 },
      );
    }) as typeof fetch;

    const provider = makeProvider(fetchImpl, {
      getAdminAccessToken: async () => "supabase-admin-jwt",
    });
    const firstPage = await provider.getAdminMoments({
      status: "all",
      limit: 20,
      offset: 0,
    });
    assert.equal(firstPage.moments.length, 20);
    assert.equal(firstPage.nextOffset, 20);
    const secondPage = await provider.getAdminMoments({
      status: "all",
      limit: 20,
      offset: firstPage.nextOffset,
    });
    assert.equal(secondPage.nextOffset, null);
    const moments = mergeMomentsById(firstPage.moments, secondPage.moments);

    assert.equal(moments.length, 21);
    assert.deepEqual(
      moments.map((moment) => moment.id),
      adminDtos.map((moment) => moment.id).reverse(),
    );
    assert.equal(
      moments.filter((moment) => moment.id === "admin-19").length,
      1,
    );
    assert.deepEqual(calls, [
      "/api/v1/admin/moments?status=all&limit=20&offset=0",
      "/api/v1/admin/moments?status=all&limit=20&offset=20",
    ]);
  });

  test("rejects unknown admin processing states", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        moments: [
          {
            id: "admin-invalid-processing",
            guestName: "Review Guest",
            caption: "Unexpected processing state",
            createdAt: "2026-08-14T09:00:00.000Z",
            mediaType: "photo",
            status: "pending",
            processingStatus: "queued",
          },
        ],
        nextOffset: null,
      })) as typeof fetch;

    await assert.rejects(
      makeProvider(fetchImpl, {
        getAdminAccessToken: async () => "supabase-admin-jwt",
      }).getAdminMoments(),
      (error: unknown) =>
        error instanceof MomentsApiError && error.code === "NETWORK_ERROR",
    );
  });

  test("normalizes structured API errors with status, retry, and request context", async () => {
    const fetchImpl = (async () =>
      errorResponse(
        {
          code: "RATE_LIMITED",
          message: "Please wait before trying again.",
          requestId: "request-429",
          retryAfterSeconds: 17,
        },
        { status: 429, headers: { "Retry-After": "19" } },
      )) as typeof fetch;

    await assert.rejects(
      makeProvider(fetchImpl).getMoments(),
      (error: unknown) => {
        assert.ok(error instanceof MomentsApiError);
        assert.equal(error.code, "RATE_LIMITED");
        assert.equal(error.message, "Please wait before trying again.");
        assert.equal(error.status, 429);
        assert.equal(error.retryable, true);
        assert.equal(error.requestId, "request-429");
        assert.equal(error.retryAfterSeconds, 17);
        return true;
      },
    );
  });
});
