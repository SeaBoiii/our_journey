export const BYTES_PER_MEGABYTE = 1024 * 1024;

export type WeddingMode = "pre-wedding" | "live" | "post-wedding";
export type MomentsBackendProvider = "mock" | "remote";

export interface MomentsConfig {
  readonly enabled: boolean;
  readonly backendProvider: MomentsBackendProvider;
  readonly apiUrl: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly allowVideos: boolean;
  readonly maxPhotoSize: number;
  readonly maxVideoSize: number;
  readonly maxFilesPerUpload: number;
  readonly guestNameMaxLength: number;
  readonly captionMaxLength: number;
  readonly requireModeration: boolean;
  readonly weddingMode: WeddingMode;
}

function normaliseApiUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLocaleLowerCase() === "true";
}

// Native Node test imports do not define Vite's `import.meta.env` object.
const publicEnv: Partial<ImportMetaEnv> = import.meta.env ?? {};
const configuredApiUrl = normaliseApiUrl(publicEnv.PUBLIC_MOMENTS_API_URL);
const configuredProvider =
  publicEnv.PUBLIC_MOMENTS_BACKEND_PROVIDER?.trim().toLocaleLowerCase();
const backendProvider: MomentsBackendProvider =
  configuredProvider === "remote" ? "remote" : "mock";

export const MOMENTS_CONFIG = {
  enabled: true,
  backendProvider,
  apiUrl: configuredApiUrl,
  supabaseUrl: normaliseApiUrl(publicEnv.PUBLIC_SUPABASE_URL),
  supabaseAnonKey: publicEnv.PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  // Mock mode retains the Phase 1 video preview. The production API starts
  // photo-first until its large-file resumable path is explicitly enabled.
  allowVideos:
    backendProvider === "mock" ||
    isEnabled(publicEnv.PUBLIC_MOMENTS_ALLOW_VIDEOS),
  maxPhotoSize: 20 * BYTES_PER_MEGABYTE,
  maxVideoSize: 150 * BYTES_PER_MEGABYTE,
  maxFilesPerUpload: 10,
  guestNameMaxLength: 80,
  captionMaxLength: 500,
  requireModeration: true,
  weddingMode: "pre-wedding",
} as const satisfies MomentsConfig;

export const ACCEPTED_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
] as const;

export const ACCEPTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
] as const;

export type AcceptedPhotoMimeType =
  (typeof ACCEPTED_PHOTO_MIME_TYPES)[number];
export type AcceptedVideoMimeType =
  (typeof ACCEPTED_VIDEO_MIME_TYPES)[number];

/**
 * Extensions are included because mobile browsers may omit HEIC/HEIF or MOV
 * MIME types when files are chosen from a device library.
 */
export const MOMENTS_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_PHOTO_MIME_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ...(MOMENTS_CONFIG.allowVideos
    ? [...ACCEPTED_VIDEO_MIME_TYPES, ".mp4", ".mov"]
    : []),
].join(",");
