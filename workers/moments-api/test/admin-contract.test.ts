import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.ts";
import type { Fetcher } from "../src/types.ts";
import { jsonResponse, testEnv } from "./helpers.ts";

function authorizedAdminFetch(): Fetcher {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({ id: "admin-id", email: "owner@example.com" });
    }
    if (url.includes("/rest/v1/moment_admins")) {
      return jsonResponse([{ user_id: "admin-id" }]);
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
}

test("admin session response matches the nested user identity contract", async () => {
  const response = await handleRequest(
    new Request("https://api.example/v1/admin/session", {
      headers: {
        authorization: "Bearer admin-jwt",
        origin: "https://seaboiii.github.io",
      },
    }),
    testEnv(),
    { fetcher: authorizedAdminFetch() },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      authenticated: true,
      authorized: true,
      user: { id: "admin-id", email: "owner@example.com" },
    },
  });
});

test("moderation rejects extra JSON keys with a structured 400", async () => {
  const response = await handleRequest(
    new Request("https://api.example/v1/admin/moments/moment-id/status", {
      method: "PATCH",
      headers: {
        authorization: "Bearer admin-jwt",
        "content-type": "application/json",
        origin: "https://seaboiii.github.io",
      },
      body: JSON.stringify({ status: "approved", driveFileId: "must-not-be-accepted" }),
    }),
    testEnv(),
    { fetcher: authorizedAdminFetch() },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as {
    error: { code: string; message: string; requestId: string; retryable: boolean };
  };
  assert.equal(body.error.code, "INVALID_STATUS");
  assert.equal(body.error.retryable, false);
  assert.ok(body.error.requestId);
  assert.equal(JSON.stringify(body).includes("driveFileId"), false);
});

test("admin list returns an authoritative bounded nextOffset", async () => {
  let listUrl = "";
  const fakeFetch: Fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({ id: "admin-id", email: "owner@example.com" });
    }
    if (url.includes("/rest/v1/moment_admins")) {
      return jsonResponse([{ user_id: "admin-id" }]);
    }
    if (url.includes("/rest/v1/moments")) {
      listUrl = url;
      return jsonResponse(
        Array.from({ length: 21 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          guest_name: `Guest ${index}`,
          caption: "",
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
          status: "pending",
          processing_status: "pending",
          moderated_at: null,
        })),
      );
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  const response = await handleRequest(
    new Request("https://api.example/v1/admin/moments?status=pending&limit=20&offset=5", {
      headers: {
        authorization: "Bearer admin-jwt",
        origin: "https://seaboiii.github.io",
      },
    }),
    testEnv(),
    { fetcher: fakeFetch },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { moments: unknown[]; nextOffset: number | null } };
  assert.equal(body.data.moments.length, 20);
  assert.equal(body.data.nextOffset, 25);
  assert.match(listUrl, /limit=21/);
  assert.match(listUrl, /offset=5/);
});
