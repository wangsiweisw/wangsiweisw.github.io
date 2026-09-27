// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// Resume is unpublished while resume.yaml is sample content (see src/pages/resume.astro).
const resumeLive = parse(readFileSync('./src/data/resume.yaml', 'utf8')).sample !== true;
// Photos page is unlisted until there are photos.
const photosLive = JSON.parse(readFileSync('./src/data/photos.json', 'utf8')).length > 0;

export default defineConfig({
  site: 'https://siweiwang.me',
  // TODO(owner): drop the /blog filter once the first post is published (also flip `live` in src/data/nav.ts).
  integrations: [
    mdx(),
    sitemap({
      filter: (page) =>
        !page.includes('/blog') && (resumeLive || !page.includes('/resume')) && (photosLive || !page.includes('/photos')),
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
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
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
});
