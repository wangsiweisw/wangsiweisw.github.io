// running:stats — summarise a Strava bulk export into src/data/running.json (aggregates only).
//
//   pnpm running:stats            reads strava-export/*/activities.csv (gitignored)
//
// Only totals leave the export: no activity names, dates, routes, GPS, heart rate or times of day.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXPORT_DIR = 'strava-export';
const OUT = 'src/data/running.json';

/** Minimal RFC 4180 CSV parser (quoted fields may contain commas and newlines). */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

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
