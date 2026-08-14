# Google Drive setup for Moments

Moments stores full-quality originals in the wedding owner's private Google My
Drive. Guests never sign in to Google. The Cloudflare Worker uses one owner
OAuth grant and exchanges its refresh token for short-lived access tokens.

No Google credential belongs in the Astro build, a `PUBLIC_` variable, GitHub,
or Supabase.

## 1. Create the Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com/).
2. Create or select the project dedicated to Moments.
3. Open **APIs & Services → Library** and enable **Google Drive API**.
4. Configure the OAuth consent screen. For the initial private validation, use
   an External app in **Testing** and add only the Drive owner Google account as
   a test user. Do not leave the deployed wedding backend in Testing: Google
   expires refresh tokens for External/Testing clients after seven days when
   scopes such as Drive are requested.
5. Declare the scope
   `https://www.googleapis.com/auth/drive.file`.

`drive.file` is the narrow, non-sensitive scope that lets this OAuth app create
and manage its own Drive files. It does not grant access to every file in the
owner's Drive. This project deliberately does not request the broad restricted
`drive` scope.

Before relying on guest uploads, change the consent screen publishing status to
**In production**, revoke the temporary testing grant, and run the helper again.
Store that newly issued refresh token in the Worker. Publishing status does not
make Drive files public, and production refresh tokens can still be revoked or
invalidated, so keep the health check and a real small upload in the pre-event
checklist.

## 2. Create the OAuth client

Create an OAuth client with application type **Desktop app**. The local helper
uses a loopback callback on `127.0.0.1`; it is never deployed as part of the
wedding site.

Copy the client ID and client secret into environment variables in the terminal
where the one-time helper will run. Do not put them in `.env` for Astro.

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID='your desktop client id'
$env:GOOGLE_OAUTH_CLIENT_SECRET='your desktop client secret'
npm run oauth:google -- --create-folders
```

The script prints an authorization URL. Open it while signed into the Drive
owner account, approve the single scope, and let Google return to the local
callback. The authorization request uses:

- `access_type=offline` so Google can issue a refresh token;
- `prompt=consent` so this explicit owner setup can obtain one;
- a random `state` value verified by the local callback;
- an S256 PKCE challenge, with the verifier kept only in the running helper,
  so an intercepted loopback authorization code cannot be exchanged alone.

The helper prints the refresh token once. Treat terminal history and screenshots
containing it as sensitive.

## 3. Create the folder IDs through the same OAuth app

The `--create-folders` flag creates this hierarchy through the authorized app:

```text
Aleem & Ain Wedding
└── Guest Moments
    ├── Originals
    └── Videos
```

This matters for the narrow `drive.file` scope: arbitrary folders created
outside this OAuth app are not automatically available to it. Normal production
uploads use the printed IDs and never search by folder name.

Save the printed values as Worker secrets/configuration:

```text
GOOGLE_DRIVE_ORIGINALS_FOLDER_ID
GOOGLE_DRIVE_VIDEOS_FOLDER_ID
```

If a pre-existing arbitrary folder must be used instead, it must first be made
available to this OAuth app through an app-mediated selection flow, or the
broader restricted Drive scope would be required. Moments intentionally avoids
that broader permission.

## 4. Store Worker secrets

From `workers/moments-api` after authenticating Wrangler:

```powershell
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
```

Folder IDs are not credentials, but keeping all backend configuration together
is simplest. Add them with `wrangler secret put` as well, or configure them as
non-public Worker variables.

Never configure these values in GitHub Pages build variables.

## 5. Test safely

Confirm the OAuth consent screen says **In production** and that the Worker has
the refresh token issued after that change. Deploy the Worker, configure its
exact allowed origin, then run the optional owner integration script documented
in the Worker README. It uploads one small fixture and should produce:

1. a private file in `Originals`;
2. a pending Supabase metadata record containing the private Drive file ID;
3. no public Drive sharing permission or Drive URL.

Verify the Drive file remains **Restricted**. Moments never creates "Anyone
with the link" permissions. Hiding or rejecting a moment changes metadata only;
it does not delete the original.

## Refresh-token troubleshooting

- Google normally returns a refresh token only when offline access is granted.
- An External app left in Testing issues a seven-day refresh token for this
  Drive scope. Move it to In production and obtain a new owner grant before the
  event; repeatedly rotating a testing token is not a production setup.
- If a previous grant prevents a new token from appearing, revoke the app under
  the Google account's connected-app settings and run the helper again.
- A revoked or expired refresh token causes the Worker to return a sanitized
  upstream-authentication error. Guests never receive Google's raw response.
- Rotate the OAuth client or refresh token by updating Worker secrets; no
  frontend rebuild is required.

Official references:

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Use OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Perform resumable Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
