import type { Env } from "../src/types.ts";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
    GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "google-refresh-token",
    GOOGLE_DRIVE_ORIGINALS_FOLDER_ID: "originals-folder",
    GOOGLE_DRIVE_VIDEOS_FOLDER_ID: "videos-folder",
    MOMENTS_SESSION_SECRET: "test-only-session-secret-that-is-longer-than-thirty-two-bytes",
    MOMENTS_ALLOWED_ORIGINS: "http://localhost:4321,https://seaboiii.github.io",
    MOMENTS_ALLOW_VIDEOS: "false",
    MOMENTS_REQUIRE_MODERATION: "true",
    MOMENTS_DERIVATIVES_BUCKET: "moments-gallery",
    MOMENTS_SIGNED_URL_TTL_SECONDS: "900",
    ...overrides,
  };
}

export function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}
