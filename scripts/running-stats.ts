// running:stats — summarise a Strava bulk export into src/data/running.json (aggregates only).
//
//   pnpm running:stats            reads strava-export/*/activities.csv (gitignored), plus runs since that export in
//                                 strava-export/recent.json (pulled through the Strava connector), if present
//
// Only totals leave the export: no activity names, dates, routes, GPS, heart rate or times of day.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCSV } from './lib/csv.ts';

const EXPORT_DIR = 'strava-export';
const OUT = 'src/data/running.json';

// Newest export folder wins.
const exports = existsSync(EXPORT_DIR) ? (await readdir(EXPORT_DIR)).filter((d) => existsSync(join(EXPORT_DIR, d, 'activities.csv'))).sort() : [];
if (!exports.length) throw new Error(`No ${EXPORT_DIR}/<export>/activities.csv found.`);
const csv = join(EXPORT_DIR, exports.at(-1)!, 'activities.csv');

const [header, ...rows] = parseCSV(await readFile(csv, 'utf8'));
const nth = (name: string, n = 0) => header.flatMap((h, i) => (h === name ? [i] : []))[n];
const iDate = nth('Activity Date');
const iType = nth('Activity Type');
const iMeters = nth('Distance', 1); // the second "Distance" column is in meters
const iMoving = nth('Moving Time');

const runs = rows
  .filter((r) => /run/i.test(r[iType] ?? ''))
  .map((r) => ({ date: new Date(`${r[iDate]} UTC`), meters: parseFloat(r[iMeters]) || 0, moving: parseFloat(r[iMoving]) || 0 }))
  .filter((r) => r.meters > 0 && !isNaN(+r.date));

// Newer runs from the Strava connector ({start_local, sport_type, distance, moving_time}). A run already in the
// export (same distance within 1%, start within a day: local vs UTC clocks) is skipped.
const RECENT = join(EXPORT_DIR, 'recent.json');
if (existsSync(RECENT)) {
  const recent: { start_local: string; sport_type: string; distance: number; moving_time: number }[] = JSON.parse(await readFile(RECENT, 'utf8'));
  let added = 0;
  for (const a of recent) {
    if (!/run/i.test(a.sport_type) || !(a.distance > 0)) continue;
    const date = new Date(`${a.start_local}Z`);
    const dup = runs.some((r) => Math.abs(+r.date - +date) < 864e5 && Math.abs(r.meters - a.distance) <= a.distance * 0.01);
    if (!dup) (runs.push({ date, meters: a.distance, moving: a.moving_time }), added++);
  }
  console.log(`${RECENT}: ${added} newer runs added`);
}

const byYear = new Map<number, { runs: number; meters: number }>();
for (const r of runs) {
  const y = r.date.getUTCFullYear();
  const e = byYear.get(y) ?? { runs: 0, meters: 0 };
  e.runs++;
  e.meters += r.meters;
  byYear.set(y, e);
}

const first = runs.reduce((a, r) => (r.date < a ? r.date : a), runs[0].date);
const last = runs.reduce((a, r) => (r.date > a ? r.date : a), runs[0].date);

/** Fastest whole run (moving time) whose distance is close to the target, e.g. a 5.05 km run for "5K". */
const fastest = (minM: number, maxM: number) => {
  const times = runs.filter((r) => r.meters >= minM && r.meters <= maxM && r.moving > 0).map((r) => r.moving);
  return times.length ? Math.round(Math.min(...times)) : null;
};

const summary = {
  // month precision only
  since: first.toISOString().slice(0, 7),
  through: last.toISOString().slice(0, 7),
  runs: runs.length,
  meters: Math.round(runs.reduce((a, r) => a + r.meters, 0)),
  movingHours: Math.round(runs.reduce((a, r) => a + r.moving, 0) / 3600),
  longestMeters: Math.round(Math.max(...runs.map((r) => r.meters))),
  fastest5kSeconds: fastest(4950, 5300),
  fastest10kSeconds: fastest(9950, 10600),
  years: [...byYear.entries()].sort(([a], [b]) => a - b).map(([year, v]) => ({ year, runs: v.runs, meters: Math.round(v.meters) })),
};

await writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(`${OUT}: ${summary.runs} runs, ${(summary.meters / 1609.344).toFixed(0)} mi since ${summary.since} (from ${csv}).`);
