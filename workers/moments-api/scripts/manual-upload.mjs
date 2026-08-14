import { open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const [apiArgument, fileArgument, originArgument = "http://localhost:4321"] = process.argv.slice(2);
if (!apiArgument || !fileArgument) {
  console.error("Usage: node scripts/manual-upload.mjs <api-url> <photo-path> [allowed-origin]");
  process.exitCode = 1;
} else {
  const api = apiArgument.replace(/\/+$/, "");
  const filePath = resolve(fileArgument);
  const info = await stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const mimeTypes = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
    [".heic", "image/heic"],
    [".heif", "image/heif"],
  ]);
  const mimeType = mimeTypes.get(extension);
  if (!mimeType) throw new Error("The manual test accepts JPEG, PNG, WebP, HEIC, or HEIF photos only.");

  const request = async (path, init = {}) => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: { origin: originArgument, ...init.headers },
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    return response;
  };

  console.warn("This manual test creates a real private Drive original and a pending Supabase row.");
  const sessionResponse = await request("/v1/sessions/anonymous", { method: "POST" });
  const { data: sessionData } = await sessionResponse.json();
  const guestToken = sessionData.sessionToken;
  const clientFileId = crypto.randomUUID();
  const initResponse = await request("/v1/uploads/init", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guest-session": guestToken,
    },
    body: JSON.stringify({
      guestName: "Owner integration test",
      caption: `Manual API verification ${new Date().toISOString()}`,
      files: [
        {
          clientFileId,
          fileName: basename(filePath),
          fileSize: info.size,
          mimeType,
          mediaType: "photo",
        },
      ],
    }),
  });
  const { data: initData } = await initResponse.json();
  const upload = initData.files[0];
  let uploadToken = upload.uploadToken;
  let offset = upload.nextOffset;
  let index = 0;
  const handle = await open(filePath, "r");
  try {
    while (offset < info.size) {
      const length = Math.min(upload.chunkSize, info.size - offset);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, offset);
      if (bytesRead !== length) throw new Error("The selected file changed while it was being read.");
      const chunkResponse = await request(`/v1/uploads/${upload.sessionId}/chunks/${index}`, {
        method: "PUT",
        headers: {
          "content-type": mimeType,
          "content-range": `bytes ${offset}-${offset + length - 1}/${info.size}`,
          "x-guest-session": guestToken,
          "x-moments-upload-token": uploadToken,
        },
        body: bytes,
      });
      const { data } = await chunkResponse.json();
      offset = data.nextOffset;
      index += 1;
      console.log(`Uploaded ${offset}/${info.size} bytes`);
    }
  } finally {
    await handle.close();
  }

  const completeResponse = await request(`/v1/uploads/${upload.sessionId}/complete`, {
    method: "POST",
    headers: {
      "x-guest-session": guestToken,
      "x-moments-upload-token": uploadToken,
    },
  });
  const { data } = await completeResponse.json();
  console.log(JSON.stringify(data, null, 2));
  console.warn("No derivative was uploaded, so the row remains processing=pending until the media processor runs.");
}
