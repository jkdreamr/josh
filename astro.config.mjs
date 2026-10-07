// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://joshuakoo.xyz',
  integrations: [react()],
  adapter: vercel(),
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      alias: {
        'node-fetch': fileURLToPath(new URL('./src/os/games/katago/node-fetch-stub.ts', import.meta.url)),
      },
    },
    worker: { format: 'es' },
  },
});
