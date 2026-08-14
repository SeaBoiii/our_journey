import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.ts";
import { parseAllowedOrigins } from "../src/http.ts";
import { jsonResponse, testEnv } from "./helpers.ts";

test("allowed origins are parsed exactly and reject paths or wildcards", () => {
  const origins = parseAllowedOrigins("http://localhost:4321,https://seaboiii.github.io/");
  assert.equal(origins.has("https://seaboiii.github.io"), true);
  assert.throws(() => parseAllowedOrigins("https://example.com/preview"));
  assert.throws(() => parseAllowedOrigins("https://*.pages.dev"));
});

test("preflight reflects only an allowed origin and custom headers", async () => {
  const response = await handleRequest(
    new Request("https://api.example/v1/uploads/init", {
      method: "OPTIONS",
      headers: { origin: "https://seaboiii.github.io" },
    }),
    testEnv(),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://seaboiii.github.io");
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /x-guest-session/);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /x-moments-upload-token/);
});

test("untrusted origins get a structured error without CORS reflection or stacks", async () => {
  const response = await handleRequest(
    new Request("https://api.example/v1/moments", {
      headers: { origin: "https://attacker.example" },
    }),
    testEnv(),
  );
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.match(body, /INVALID_ORIGIN/);
  assert.doesNotMatch(body, /stack|google-refresh-token|service-test-key/i);
});

test("rate limiter failures return 429 with Retry-After", async () => {
  const response = await handleRequest(
    new Request("https://api.example/v1/sessions/anonymous", {
      method: "POST",
      headers: { origin: "http://localhost:4321", "cf-connecting-ip": "203.0.113.8" },
    }),
    testEnv({
      ENTRY_IP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:4321");
});

test("public gallery reads are throttled by a hashed client IP", async () => {
  const keys: string[] = [];
  const response = await handleRequest(
    new Request("https://api.example/v1/moments", {
      headers: {
        origin: "https://seaboiii.github.io",
        "cf-connecting-ip": "203.0.113.8",
      },
    }),
    testEnv({
      GALLERY_IP_RATE_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: true };
        },
      },
    }),
    { fetcher: async () => jsonResponse([]) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { moments: [], nextOffset: null } });
  assert.equal(keys.length, 1);
  assert.match(keys[0] ?? "", /^gallery-ip:/);
  assert.equal(keys[0]?.includes("203.0.113.8"), false);
});

test("public gallery rejects every client-provided moderation status", async () => {
  let upstreamCalls = 0;
  const response = await handleRequest(
    new Request("https://api.example/v1/moments?status=approved", {
      headers: { origin: "https://seaboiii.github.io" },
    }),
    testEnv(),
    {
      fetcher: async () => {
        upstreamCalls += 1;
        return jsonResponse([]);
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});
