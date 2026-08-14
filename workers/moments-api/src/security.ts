import { ApiError } from "./errors.ts";
import type {
  Env,
  GuestSessionPayload,
  UploadTicketPayload,
} from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const GUEST_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const UPLOAD_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const UPLOAD_TOKEN_AAD = encoder.encode("moments-upload-ticket:v1");

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError(401, "AUTH_REQUIRED", "That session token is invalid.");
  }
}

function requireSessionSecret(env: Env): Uint8Array {
  const secret = env.MOMENTS_SESSION_SECRET?.trim();
  if (!secret || encoder.encode(secret).byteLength < 32) {
    throw new ApiError(
      500,
      "SERVER_MISCONFIGURED",
      "The API session secret is not configured safely.",
    );
  }
  return encoder.encode(secret);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ownedBuffer(requireSessionSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function uploadEncryptionKey(env: Env): Promise<CryptoKey> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(requireSessionSecret(env)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("our-journey:moments-api"),
      info: encoder.encode("upload-ticket:aes-gcm:v1"),
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function issueGuestSession(
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; payload: GuestSessionPayload }> {
  const payload: GuestSessionPayload = {
    v: 1,
    sid: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + GUEST_TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(encodedPayload)),
  );
  return { token: `v1.${encodedPayload}.${base64UrlEncode(signature)}`, payload };
}

function isGuestSessionPayload(value: unknown): value is GuestSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.sid === "string" &&
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number"
  );
}

export async function verifyGuestSession(
  token: string | null,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<GuestSessionPayload> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    throw new ApiError(401, "AUTH_REQUIRED", "A valid guest session is required.");
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env),
    ownedBuffer(base64UrlDecode(parts[2])),
    encoder.encode(parts[1]),
  );
  if (!valid) {
    throw new ApiError(401, "AUTH_REQUIRED", "That guest session is invalid.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
  } catch {
    throw new ApiError(401, "AUTH_REQUIRED", "That guest session is invalid.");
  }
  if (!isGuestSessionPayload(payload) || payload.exp <= nowSeconds) {
    throw new ApiError(401, "AUTH_REQUIRED", "That guest session has expired.");
  }
  return payload;
}

export async function sealUploadTicket(
  payload: Omit<UploadTicketPayload, "exp"> & { exp?: number },
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const completePayload: UploadTicketPayload = {
    ...payload,
    exp: payload.exp ?? nowSeconds + UPLOAD_TOKEN_TTL_SECONDS,
  };
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: UPLOAD_TOKEN_AAD },
    await uploadEncryptionKey(env),
    encoder.encode(JSON.stringify(completePayload)),
  );
  return `v1.${base64UrlEncode(nonce)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

function isUploadTicketPayload(value: unknown): value is UploadTicketPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.submissionId === "string" &&
    typeof candidate.momentId === "string" &&
    typeof candidate.guestSessionId === "string" &&
    typeof candidate.driveFileId === "string" &&
    typeof candidate.driveUploadUri === "string" &&
    typeof candidate.fileSize === "number" &&
    typeof candidate.chunkSize === "number" &&
    typeof candidate.exp === "number"
  );
}

export async function openUploadTicket(
  token: string | null,
  env: Env,
  guest: GuestSessionPayload,
  expectedSessionId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<UploadTicketPayload> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    throw new ApiError(401, "AUTH_REQUIRED", "A valid upload token is required.");
  }

  let payload: unknown;
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedBuffer(base64UrlDecode(parts[1])),
        additionalData: UPLOAD_TOKEN_AAD,
      },
      await uploadEncryptionKey(env),
      ownedBuffer(base64UrlDecode(parts[2])),
    );
    payload = JSON.parse(decoder.decode(decrypted));
  } catch {
    throw new ApiError(401, "AUTH_REQUIRED", "That upload token is invalid.");
  }

  if (!isUploadTicketPayload(payload)) {
    throw new ApiError(401, "AUTH_REQUIRED", "That upload token is invalid.");
  }
  if (payload.exp <= nowSeconds) {
    throw new ApiError(
      410,
      "UPLOAD_SESSION_EXPIRED",
      "That upload session has expired. Please start the upload again.",
    );
  }
  if (
    payload.sessionId !== expectedSessionId ||
    payload.guestSessionId !== guest.sid
  ) {
    throw new ApiError(403, "ACCESS_DENIED", "That upload session is not yours.");
  }
  return payload;
}

export async function sha256Text(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return base64UrlEncode(digest);
}
