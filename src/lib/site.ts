// Loads and validates src/data/site.yaml at build time.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';

const schema = z.object({
  name: z.string(),
  nameZh: z.string().optional(),
  positioning: z.string(),
  positioningEmphasis: z.string().optional(),
  bio: z.string(),
  description: z.string(),
  links: z.object({
    linkedin: z.url(),
    email: z.email().nullable(),
  }),
  showEmployerOnHome: z.boolean(),
  weather: z.object({
    city: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    caption: z.string(),
  }),
});

export type Site = z.infer<typeof schema>;

export const site: Site = schema.parse(parse(readFileSync('src/data/site.yaml', 'utf8')));
