const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

function normaliseBase(baseUrl: string): string {
  const trimmedBase = baseUrl.trim();

  if (!trimmedBase) {
    return "/";
  }

  return `${trimmedBase.replace(/\/+$/, "")}/`;
}

function isExternalOrSpecialUrl(path: string): boolean {
  return SCHEME_PATTERN.test(path) || path.startsWith("//");
}

/**
 * Prefix a repository-local route or asset with Astro's configured base path.
 * Absolute, protocol-relative, blob, and data URLs are returned unchanged.
 */
export function withBase(
  path: string,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const trimmedPath = path.trim();

  if (isExternalOrSpecialUrl(trimmedPath)) {
    return trimmedPath;
  }

  const base = normaliseBase(baseUrl);

  if (!trimmedPath) {
    return base;
  }

  if (trimmedPath.startsWith("#") || trimmedPath.startsWith("?")) {
    return `${base}${trimmedPath}`;
  }

  return `${base}${trimmedPath.replace(/^\/+/, "")}`;
}

export function momentsPath(path = ""): string {
  const childPath = path.replace(/^\/+/, "");
  return withBase(childPath ? `moments/${childPath}` : "moments/");
}

/**
 * Link back to the invitation. PUBLIC_JOURNEY_URL is browser-safe and may be
 * set once Moments is deployed separately. Invalid or non-HTTP values are
 * ignored so an accidental javascript: value can never become a link target.
 */
export function journeyUrl(path = ""): string {
  const configuredJourneyUrl = import.meta.env.PUBLIC_JOURNEY_URL?.trim();
  const childPath = path.replace(/^\/+/, "");

  if (!configuredJourneyUrl) {
    return withBase(childPath);
  }

  try {
    const parsedUrl = new URL(configuredJourneyUrl);

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return withBase(childPath);
    }

    parsedUrl.hash = "";
    parsedUrl.search = "";
    parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, "")}/`;

    return childPath
      ? new URL(childPath, parsedUrl).toString()
      : parsedUrl.toString();
  } catch {
    return withBase(childPath);
  }
}
