// Beans from src/data/beans.yaml joined with each origin's cached climate normals (src/data/climate/, `pnpm climate`).
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import type { MonthNormal } from './weather/normals';

const origin = z.object({
  id: z.string(),
  label: z.string(),
  place: z.string(),
  note: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  precision: z.enum(['farm', 'region', 'country', 'area']),
  spread: z.number().optional(),
  process: z.string().optional(),
  altitude: z.number().optional(),
});
const bean = z.object({
  id: z.string(),
  name: z.string(),
  roaster: z.string().nullable(),
  roasterNote: z.string().optional(),
  roastedIn: z.object({ name: z.string(), lat: z.number(), lon: z.number() }),
  roastDate: z.coerce.date().optional(),
  flavors: z.array(z.string()),
  take: z.string(),
  source: z.url().optional(),
  origins: z.array(origin).default([]),
  originsText: z.string().optional(),
});

export interface Climate {
  elevation: number;
  period: string;
  months: MonthNormal[];
  /** the last 12 complete months as they were (shown on their own, never as a comparison) */
  recent?: { from: string; to: string; months: { ym: string; tmin: number; tmax: number; precip: number }[] };
}
export interface OriginNote {
  climate: string;
  cup: string;
}
export type Origin = z.infer<typeof origin> & { climate: Climate | null; about: OriginNote | null };
export type Bean = Omit<z.infer<typeof bean>, 'origins'> & { origins: Origin[] };

const climateOf = (id: string): Climate | null => {
  const file = `src/data/climate/${id}.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

const notes: Record<string, OriginNote> = parse(readFileSync('src/data/origin-notes.yaml', 'utf8'), { merge: true }) ?? {};

export const beans: Bean[] = z
  .array(bean)
  .parse(parse(readFileSync('src/data/beans.yaml', 'utf8')))
  // a bean without a named roaster isn't ready to publish
  .filter((b) => b.roaster || !import.meta.env.PROD)
  .map((b) => ({ ...b, origins: b.origins.map((o) => ({ ...o, climate: climateOf(o.id), about: notes[o.id] ?? null })) }));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Facts only: annual rain, wettest and driest month, typical day-to-night range. */
export function climateFacts(c: Climate) {
  const by = [...c.months].sort((a, b) => a.precip - b.precip);
  return {
    annualMm: Math.round(c.months.reduce((a, m) => a + m.precip, 0)),
    wettest: MONTHS[by.at(-1)!.month - 1],
    driest: MONTHS[by[0].month - 1],
    tmin: Math.min(...c.months.map((m) => m.tmin)),
    tmax: Math.max(...c.months.map((m) => m.tmax)),
    dayNight: Math.round((c.months.reduce((a, m) => a + (m.tmax - m.tmin), 0) / 12) * 10) / 10,
  };
}
