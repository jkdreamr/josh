// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://joshuakoo.xyz',
  integrations: [react()],
  devToolbar: { enabled: false },
});
