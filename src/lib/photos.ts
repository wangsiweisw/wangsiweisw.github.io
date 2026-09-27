// Loads and validates src/data/photos.json (written by scripts/photos-sync.ts).
import { readFileSync } from 'node:fs';
import { z } from 'astro/zod';

const variant = z.object({ width: z.number(), url: z.string() });

const photo = z.object({
  id: z.string(),
  file: z.string(),
  width: z.number(),
  height: z.number(),
  alt: z.string().nullable(),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  album: z.string(),
  location: z.string().nullable(),
  featured: z.boolean(),
  date: z.string().nullable(),
  coords: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  exif: z.object({
    camera: z.string().optional(),
    lens: z.string().optional(),
    focalLength: z.string().optional(),
    aperture: z.string().optional(),
    shutter: z.string().optional(),
    iso: z.number().optional(),
  }),
  placeholder: z.string(),
  avif: z.array(variant).min(1),
  webp: z.array(variant).min(1),
});

export type Photo = z.infer<typeof photo>;

export const photos: Photo[] = z.array(photo).parse(JSON.parse(readFileSync('src/data/photos.json', 'utf8')));

// Guards so production never ships broken or inaccessible images.
if (import.meta.env.PROD && process.env.CI) {
  const local = photos.filter((p) => p.webp.some((v) => v.url.startsWith('/photos-local/')));
  if (local.length) throw new Error(`photos.json has local-only URLs (${local.map((p) => p.file).join(', ')}). Re-run photos:sync with R2 configured.`);
}
if (import.meta.env.PROD) {
  const noAlt = photos.filter((p) => !p.alt);
  if (noAlt.length) throw new Error(`Photos missing alt text in photos-src/meta.yaml: ${noAlt.map((p) => p.file).join(', ')}`);
}

export const srcset = (variants: { width: number; url: string }[]) => variants.map((v) => `${v.url} ${v.width}w`).join(', ');

