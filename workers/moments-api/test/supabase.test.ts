import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeMoment,
  listAdminMoments,
  listApprovedMoments,
  requireAdmin,
  updateAdminMomentStatus,
  uploadDerivative,
} from "../src/supabase.ts";
import type { UploadTicketPayload } from "../src/types.ts";
import type { Fetcher } from "../src/types.ts";
import { jsonResponse, testEnv } from "./helpers.ts";

test("guest gallery queries through anon RLS for approved ready rows and maps explicit DTOs", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    if (url.includes("/rest/v1/moments")) {
      return jsonResponse(
        Array.from({ length: 21 }, (_, index) => ({
          id: `moment-${index}`,
          guest_name: "Nadia",
          caption: "A memory",
          created_at: "2026-08-14T00:00:00.000Z",
          media_type: "photo",
          mime_type: "image/jpeg",
          file_name: "private.jpg",
          file_size: 10,
          width: 1200,
          height: 800,
          drive_file_id: "must-not-leak",
          gallery_path: `moment-${index}/gallery.webp`,
          thumbnail_path: `moment-${index}/gallery.webp`,
          status: "approved",
          processing_status: "ready",
        })),
      );
    }
    if (url.includes("/storage/v1/object/sign/")) {
      const requestBody = JSON.parse(String(init?.body));
      assert.equal(requestBody.expiresIn, 900);
      return jsonResponse({ signedURL: `/object/sign/moments-gallery/file?token=signed` });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const page = await listApprovedMoments(20, 0, testEnv(), fakeFetch);
  assert.equal(page.moments.length, 20);
  assert.equal(page.hasMore, true);
  assert.equal(page.moments[0]?.guestName, "Nadia");
  assert.equal(page.moments[0]?.status, "approved");
  assert.match(page.moments[0]?.galleryUrl ?? "", /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\//);
  assert.equal(page.moments[0]?.galleryUrl, page.moments[0]?.thumbnailUrl);
  assert.equal("driveFileId" in (page.moments[0] ?? {}), false);
  const query = requests[0]!;
  assert.match(query.url, /status=eq\.approved/);
  assert.match(query.url, /processing_status=eq\.ready/);
  assert.match(query.url, /limit=21/);
  assert.match(query.url, /offset=0/);
  assert.equal(query.headers.get("apikey"), "anon-test-key");
  assert.equal(query.headers.has("authorization"), false);
  assert.equal(requests.filter((request) => request.url.includes("/storage/v1/object/sign/")).length, 20);
});

test("public mapping fails closed if an upstream row is not approved", async () => {
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/moments")) {
      return jsonResponse([
        {
          id: "hostile-row",
          guest_name: "Guest",
          caption: "",
          created_at: "2026-08-14T00:00:00.000Z",
          media_type: "photo",
          width: 800,
          height: 600,
          gallery_path: "hostile/gallery.webp",
          thumbnail_path: "hostile/gallery.webp",
          status: "rejected",
          processing_status: "ready",
        },
      ]);
    }
    throw new Error(`A rejected row must never be signed: ${url}`);
  };

  await assert.rejects(
    () => listApprovedMoments(20, 0, testEnv(), fakeFetch),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "NOT_FOUND",
  );
});

test("authenticated but unauthorized admins are denied", async () => {
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-id", email: "owner@example.com" });
    if (url.includes("/rest/v1/moment_admins")) return jsonResponse([]);
    throw new Error(`Unexpected URL ${url}`);
  };
  await assert.rejects(
    () => requireAdmin("valid-jwt", testEnv(), fakeFetch),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ACCESS_DENIED",
  );
});

test("authorized admin list/PATCH uses anon apikey plus user JWT and status-only body", async () => {
  const observed: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
  const row = (status: "pending" | "rejected") => ({
    id: "moment-id",
    guest_name: "Nadia",
    caption: "A memory",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    media_type: "photo",
    mime_type: "image/jpeg",
    file_name: "photo.jpg",
    file_size: 10,
    width: null,
    height: null,
    gallery_path: null,
    thumbnail_path: null,
    status,
    processing_status: "pending",
    moderated_at: null,
  });
  let momentReads = 0;
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    observed.push({ url, method: init?.method ?? "GET", headers, ...(init?.body ? { body: String(init.body) } : {}) });
    if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-id", email: "owner@example.com" });
    if (url.includes("/rest/v1/moment_admins")) return jsonResponse([{ user_id: "admin-id" }]);
    if (url.includes("/rest/v1/moments") && init?.method === "PATCH") return jsonResponse([row("rejected")]);
    if (url.includes("/rest/v1/moments")) {
      momentReads += 1;
      return jsonResponse([row("pending")]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const env = testEnv();
  const admin = await requireAdmin("admin-jwt", env, fakeFetch);
  const page = await listAdminMoments(admin, "pending", 20, 0, env, fakeFetch);
  assert.equal(page.moments.length, 1);
  assert.equal(page.hasMore, false);
  const updated = await updateAdminMomentStatus(admin, "moment-id", "rejected", env, fakeFetch);
  assert.equal(updated.status, "rejected");
  assert.ok(momentReads >= 2);

  for (const request of observed) {
    assert.equal(request.headers.get("apikey"), "anon-test-key");
    assert.equal(request.headers.get("authorization"), "Bearer admin-jwt");
    assert.notEqual(request.headers.get("apikey"), "service-test-key");
  }
  const patch = observed.find((request) => request.method === "PATCH");
  assert.equal(patch?.body, JSON.stringify({ status: "rejected" }));
  assert.match(patch?.url ?? "", /select=/);
  const list = observed.find(
    (request) => request.method === "GET" && request.url.includes("/rest/v1/moments") && request.url.includes("offset=0"),
  );
  assert.match(list?.url ?? "", /limit=21/);
});

test("moderation refuses approval until canonical derivatives are ready", async () => {
  const baseRow = {
    id: "moment-id",
    guest_name: "Nadia",
    caption: "A memory",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    media_type: "photo" as const,
    mime_type: "image/jpeg",
    file_name: "photo.jpg",
    file_size: 10,
    width: 600,
    height: 400,
    status: "pending" as const,
    moderated_at: null,
  };
  const unsafeRows = [
    {
      ...baseRow,
      gallery_path: "moment-id/gallery.webp",
      thumbnail_path: "moment-id/gallery.webp",
      processing_status: "pending" as const,
    },
    {
      ...baseRow,
      gallery_path: null,
      thumbnail_path: null,
      processing_status: "ready" as const,
    },
    {
      ...baseRow,
      gallery_path: "moment-id/gallery.webp",
      thumbnail_path: "moment-id/other.webp",
      processing_status: "ready" as const,
    },
    {
      ...baseRow,
      width: null,
      height: null,
      gallery_path: "moment-id/gallery.webp",
      thumbnail_path: "moment-id/gallery.webp",
      processing_status: "ready" as const,
    },
  ];

  for (const current of unsafeRows) {
    let patchCalls = 0;
    const fakeFetch: Fetcher = async (_input, init) => {
      if (init?.method === "PATCH") patchCalls += 1;
      return jsonResponse([current]);
    };
    await assert.rejects(
      () =>
        updateAdminMomentStatus(
          { id: "admin-id", email: "owner@example.com", jwt: "admin-jwt" },
          current.id,
          "approved",
          testEnv(),
          fakeFetch,
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 409 &&
        "code" in error &&
        error.code === "INVALID_STATUS",
    );
    assert.equal(patchCalls, 0);
  }
});

test("lost completion responses remain valid after rejection or hiding", async () => {
  let posts = 0;
  let currentStatus: "rejected" | "hidden" = "rejected";
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") posts += 1;
    if (url.includes("/rest/v1/moments")) {
      return jsonResponse([
        {
          id: "moment-id",
          submission_id: "11111111-1111-4111-8111-111111111111",
          guest_session_id: "22222222-2222-4222-8222-222222222222",
          guest_name: "Guest",
          caption: "",
          created_at: "2026-08-14T00:00:00.000Z",
          media_type: "photo",
          mime_type: "image/jpeg",
          file_name: "x.jpg",
          file_size: 10,
          width: null,
          height: null,
          drive_file_id: "drive-id",
          gallery_path: null,
          thumbnail_path: null,
          status: currentStatus,
          processing_status: "pending",
        },
      ]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: "11111111-1111-4111-8111-111111111111",
    momentId: "moment-id",
    guestSessionId: "22222222-2222-4222-8222-222222222222",
    guestName: "Guest",
    caption: "",
    clientFileId: "client",
    fileName: "x.jpg",
    fileSize: 10,
    mimeType: "image/jpeg",
    mediaType: "photo",
    driveFileId: "drive-id",
    driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
    createdAt: "2026-08-14T00:00:00.000Z",
    chunkSize: 8 * 1024 * 1024,
    exp: 9_999_999_999,
  } satisfies UploadTicketPayload;
  assert.equal((await finalizeMoment(ticket, testEnv(), fakeFetch)).status, "pending");
  currentStatus = "hidden";
  assert.equal((await finalizeMoment(ticket, testEnv(), fakeFetch)).status, "pending");
  assert.equal(
    (await finalizeMoment(ticket, testEnv({ MOMENTS_REQUIRE_MODERATION: "false" }), fakeFetch)).status,
    "approved",
  );
  assert.equal(posts, 0);
});

test("finalization stores original dimensions separately from display dimensions", async () => {
  let insertedBody: Record<string, unknown> | undefined;
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (!url.includes("/rest/v1/moments")) throw new Error(`Unexpected URL ${url}`);
    if (init?.method !== "POST") return jsonResponse([]);
    insertedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return jsonResponse([insertedBody]);
  };
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: "11111111-1111-4111-8111-111111111111",
    momentId: "33333333-3333-4333-8333-333333333333",
    guestSessionId: "22222222-2222-4222-8222-222222222222",
    guestName: "Guest",
    caption: "",
    clientFileId: "client",
    fileName: "x.jpg",
    fileSize: 10,
    mimeType: "image/jpeg",
    mediaType: "photo",
    driveFileId: "drive-id",
    driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
    createdAt: "2026-08-14T00:00:00.000Z",
    chunkSize: 8 * 1024 * 1024,
    derivatives: {
      gallery: { path: "moment/gallery.webp", width: 1600, height: 1200, size: 100, mimeType: "image/webp" },
      thumbnail: { path: "moment/gallery.webp", width: 1600, height: 1200, size: 100, mimeType: "image/webp" },
    },
    exp: 9_999_999_999,
  } satisfies UploadTicketPayload;

  await finalizeMoment(ticket, testEnv(), fakeFetch, { width: 4032, height: 3024 });
  assert.equal(insertedBody?.width, 1600);
  assert.equal(insertedBody?.height, 1200);
  assert.equal(insertedBody?.original_width, 4032);
  assert.equal(insertedBody?.original_height, 3024);
});

test("derivative writes are first-write-only and reconcile only exact retry bytes", async () => {
  const stored = new Map<string, Uint8Array>();
  const observedHeaders: Headers[] = [];
  let posts = 0;
  let reads = 0;
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    observedHeaders.push(headers);
    if (init?.method === "POST") {
      posts += 1;
      if (stored.has(url)) return jsonResponse({ message: "duplicate" }, 400);
      stored.set(url, new Uint8Array(init?.body as ArrayBuffer).slice());
      return new Response(null, { status: 200 });
    }
    if (init?.method === "GET") {
      reads += 1;
      const bytes = stored.get(url);
      return bytes
        ? new Response(bytes.slice(), {
            status: 200,
            headers: { "content-length": String(bytes.byteLength) },
          })
        : new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const env = testEnv();
  const path = `${crypto.randomUUID()}/gallery.webp`;
  const original = new Uint8Array([1, 2, 3]).buffer;

  await uploadDerivative(path, original, env, fakeFetch);
  await uploadDerivative(path, original, env, fakeFetch);
  await assert.rejects(
    () => uploadDerivative(path, new Uint8Array([1, 2, 4]).buffer, env, fakeFetch),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "DERIVATIVE_INVALID",
  );

  assert.equal(stored.size, 1);
  assert.equal(posts, 3);
  assert.equal(reads, 2);
  assert.ok(observedHeaders.every((headers) => headers.get("apikey") === "service-test-key"));
  assert.equal(observedHeaders[0]?.get("x-upsert"), "false");
  assert.equal(observedHeaders[0]?.get("cache-control"), "900");
});
