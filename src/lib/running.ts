// Running page data: Strava-derived totals (running.json) plus hand-kept facts (running.yaml).
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { photos } from './photos';

const totals = z
  .object({
    since: z.string().regex(/^\d{4}-\d{2}$/),
    through: z.string().regex(/^\d{4}-\d{2}$/),
    runs: z.number(),
    meters: z.number(),
    movingHours: z.number(),
    longestMeters: z.number(),
    fastest5kSeconds: z.number().nullable(),
    fastest10kSeconds: z.number().nullable(),
    years: z.array(z.object({ year: z.number(), runs: z.number(), meters: z.number() })),
  })
  .parse(JSON.parse(readFileSync('src/data/running.json', 'utf8')));

const facts = z
  .object({
    halfMarathons: z.number(),
    halfPB: z.string(),
    bestEfforts: z.object({ fiveK: z.string().optional(), tenK: z.string().optional() }).default({}),
    milestones: z
      .array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), title: z.string(), time: z.string().optional() }))
      .default([]),
  })
  .parse(parse(readFileSync('src/data/running.yaml', 'utf8')));

export const running = { ...totals, ...facts };

export const METERS_PER_MILE = 1609.344;

/** 1382 → "23:02", 5867 → "1:37:47" */
export function duration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Running photos, in the order they should appear. */
export const runningPhotos = ['running/IMG_7646.JPG', 'running/IMG_7456.HEIC'].flatMap((file) => {
  const p = photos.find((x) => x.file === file);
  return p ? [p] : [];
});
