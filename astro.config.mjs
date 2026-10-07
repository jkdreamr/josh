// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://joshuakoo.xyz',
  integrations: [react()],
  adapter: vercel(),
  devToolbar: { enabled: false },
  vite: { worker: { format: 'es' } },
});
