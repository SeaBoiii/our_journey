import assert from "node:assert/strict";
import test from "node:test";

import {
  issueGuestSession,
  openUploadTicket,
  sealUploadTicket,
  verifyGuestSession,
} from "../src/security.ts";
import { testEnv } from "./helpers.ts";

test("guest sessions are signed, expire, and reject tampering", async () => {
  const env = testEnv();
  const issued = await issueGuestSession(env, 1_000);
  assert.equal((await verifyGuestSession(issued.token, env, 1_001)).sid, issued.payload.sid);
  await assert.rejects(() => verifyGuestSession(`${issued.token}x`, env, 1_001));
  await assert.rejects(() => verifyGuestSession(issued.token, env, issued.payload.exp));
});

test("AES-GCM upload ticket hides Drive state and binds guest/session", async () => {
  const env = testEnv();
  const guest = (await issueGuestSession(env, 1_000)).payload;
  const token = await sealUploadTicket(
    {
      v: 1,
      sessionId: "session-1",
      submissionId: crypto.randomUUID(),
      momentId: crypto.randomUUID(),
      guestSessionId: guest.sid,
      guestName: "Guest",
      caption: "A note",
      clientFileId: "client-1",
      fileName: "photo.jpg",
      fileSize: 1234,
      mimeType: "image/jpeg",
      mediaType: "photo",
      driveFileId: "drive-id",
      driveUploadUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=secret",
      createdAt: "2026-08-14T00:00:00.000Z",
      chunkSize: 8 * 1024 * 1024,
      exp: 2_000,
    },
    env,
    1_000,
  );
  assert.doesNotMatch(token, /google|drive-id|Guest|secret/);
  const opened = await openUploadTicket(token, env, guest, "session-1", 1_001);
  assert.equal(opened.driveFileId, "drive-id");
  await assert.rejects(() => openUploadTicket(token, env, guest, "another-session", 1_001));
  await assert.rejects(() => openUploadTicket(`${token}x`, env, guest, "session-1", 1_001));
});
