export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
  GOOGLE_DRIVE_ORIGINALS_FOLDER_ID: string;
  GOOGLE_DRIVE_VIDEOS_FOLDER_ID: string;
  MOMENTS_SESSION_SECRET: string;
  MOMENTS_ALLOWED_ORIGINS: string;
  MOMENTS_ALLOW_VIDEOS?: string;
  MOMENTS_REQUIRE_MODERATION?: string;
  MOMENTS_DERIVATIVES_BUCKET?: string;
  MOMENTS_SIGNED_URL_TTL_SECONDS?: string;
  ENTRY_IP_RATE_LIMITER?: RateLimitBinding;
  UPLOAD_SESSION_RATE_LIMITER?: RateLimitBinding;
  UPLOAD_IP_RATE_LIMITER?: RateLimitBinding;
  GALLERY_IP_RATE_LIMITER?: RateLimitBinding;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export type MediaType = "photo" | "video";
export type MomentStatus = "pending" | "approved" | "rejected" | "hidden";

export interface GuestSessionPayload {
  v: 1;
  sid: string;
  iat: number;
  exp: number;
}

export interface DerivativeTicketData {
  path: string;
  width: number;
  height: number;
  size: number;
  mimeType: "image/webp";
}

export interface UploadTicketPayload {
  v: 1;
  sessionId: string;
  submissionId: string;
  momentId: string;
  guestSessionId: string;
  guestName: string;
  caption: string;
  clientFileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mediaType: MediaType;
  driveFileId: string;
  driveUploadUri: string;
  createdAt: string;
  chunkSize: number;
  exp: number;
  derivatives?: {
    gallery: DerivativeTicketData;
    thumbnail: DerivativeTicketData;
  };
}

export interface InitFileInput {
  clientFileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mediaType?: MediaType;
}

export interface UploadInitInput {
  guestName: string;
  caption?: string;
  files: InitFileInput[];
}

export interface SupabaseMomentRow {
  id: string;
  guest_name: string;
  caption: string;
  created_at: string;
  updated_at?: string;
  media_type: MediaType;
  mime_type: string;
  file_name: string;
  file_size: number;
  width: number | null;
  height: number | null;
  gallery_path: string | null;
  thumbnail_path: string | null;
  status: MomentStatus;
  processing_status: "pending" | "ready" | "failed";
  moderated_at?: string | null;
  moderated_by?: string | null;
}

export interface SupabasePrivilegedMomentRow extends SupabaseMomentRow {
  submission_id: string;
  guest_session_id: string;
  drive_file_id: string;
  original_width: number | null;
  original_height: number | null;
}

export interface SupabaseMomentInsert {
  id: string;
  submission_id: string;
  guest_session_id: string;
  guest_name: string;
  caption: string;
  created_at: string;
  media_type: MediaType;
  mime_type: string;
  file_name: string;
  file_size: number;
  width: number | null;
  height: number | null;
  original_width: number | null;
  original_height: number | null;
  drive_file_id: string;
  gallery_path: string | null;
  thumbnail_path: string | null;
  status: "pending" | "approved";
  processing_status: "pending" | "ready";
}

export type Fetcher = typeof fetch;
