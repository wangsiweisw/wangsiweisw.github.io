// Albums from src/data/albums.yaml joined with photos.json: order, titles, covers, counts, date ranges.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { photos, type Photo } from './photos';

const schema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    cover: z.string().optional(),
    // optional explicit photo order (paths in photos-src/); unlisted photos follow, newest first
    order: z.array(z.string()).optional(),
  }),
);

export interface Album {
  id: string;
  title: string;
  subtitle?: string;
  cover: Photo;
  photos: Photo[];
  when: string;
}

const MONTH = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** "Nov 2023", "Apr – Jun 2024", "Dec 2023 – Jan 2024" */
function dateRange(list: Photo[]): string {
  const dates = list.flatMap((p) => (p.date ? [new Date(p.date)] : [])).sort((a, b) => +a - +b);
  if (!dates.length) return '';
  const [first, last] = [dates[0], dates.at(-1)!];
  const y1 = first.getUTCFullYear();
  const y2 = last.getUTCFullYear();
  if (y1 !== y2) return `${MONTH(first)} ${y1} – ${MONTH(last)} ${y2}`;
  if (first.getUTCMonth() !== last.getUTCMonth()) return `${MONTH(first)} – ${MONTH(last)} ${y2}`;
  return `${MONTH(first)} ${y1}`;
}

const config = schema.parse(parse(readFileSync('src/data/albums.yaml', 'utf8')));

export const albums: Album[] = config.flatMap((a) => {
  const rank = (p: Photo) => {
    const i = a.order?.indexOf(p.file) ?? -1;
    return i === -1 ? Infinity : i;
  };
  const list = photos.filter((p) => p.album === a.id).sort((x, y) => rank(x) - rank(y));
  if (!list.length) return [];
  const cover = list.find((p) => p.file === a.cover) ?? list.find((p) => p.featured) ?? list[0];
  return [{ ...a, cover, photos: list, when: dateRange(list) }];
});

/** Photos that belong to an album shown in the gallery (coffee and unlisted albums excluded). */
export const galleryPhotos = albums.flatMap((a) => a.photos);
