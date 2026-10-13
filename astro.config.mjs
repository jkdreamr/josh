// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { fileURLToPath } from 'node:url';
import keepOldAssets from './scripts/keep-old-assets.ts';

const site = 'https://joshuakoo.xyz';
// Production builds on Vercel keep older files from the live site. VERCEL_ENV is missing when a project hides
// system variables from builds, so a Vercel build without it counts as production too.
const vercelProduction = process.env.VERCEL_ENV === 'production' || (!!process.env.VERCEL && !process.env.VERCEL_ENV);

export default defineConfig({
  site,
  // Production deploys keep a week of older files so pages opened before a deploy keep working.
  integrations: [react(), keepOldAssets({ from: vercelProduction ? site : process.env.KEEP_ASSETS_FROM })],
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
