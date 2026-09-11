import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// CI can override with SITE_URL for preview deploys; this is the production home.
const SITE = process.env.SITE_URL ?? 'https://hoursapart.app';

export default defineConfig({
  site: SITE,
  integrations: [
    react(),
    /*
     * Every page's tables are recomputed from the build date, so the content
     * genuinely changes on each deploy. Without lastmod there is no signal to
     * recrawl. Directory pages get the highest priority because they are how
     * crawlers reach the long tail.
     */
    sitemap({
      serialize(item) {
        const path = new URL(item.url).pathname;
        const isDirectory = path === '/time/' || path === '/difference/';
        const isTool = path === '/' || path === '/overlap/';
        return {
          ...item,
          lastmod: new Date().toISOString(),
          changefreq: isTool || isDirectory ? 'daily' : 'weekly',
          priority: isTool ? 1 : isDirectory ? 0.9 : 0.7,
        };
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  build: { format: 'directory' },
});
