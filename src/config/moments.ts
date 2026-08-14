export const BYTES_PER_MEGABYTE = 1024 * 1024;

export type WeddingMode = "pre-wedding" | "live" | "post-wedding";
export type MomentsBackendProvider = "mock" | "supabase" | "google-drive";

export interface MomentsConfig {
  readonly enabled: boolean;
  readonly backendProvider: MomentsBackendProvider;
  readonly allowVideos: boolean;
  readonly maxPhotoSize: number;
  readonly maxVideoSize: number;
  readonly maxFilesPerUpload: number;
  readonly requireModeration: boolean;
  readonly weddingMode: WeddingMode;
}

export const MOMENTS_CONFIG = {
  enabled: true,
  backendProvider: "mock",
  allowVideos: true,
  maxPhotoSize: 20 * BYTES_PER_MEGABYTE,
  maxVideoSize: 150 * BYTES_PER_MEGABYTE,
  maxFilesPerUpload: 10,
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
    ? [
        ...ACCEPTED_VIDEO_MIME_TYPES,
        ".mp4",
        ".mov",
      ]
    : []),
].join(",");
