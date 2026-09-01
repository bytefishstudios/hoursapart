import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// CI can override with SITE_URL for preview deploys; this is the production home.
const SITE = process.env.SITE_URL ?? 'https://hoursapart.app';

export default defineConfig({
  site: SITE,
  integrations: [react(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  build: { format: 'directory' },
});
