// Latte art entries from src/data/coffee.yaml joined with their photos, newest first.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { photos, type Photo } from './photos';

const schema = z.array(
  z.object({
    photo: z.string(),
    pattern: z.enum(['heart', 'tulip', 'rosetta', 'swan', 'other']),
    note: z.string().optional(),
  }),
);

export interface Pour {
  photo: Photo;
  pattern: string;
  note?: string;
}

export const pours: Pour[] = schema
  .parse(parse(readFileSync('src/data/coffee.yaml', 'utf8')))
  .map((entry) => {
    const photo = photos.find((p) => p.file === entry.photo);
    if (!photo) throw new Error(`coffee.yaml: ${entry.photo} is not in photos.json (run photos:sync)`);
    return { ...entry, photo };
  })
  .sort((a, b) => (b.photo.date ?? '').localeCompare(a.photo.date ?? ''));
