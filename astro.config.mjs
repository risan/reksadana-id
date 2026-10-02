import { rename, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'astro/config';

// Astro only writes the root 404 page as 404.html. Cloudflare serves the nearest 404.html up the path, so /en/ needs its own.
const englishNotFoundPage = {
  name: 'english-not-found-page',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const englishDirectory = fileURLToPath(new URL('en/', dir));

      await rename(`${englishDirectory}404/index.html`, `${englishDirectory}404.html`);
      await rmdir(`${englishDirectory}404`);
    },
  },
};

export default defineConfig({
  site: 'https://reksadana.risanb.com',
  output: 'static',
  build: { concurrency: 1 },
  integrations: [englishNotFoundPage],
  i18n: {
    defaultLocale: 'id',
    locales: ['id', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        // The locale is set per page at build time (src/middleware.js) and from <html lang> in the browser.
        strategy: ['globalVariable', 'baseLocale'],
      }),
    ],
  },
});
