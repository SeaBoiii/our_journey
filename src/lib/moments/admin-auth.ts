import {
  createClient,
  isAuthApiError,
  type AuthChangeEvent,
  type Session,
  type SupportedStorage,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { MOMENTS_CONFIG } from "../../config/moments";
import {
  apiUrl,
  isAdminIdentityDto,
  MomentsApiError,
  readApiResponse,
  type AdminIdentityDto,
} from "./api";

const AUTH_STORAGE_KEY = "our-journey:moments:admin-auth:v1";
const PKCE_VERIFIER_TTL_MS = 60 * 60 * 1000;
const PKCE_EXPIRY_SUFFIX = ":expires-at";
let adminClient: SupabaseClient | undefined;

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;

function isPkceStorageKey(key: string): boolean {
  return (
    key.startsWith(`${AUTH_STORAGE_KEY}-`) && key.includes("code-verifier")
  );
}

function pkceExpiryKey(key: string): string {
  return `${key}${PKCE_EXPIRY_SUFFIX}`;
}

export function createAdminAuthStorage(
  sessionStorage: BrowserStorage,
  verifierStorage: BrowserStorage,
  now: () => number = Date.now,
): SupportedStorage {
  const removeVerifier = (key: string) => {
    verifierStorage.removeItem(key);
    verifierStorage.removeItem(pkceExpiryKey(key));
  };
  const readVerifier = (key: string): string | null => {
    const value = verifierStorage.getItem(key);
    const expiresAt = Number(verifierStorage.getItem(pkceExpiryKey(key)));
    if (!value || !Number.isFinite(expiresAt) || expiresAt <= now()) {
      removeVerifier(key);
      return null;
    }
    return value;
  };

  // Clear expired verifier entries when a new tab initializes the client.
  if (
    typeof verifierStorage.length === "number" &&
    typeof verifierStorage.key === "function"
  ) {
    const keys = Array.from(
      { length: verifierStorage.length },
      (_, index) => verifierStorage.key?.(index) ?? null,
    ).filter(
      (key): key is string =>
        typeof key === "string" &&
        isPkceStorageKey(key) &&
        !key.endsWith(PKCE_EXPIRY_SUFFIX),
    );
    for (const key of keys) readVerifier(key);
  }

  return {
    getItem: (key) =>
      isPkceStorageKey(key)
        ? readVerifier(key)
        : sessionStorage.getItem(key),
    setItem: (key, value) => {
      if (!isPkceStorageKey(key)) {
        sessionStorage.setItem(key, value);
        return;
      }
      const expiresAt = now() + PKCE_VERIFIER_TTL_MS;
      verifierStorage.setItem(key, value);
      verifierStorage.setItem(pkceExpiryKey(key), String(expiresAt));
      if (
        typeof window !== "undefined" &&
        verifierStorage === window.localStorage
      ) {
        window.setTimeout(() => readVerifier(key), PKCE_VERIFIER_TTL_MS + 100);
      }
    },
    removeItem: (key) => {
      if (isPkceStorageKey(key)) {
        removeVerifier(key);
      } else {
        sessionStorage.removeItem(key);
      }
    },
  };
}

export interface AdminFrameContext {
  readonly self: unknown;
  readonly top: unknown;
}

export function isAdminPageEmbedded(context: AdminFrameContext): boolean {
  try {
    return context.top !== context.self;
  } catch {
    // If a hostile or unusual browsing context prevents inspection, fail closed.
    return true;
  }
}

export class AdminAuthConfigurationError extends Error {
  constructor() {
    super("Admin authentication has not been configured.");
    this.name = "AdminAuthConfigurationError";
  }
}

export class AdminMagicLinkUnavailableError extends Error {
  constructor() {
    super("The sign-in service is temporarily unavailable. Please try again later.");
    this.name = "AdminMagicLinkUnavailableError";
  }
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(
    MOMENTS_CONFIG.apiUrl &&
      MOMENTS_CONFIG.supabaseUrl &&
      MOMENTS_CONFIG.supabaseAnonKey,
  );
}

function getAdminClient(): SupabaseClient {
  if (!isAdminAuthConfigured()) {
    throw new AdminAuthConfigurationError();
  }

  adminClient ??= createClient(
    MOMENTS_CONFIG.supabaseUrl,
    MOMENTS_CONFIG.supabaseAnonKey,
    {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
        storage:
          typeof window === "undefined"
            ? undefined
            : createAdminAuthStorage(
                window.sessionStorage,
                window.localStorage,
              ),
        experimental: { appendPkceFlowIdToRedirects: true },
      },
    },
  );

  return adminClient;
}

export async function getAdminSession(): Promise<Session | null> {
  const { data, error } = await getAdminClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAdminAccessToken(): Promise<string> {
  const session = await getAdminSession();
  if (!session?.access_token) {
    throw new MomentsApiError(
      "AUTH_REQUIRED",
      "Sign in before opening the moderation queue.",
      { status: 401 },
    );
  }
  return session.access_token;
}

export function subscribeToAdminSession(
  listener: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const { data } = getAdminClient().auth.onAuthStateChange(listener);
  return () => data.subscription.unsubscribe();
}

function currentAdminRedirectUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const redirectUrl = new URL(window.location.href);
  redirectUrl.search = "";
  redirectUrl.hash = "";
  return redirectUrl.toString();
}

export async function sendAdminMagicLink(email: string): Promise<void> {
  let authError: unknown;
  try {
    const { error } = await getAdminClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: currentAdminRedirectUrl(),
      },
    });
    authError = error;
  } catch (error) {
    authError = error;
  }

  if (!authError) return;
  const failure = normaliseAdminMagicLinkFailure(authError);
  if (failure) throw failure;
}

export function isAccountNeutralMagicLinkError(error: unknown): boolean {
  // Account-specific client errors are intentionally indistinguishable from a
  // successful request. Rate limiting is service state, not account state, and
  // must remain visible as a generic temporary failure so guests can retry.
  return (
    isAuthApiError(error) &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

export function normaliseAdminMagicLinkFailure(
  error: unknown,
): AdminMagicLinkUnavailableError | null {
  return isAccountNeutralMagicLinkError(error)
    ? null
    : new AdminMagicLinkUnavailableError();
}

export async function signOutAdmin(): Promise<void> {
  const { error } = await getAdminClient().auth.signOut();
  if (error) throw error;
}

export async function verifyAdminAuthorization(
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly apiBaseUrl?: string;
    readonly accessToken?: string;
  } = {},
): Promise<AdminIdentityDto> {
  const accessToken = options.accessToken ?? (await getAdminAccessToken());
  const response = await (options.fetchImpl ?? fetch)(
    apiUrl(options.apiBaseUrl ?? MOMENTS_CONFIG.apiUrl, "/v1/admin/session"),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  return readApiResponse<AdminIdentityDto>(response, isAdminIdentityDto);
}
