import { ApiError, errorResponse } from "./errors.ts";
import {
  adminMoments,
  adminSession,
  cancelUpload,
  completeUpload,
  createAnonymousSession,
  getUploadStatus,
  initializeUploads,
  moderateMoment,
  publicMoment,
  publicMoments,
  uploadChunk,
  uploadDerivatives,
  type HandlerDependencies,
} from "./handlers.ts";
import { jsonResponse, requireAllowedOrigin, withCors } from "./http.ts";
import type { Env, ExecutionContextLike } from "./types.ts";

function methodNotAllowed(): never {
  throw new ApiError(405, "INVALID_REQUEST", "That request method is not available.");
}

export async function routeRequest(
  request: Request,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/v1/health") {
    if (request.method !== "GET") methodNotAllowed();
    return jsonResponse({ ok: true, service: "moments-api" });
  }
  if (path === "/v1/sessions/anonymous") {
    if (request.method !== "POST") methodNotAllowed();
    return createAnonymousSession(request, env);
  }
  if (path === "/v1/uploads/init") {
    if (request.method !== "POST") methodNotAllowed();
    return initializeUploads(request, env, dependencies);
  }

  let match = /^\/v1\/uploads\/([^/]+)\/chunks\/(\d+)$/.exec(path);
  if (match) {
    if (request.method !== "PUT") methodNotAllowed();
    return uploadChunk(request, env, decodeURIComponent(match[1]!), match[2]!, dependencies);
  }
  match = /^\/v1\/uploads\/([^/]+)\/derivatives$/.exec(path);
  if (match) {
    if (request.method !== "POST") methodNotAllowed();
    return uploadDerivatives(request, env, decodeURIComponent(match[1]!), dependencies);
  }
  match = /^\/v1\/uploads\/([^/]+)\/complete$/.exec(path);
  if (match) {
    if (request.method !== "POST") methodNotAllowed();
    return completeUpload(request, env, decodeURIComponent(match[1]!), dependencies);
  }
  match = /^\/v1\/uploads\/([^/]+)$/.exec(path);
  if (match) {
    const sessionId = decodeURIComponent(match[1]!);
    if (request.method === "GET") return getUploadStatus(request, env, sessionId, dependencies);
    if (request.method === "DELETE") return cancelUpload(request, env, sessionId);
    methodNotAllowed();
  }

  if (path === "/v1/moments") {
    if (request.method !== "GET") methodNotAllowed();
    return publicMoments(request, url, env, dependencies);
  }
  match = /^\/v1\/moments\/([^/]+)$/.exec(path);
  if (match) {
    if (request.method !== "GET") methodNotAllowed();
    return publicMoment(request, decodeURIComponent(match[1]!), env, dependencies);
  }

  if (path === "/v1/admin/session") {
    if (request.method !== "GET") methodNotAllowed();
    return adminSession(request, env, dependencies);
  }
  if (path === "/v1/admin/moments") {
    if (request.method !== "GET") methodNotAllowed();
    return adminMoments(request, url, env, dependencies);
  }
  match = /^\/v1\/admin\/moments\/([^/]+)\/status$/.exec(path);
  if (match) {
    if (request.method !== "PATCH") methodNotAllowed();
    return moderateMoment(request, env, decodeURIComponent(match[1]!), dependencies);
  }

  throw new ApiError(404, "NOT_FOUND", "That API endpoint could not be found.");
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let origin: string | null = null;
  try {
    const path = new URL(request.url).pathname;
    if (path !== "/v1/health") origin = requireAllowedOrigin(request, env);
    else {
      const candidate = request.headers.get("origin");
      if (candidate) origin = requireAllowedOrigin(request, env);
    }

    if (request.method === "OPTIONS") {
      if (!origin) throw new ApiError(403, "INVALID_ORIGIN", "That origin is not allowed.");
      return withCors(new Response(null, { status: 204 }), origin);
    }
    const routed = await routeRequest(request, env, dependencies);
    const headers = new Headers(routed.headers);
    headers.set("x-request-id", requestId);
    const response = new Response(routed.body, {
      status: routed.status,
      statusText: routed.statusText,
      headers,
    });
    return origin ? withCors(response, origin) : response;
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    console.error(
      JSON.stringify({
        requestId,
        code: apiError?.code ?? "INTERNAL_ERROR",
        status: apiError?.status ?? 500,
        method: request.method,
        path: new URL(request.url).pathname,
      }),
    );
    const response = errorResponse(error, requestId);
    return origin ? withCors(response, origin) : response;
  }
}

export default {
  fetch(request: Request, env: Env, _context: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env);
  },
};

export { ApiError } from "./errors.ts";
export * from "./google.ts";
export * from "./http.ts";
export * from "./security.ts";
export * from "./supabase.ts";
export * from "./validation.ts";
