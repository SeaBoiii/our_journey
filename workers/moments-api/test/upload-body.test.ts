import assert from "node:assert/strict";
import test from "node:test";

import { resetGoogleTokenCacheForTests } from "../src/google.ts";
import { handleRequest } from "../src/index.ts";
import { issueGuestSession, openUploadTicket, sealUploadTicket } from "../src/security.ts";
import type { Fetcher } from "../src/types.ts";
import { jsonResponse, testEnv } from "./helpers.ts";

function metadataFreeWebp(width = 600, height = 400): Uint8Array<ArrayBuffer> {
  const chunks: number[] = [];
  const pushAscii = (value: string) => {
    chunks.push(...[...value].map((character) => character.charCodeAt(0)));
  };
  pushAscii("VP8X");
  chunks.push(10, 0, 0, 0, 0, 0, 0, 0);
  const containerWidth = width - 1;
  const containerHeight = height - 1;
  chunks.push(
    containerWidth & 255,
    (containerWidth >> 8) & 255,
    (containerWidth >> 16) & 255,
    containerHeight & 255,
    (containerHeight >> 8) & 255,
    (containerHeight >> 16) & 255,
  );
  pushAscii("VP8 ");
  chunks.push(10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a);
  chunks.push(width & 255, (width >> 8) & 0x3f, height & 255, (height >> 8) & 0x3f);
  const bytes = new Uint8Array(12 + chunks.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  const riffSize = bytes.length - 8;
  bytes.set([riffSize & 255, (riffSize >> 8) & 255, (riffSize >> 16) & 255, (riffSize >> 24) & 255], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(chunks, 12);
  return bytes;
}

test("the buffered first chunk is bounded by bytes read, not only Content-Length", async () => {
  resetGoogleTokenCacheForTests();
  const guestRateLimitKeys: string[] = [];
  const ipRateLimitKeys: string[] = [];
  const env = testEnv({
    UPLOAD_SESSION_RATE_LIMITER: {
      limit: async ({ key }) => {
        guestRateLimitKeys.push(key);
        return { success: true };
      },
    },
    UPLOAD_IP_RATE_LIMITER: {
      limit: async ({ key }) => {
        ipRateLimitKeys.push(key);
        return { success: true };
      },
    },
  });
  const guest = await issueGuestSession(env);
  const sessionId = crypto.randomUUID();
  const uploadToken = await sealUploadTicket(
    {
      v: 1,
      sessionId,
      submissionId: crypto.randomUUID(),
      momentId: crypto.randomUUID(),
      guestSessionId: guest.payload.sid,
      guestName: "Guest",
      caption: "",
      clientFileId: "client",
      fileName: "photo.jpg",
      fileSize: 3,
      mimeType: "image/jpeg",
      mediaType: "photo",
      driveFileId: "drive-id",
      driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
      createdAt: "2026-08-14T00:00:00.000Z",
      chunkSize: 8 * 1024 * 1024,
    },
    env,
  );
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    assert.equal(new Headers(init?.headers).get("content-range"), "bytes */3");
    return new Response(null, { status: 308 });
  };

  const response = await handleRequest(
    new Request(`https://api.example/v1/uploads/${sessionId}/chunks/0`, {
      method: "PUT",
      headers: {
        "content-length": "3",
        "content-range": "bytes 0-2/3",
        "content-type": "image/jpeg",
        "cf-connecting-ip": "203.0.113.8",
        origin: "https://seaboiii.github.io",
        "x-guest-session": guest.token,
        "x-moments-upload-token": uploadToken,
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    }),
    env,
    { fetcher: fakeFetch },
  );

  assert.equal(response.status, 413);
  const body = (await response.json()) as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "CHUNK_TOO_LARGE");
  assert.equal(body.error.retryable, false);
  assert.deepEqual(guestRateLimitKeys, [`guest:${guest.payload.sid}`]);
  assert.equal(ipRateLimitKeys.length, 1);
  assert.match(ipRateLimitKeys[0] ?? "", /^upload-ip:/);
  assert.equal(ipRateLimitKeys.some((key) => key.includes("203.0.113.8")), false);
});

test("later chunks cross a fixed-length stream without buffering or deadlock", async () => {
  resetGoogleTokenCacheForTests();
  const env = testEnv();
  const guest = await issueGuestSession(env);
  const sessionId = crypto.randomUUID();
  const uploadToken = await sealUploadTicket(
    {
      v: 1,
      sessionId,
      submissionId: crypto.randomUUID(),
      momentId: crypto.randomUUID(),
      guestSessionId: guest.payload.sid,
      guestName: "Guest",
      caption: "",
      clientFileId: "client",
      fileName: "photo.jpg",
      fileSize: 6,
      mimeType: "image/jpeg",
      mediaType: "photo",
      driveFileId: "drive-id",
      driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
      createdAt: "2026-08-14T00:00:00.000Z",
      chunkSize: 8 * 1024 * 1024,
    },
    env,
  );
  const fixedLengths: number[] = [];
  const forwardedBodies: Uint8Array[] = [];
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("content-range") === "bytes */6") {
      return new Response(null, { status: 308, headers: { range: "bytes=0-2" } });
    }
    assert.equal(headers.get("content-range"), "bytes 3-5/6");
    assert.equal(headers.get("content-length"), "3");
    forwardedBodies.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
    return jsonResponse({ id: "drive-id" });
  };

  const response = await handleRequest(
    new Request(`https://api.example/v1/uploads/${sessionId}/chunks/1`, {
      method: "PUT",
      headers: {
        "content-length": "3",
        "content-range": "bytes 3-5/6",
        "content-type": "image/jpeg",
        origin: "https://seaboiii.github.io",
        "x-guest-session": guest.token,
        "x-moments-upload-token": uploadToken,
      },
      body: new Uint8Array([0x10, 0x20, 0x30]),
    }),
    env,
    {
      fetcher: fakeFetch,
      fixedLengthStreamFactory: (expectedBytes) => {
        fixedLengths.push(expectedBytes);
        return new TransformStream<Uint8Array, Uint8Array>();
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(fixedLengths, [3]);
  assert.deepEqual(forwardedBodies, [new Uint8Array([0x10, 0x20, 0x30])]);
  assert.deepEqual(await response.json(), {
    data: {
      sessionId,
      nextOffset: 6,
      uploadedBytes: 6,
      totalBytes: 6,
      complete: true,
    },
  });
});

test("invalid database text is rejected before any Google request", async () => {
  const env = testEnv();
  const guest = await issueGuestSession(env);
  let upstreamCalls = 0;
  const response = await handleRequest(
    new Request("https://api.example/v1/uploads/init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://seaboiii.github.io",
        "x-guest-session": guest.token,
      },
      body: JSON.stringify({
        guestName: "Guest\u0000",
        caption: "",
        files: [
          {
            clientFileId: "client",
            fileName: "photo.jpg",
            fileSize: 3,
            mimeType: "image/jpeg",
            mediaType: "photo",
          },
        ],
      }),
    }),
    env,
    {
      fetcher: async () => {
        upstreamCalls += 1;
        throw new Error("Google must not be called");
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test("derivative upload binds gallery and thumbnail to one canonical object", async () => {
  resetGoogleTokenCacheForTests();
  const env = testEnv();
  const guest = await issueGuestSession(env);
  const sessionId = crypto.randomUUID();
  const momentId = crypto.randomUUID();
  const uploadToken = await sealUploadTicket(
    {
      v: 1,
      sessionId,
      submissionId: crypto.randomUUID(),
      momentId,
      guestSessionId: guest.payload.sid,
      guestName: "Guest",
      caption: "",
      clientFileId: "client",
      fileName: "photo.jpg",
      fileSize: 3,
      mimeType: "image/jpeg",
      mediaType: "photo",
      driveFileId: "drive-id",
      driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque",
      createdAt: "2026-08-14T00:00:00.000Z",
      chunkSize: 8 * 1024 * 1024,
    },
    env,
  );
  const canonical = metadataFreeWebp();
  const form = new FormData();
  form.append("gallery", new Blob([canonical], { type: "image/webp" }), "gallery.webp");
  const encodedRequest = new Request("https://encode.invalid", { method: "POST", body: form });
  const contentType = encodedRequest.headers.get("content-type")!;
  const multipartBody = await encodedRequest.arrayBuffer();
  const stored: Array<{ url: string; bytes: Uint8Array }> = [];
  const fakeFetch: Fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    if (url.includes("www.googleapis.com/drive/v3/files/")) {
      return jsonResponse({
        id: "drive-id",
        size: "3",
        mimeType: "image/jpeg",
        parents: ["originals-folder"],
        trashed: false,
      });
    }
    if (url.includes("/rest/v1/moments")) return jsonResponse([]);
    if (url.includes("/storage/v1/object/") && init?.method === "POST") {
      stored.push({ url, bytes: new Uint8Array(init.body as ArrayBuffer).slice() });
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await handleRequest(
    new Request(`https://api.example/v1/uploads/${sessionId}/derivatives`, {
      method: "POST",
      headers: {
        "content-length": String(multipartBody.byteLength),
        "content-type": contentType,
        origin: "https://seaboiii.github.io",
        "x-guest-session": guest.token,
        "x-moments-upload-token": uploadToken,
      },
      body: multipartBody,
    }),
    env,
    { fetcher: fakeFetch },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { uploadToken: string; gallery: { width: number }; thumbnail: { width: number } };
  };
  assert.equal(body.data.gallery.width, 600);
  assert.equal(body.data.thumbnail.width, 600);
  const ticket = await openUploadTicket(body.data.uploadToken, env, guest.payload, sessionId);
  assert.equal(ticket.derivatives?.gallery.path, `${momentId}/gallery.webp`);
  assert.equal(ticket.derivatives?.thumbnail.path, ticket.derivatives?.gallery.path);
  assert.equal(stored.length, 1);
  assert.match(stored[0]?.url ?? "", new RegExp(`${momentId}/gallery\\.webp$`));
  assert.deepEqual(stored[0]?.bytes, canonical);
});
