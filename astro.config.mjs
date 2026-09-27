// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// TODO(owner): switch to https://siweiwang.me once DNS is live (and add public/CNAME).
export default defineConfig({
  site: 'https://wangsiweisw.github.io',
  // Fonts are downloaded at build time and self-hosted; no requests to Google at runtime.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Fraunces',
      cssVariable: '--font-display',
      weights: ['300 600'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Instrument Sans',
      cssVariable: '--font-body',
      weights: ['400 600'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
});
