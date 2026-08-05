// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/** @type {Record<string, string | undefined>} */
const runtimeEnv = Reflect.get(globalThis, 'process')?.env ?? {};
const site = runtimeEnv.PAGES_SITE || undefined;
const base = runtimeEnv.PAGES_BASE || '/';

// https://astro.build/config
export default defineConfig({
  site,
  base,

  integrations: [react()],

  devToolbar: {
    enabled: false
  },

  vite: {
    plugins: [tailwindcss()]
  }
});
