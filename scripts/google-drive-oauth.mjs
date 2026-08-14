import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const args = new Set(process.argv.slice(2));
const shouldCreateFolders = args.has("--create-folders");
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
const configuredPort = Number(process.env.GOOGLE_OAUTH_CALLBACK_PORT || 53682);

if (!clientId || !clientSecret) {
  throw new Error(
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET before running this helper.",
  );
}

if (!Number.isInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535) {
  throw new Error("GOOGLE_OAUTH_CALLBACK_PORT must be an integer from 1024 to 65535.");
}

function jsonBody(value) {
  return JSON.stringify(value);
}

async function createDriveFolder({ accessToken, name, parentId }) {
  const response = await fetch(`${GOOGLE_DRIVE_FILES_URL}?fields=id,name`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: jsonBody({
      name,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Drive folder creation failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (!payload || typeof payload.id !== "string") {
    throw new Error("Google Drive did not return a folder ID.");
  }

  return payload.id;
}

async function createWeddingFolders(accessToken) {
  const weddingRootId = await createDriveFolder({
    accessToken,
    name: "Aleem & Ain Wedding",
  });
  const guestMomentsId = await createDriveFolder({
    accessToken,
    name: "Guest Moments",
    parentId: weddingRootId,
  });
  const originalsId = await createDriveFolder({
    accessToken,
    name: "Originals",
    parentId: guestMomentsId,
  });
  const videosId = await createDriveFolder({
    accessToken,
    name: "Videos",
    parentId: guestMomentsId,
  });

  return { weddingRootId, guestMomentsId, originalsId, videosId };
}

async function exchangeAuthorizationCode({ code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const description =
      payload && typeof payload.error_description === "string"
        ? ` ${payload.error_description}`
        : "";
    throw new Error(`Google OAuth code exchange failed with HTTP ${response.status}.${description}`);
  }

  if (
    !payload ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string"
  ) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app grant, then run this helper again with consent enabled.",
    );
  }

  return payload;
}

const state = randomBytes(24).toString("base64url");
const codeVerifier = randomBytes(64).toString("base64url");
const codeChallenge = createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const redirectUri = `http://127.0.0.1:${configuredPort}/oauth2/callback`;
const authorizationUrl = new URL(GOOGLE_AUTHORIZE_URL);
authorizationUrl.search = new URLSearchParams({
  access_type: "offline",
  client_id: clientId,
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  prompt: "consent",
  redirect_uri: redirectUri,
  response_type: "code",
  scope: DRIVE_FILE_SCOPE,
  state,
}).toString();

let settled = false;
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", redirectUri);

  if (requestUrl.pathname !== "/oauth2/callback") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (settled) {
    response.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("This authorization attempt has already finished.");
    return;
  }

  settled = true;
  const returnedState = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");

  if (returnedState !== state || !code || oauthError) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Authorization could not be completed. Return to the terminal for details.");
    server.close();
    process.exitCode = 1;
    console.error(
      oauthError
        ? `Google returned: ${oauthError}`
        : "The OAuth callback was missing a valid code or state value.",
    );
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      redirectUri,
      codeVerifier,
    });
    const folders = shouldCreateFolders
      ? await createWeddingFolders(tokens.access_token)
      : null;

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Moments authorization complete</title><main style='font:18px system-ui;max-width:42rem;margin:4rem auto;padding:1rem'><h1>Authorization complete</h1><p>You can close this tab and return to the terminal.</p></main>",
    );

    console.log("\nAuthorization complete. Copy the following value directly into a Cloudflare Worker secret:");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nDo not commit it or paste it into the Astro frontend environment.");

    if (folders) {
      console.log("\nFolders created by this OAuth app (required for the narrow drive.file scope):");
      console.log(`GOOGLE_DRIVE_ORIGINALS_FOLDER_ID=${folders.originalsId}`);
      console.log(`GOOGLE_DRIVE_VIDEOS_FOLDER_ID=${folders.videosId}`);
      console.log(`Guest Moments folder: ${folders.guestMomentsId}`);
      console.log(`Wedding root folder: ${folders.weddingRootId}`);
    }
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Authorization reached the callback, but setup failed. Return to the terminal.");
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : "Google OAuth setup failed.");
  } finally {
    server.close();
  }
});

server.on("error", (error) => {
  console.error(`The local OAuth callback server could not start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(configuredPort, "127.0.0.1", () => {
  console.log(`Local callback: ${redirectUri}`);
  console.log(`Requested scope: ${DRIVE_FILE_SCOPE}`);
  console.log("\nOpen this URL in a browser signed into the Drive owner account:\n");
  console.log(authorizationUrl.toString());
  console.log("\nWaiting for the one-time OAuth callback…");
});
