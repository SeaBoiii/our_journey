import assert from "node:assert/strict";
import test from "node:test";

import {
  getGoogleAccessToken,
  getDriveFile,
  getDriveUploadStatus,
  initiateDriveUpload,
  resetGoogleTokenCacheForTests,
  uploadDriveChunk,
  verifyCompletedDriveFile,
} from "../src/google.ts";
import type { UploadTicketPayload } from "../src/types.ts";
import type { Fetcher } from "../src/types.ts";
import { jsonResponse, testEnv } from "./helpers.ts";

test("OAuth refresh uses owner refresh credentials and caches short-lived access tokens", async () => {
  resetGoogleTokenCacheForTests();
  let calls = 0;
  const fakeFetch: Fetcher = async (_input, init) => {
    calls += 1;
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "google-refresh-token");
    return jsonResponse({ access_token: "access-token", expires_in: 3600 });
  };
  assert.equal(await getGoogleAccessToken(testEnv(), fakeFetch, false, 1_000), "access-token");
  assert.equal(await getGoogleAccessToken(testEnv(), fakeFetch, false, 2_000), "access-token");
  assert.equal(calls, 1);
});

test("Drive resumable initialization pins server folder/id and never searches by name", async () => {
  resetGoogleTokenCacheForTests();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    return new Response(null, {
      status: 200,
      headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque" },
    });
  };
  const location = await initiateDriveUpload(
    {
      file: {
        clientFileId: "one",
        fileName: "unsafe name.jpg",
        fileSize: 123,
        mimeType: "image/jpeg",
        mediaType: "photo",
        extension: "jpg",
      },
      momentId: "moment-id",
      submissionId: "submission-id",
      driveFileId: "generated-drive-id",
    },
    testEnv(),
    fakeFetch,
  );
  assert.match(location, /upload_id=opaque/);
  const upload = requests.find((request) => request.url.includes("uploadType=resumable"));
  const body = JSON.parse(String(upload?.init?.body));
  assert.equal(body.id, "generated-drive-id");
  assert.equal(body.name, "moment-id.jpg");
  assert.deepEqual(body.parents, ["originals-folder"]);
  assert.doesNotMatch(JSON.stringify(body), /unsafe name/);
});

test("resumable status Range is authoritative before a bounded chunk completes", async () => {
  resetGoogleTokenCacheForTests();
  const ranges: string[] = [];
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    const range = new Headers(init?.headers).get("content-range") ?? "";
    ranges.push(range);
    if (range === "bytes */10") {
      return new Response(null, { status: 308, headers: { range: "bytes=0-4" } });
    }
    if (range === "bytes 5-9/10") return jsonResponse({ id: "drive-id" });
    throw new Error(`Unexpected request ${url} ${range}`);
  };
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: crypto.randomUUID(),
    momentId: crypto.randomUUID(),
    guestSessionId: crypto.randomUUID(),
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
  assert.deepEqual(await getDriveUploadStatus(ticket, testEnv(), fakeFetch), {
    complete: false,
    nextOffset: 5,
  });
  assert.deepEqual(
    await uploadDriveChunk(ticket, new Uint8Array(5), 5, 5, 9, testEnv(), fakeFetch),
    { complete: true, nextOffset: 10 },
  );
  assert.deepEqual(ranges, ["bytes */10", "bytes 5-9/10"]);
});

test("a streamed chunk 401 refreshes OAuth and remains safely retryable", async () => {
  resetGoogleTokenCacheForTests();
  let refreshes = 0;
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      refreshes += 1;
      return jsonResponse({ access_token: `access-token-${refreshes}`, expires_in: 3600 });
    }
    return new Response(null, { status: 401 });
  };
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: crypto.randomUUID(),
    momentId: crypto.randomUUID(),
    guestSessionId: crypto.randomUUID(),
    guestName: "Guest",
    caption: "",
    clientFileId: "client",
    fileName: "x.jpg",
    fileSize: 1,
    mimeType: "image/jpeg",
    mediaType: "photo",
    driveFileId: "drive-id",
    driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
    createdAt: "2026-08-14T00:00:00.000Z",
    chunkSize: 8 * 1024 * 1024,
    exp: 9_999_999_999,
  } satisfies UploadTicketPayload;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff]));
      controller.close();
    },
  });

  await assert.rejects(
    () => uploadDriveChunk(ticket, stream, 1, 0, 0, testEnv(), fakeFetch),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "options" in error &&
      (error.options as { retryable?: boolean }).retryable === true,
  );
  assert.equal(refreshes, 2);
});

test("a resumable session that expires between status and chunk requests requires restart", async () => {
  resetGoogleTokenCacheForTests();
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    return new Response(null, { status: 404 });
  };
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: crypto.randomUUID(),
    momentId: crypto.randomUUID(),
    guestSessionId: crypto.randomUUID(),
    guestName: "Guest",
    caption: "",
    clientFileId: "client",
    fileName: "x.jpg",
    fileSize: 10,
    mimeType: "image/jpeg",
    mediaType: "photo",
    driveFileId: "drive-id",
    driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=expired",
    createdAt: "2026-08-14T00:00:00.000Z",
    chunkSize: 8 * 1024 * 1024,
    exp: 9_999_999_999,
  } satisfies UploadTicketPayload;

  await assert.rejects(
    () =>
      uploadDriveChunk(
        ticket,
        new Uint8Array(10),
        10,
        0,
        9,
        testEnv(),
        fakeFetch,
      ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 410 &&
      "code" in error &&
      error.code === "UPLOAD_SESSION_EXPIRED",
  );
});

test("Drive completion compares normalized configured folder IDs", () => {
  const ticket = {
    v: 1,
    sessionId: "session",
    submissionId: crypto.randomUUID(),
    momentId: crypto.randomUUID(),
    guestSessionId: crypto.randomUUID(),
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

  assert.doesNotThrow(() =>
    verifyCompletedDriveFile(
      {
        id: "drive-id",
        size: 10,
        mimeType: "image/jpeg",
        parents: ["originals-folder"],
        trashed: false,
      },
      ticket,
      testEnv({ GOOGLE_DRIVE_ORIGINALS_FOLDER_ID: "  originals-folder  " }),
    ),
  );
});

test("Drive verification captures original media dimensions when available", async () => {
  resetGoogleTokenCacheForTests();
  let fileUrl = "";
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    fileUrl = url;
    return jsonResponse({
      id: "drive-id",
      size: "10",
      mimeType: "image/jpeg",
      parents: ["originals-folder"],
      trashed: false,
      imageMediaMetadata: { width: 4032, height: 3024 },
    });
  };

  const file = await getDriveFile("drive-id", testEnv(), fakeFetch);
  assert.equal(file?.originalWidth, 4032);
  assert.equal(file?.originalHeight, 3024);
  assert.match(fileUrl, /imageMediaMetadata\(width,height\)/);
  assert.match(fileUrl, /videoMediaMetadata\(width,height\)/);
});
