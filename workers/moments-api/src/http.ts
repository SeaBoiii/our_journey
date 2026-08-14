import { ApiError } from "./errors.ts";
import type { Env } from "./types.ts";

export const ALLOWED_CORS_HEADERS = [
  "authorization",
  "content-length",
  "content-range",
  "content-type",
  "x-guest-session",
  "x-moments-upload-token",
].join(", ");

const ALLOWED_CORS_METHODS = "DELETE, GET, OPTIONS, PATCH, POST, PUT";

export function parseAllowedOrigins(raw: string): ReadonlySet<string> {
  const origins = new Set<string>();

  for (const candidate of raw.split(",")) {
    const value = candidate.trim();
    if (!value) continue;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ApiError(
        500,
        "SERVER_MISCONFIGURED",
        "The API origin allowlist is not configured correctly.",
      );
    }

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes("*") ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.origin !== value.replace(/\/$/, "")
    ) {
      throw new ApiError(
        500,
        "SERVER_MISCONFIGURED",
        "The API origin allowlist must contain exact HTTP origins only.",
      );
    }

    origins.add(parsed.origin);
  }

  if (origins.size === 0) {
    throw new ApiError(
      500,
      "SERVER_MISCONFIGURED",
      "At least one allowed API origin must be configured.",
    );
  }

  return origins;
}

export function requireAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("origin");
  if (!origin || !parseAllowedOrigins(env.MOMENTS_ALLOWED_ORIGINS).has(origin)) {
    throw new ApiError(
      403,
      "INVALID_ORIGIN",
      "This website is not allowed to call the Moments API.",
    );
  }
  return origin;
}

export function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", ALLOWED_CORS_METHODS);
  headers.set("access-control-allow-headers", ALLOWED_CORS_HEADERS);
  headers.set("access-control-expose-headers", "retry-after, x-request-id");
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

export async function readJson<T>(
  request: Request,
  maximumBytes = 64 * 1024,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(
      415,
      "INVALID_REQUEST",
      "This endpoint expects a JSON request.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, "INVALID_REQUEST", "That request is too large.");
  }

  if (!request.body) throw new ApiError(400, "INVALID_REQUEST", "That request has no JSON body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new ApiError(413, "INVALID_REQUEST", "That request is too large.");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "That request is not valid JSON.");
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw new ApiError(401, "AUTH_REQUIRED", "Admin sign-in is required.");
  }
  return match[1];
}
