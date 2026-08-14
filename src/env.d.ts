/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_JOURNEY_URL?: string;
  readonly PUBLIC_MOMENTS_BACKEND_PROVIDER?: "mock" | "remote";
  readonly PUBLIC_MOMENTS_API_URL?: string;
  readonly PUBLIC_MOMENTS_ALLOW_VIDEOS?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
