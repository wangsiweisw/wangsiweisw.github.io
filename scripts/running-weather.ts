// running:weather — how weather at the start of each outdoor run relates to pace and heart rate.
//
//   pnpm running:weather          reads strava-export/*/activities/*.fit.gz (gitignored)
//
// Start position and time are read from each FIT file only to look up the hourly weather (Open-Meteo
// historical archive, ERA5). Treadmill runs (no GPS) are skipped. Only per-bin medians are written to
// src/data/running-weather.json: no dates, places, or individual runs.
import { existsSync, readFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Decoder, Stream } from '@garmin/fitsdk';
import { parseCSV } from './lib/csv.ts';

const EXPORT_DIR = 'strava-export';
const OUT = 'src/data/running-weather.json';
const SEMI = 180 / 2 ** 31;

const exports = existsSync(EXPORT_DIR) ? (await readdir(EXPORT_DIR)).filter((d) => existsSync(join(EXPORT_DIR, d, 'activities'))).sort() : [];
if (!exports.length) throw new Error(`No ${EXPORT_DIR}/<export>/activities/ found.`);
const dir = join(EXPORT_DIR, exports.at(-1)!);
const [header, ...rows] = parseCSV(readFileSync(join(dir, 'activities.csv'), 'utf8'));
const col = (name: string) => header.indexOf(name);
// Runs with a FIT file; heart rate comes from the CSV (not every watch writes it into the file)
const runFiles = rows
  .filter((r) => /run/i.test(r[col('Activity Type')] ?? '') && r[col('Filename')]?.endsWith('.fit.gz'))
  .map((r) => ({ file: r[col('Filename')], hr: parseFloat(r[col('Average Heart Rate')]) || null }));

interface Run {
  start: Date;
  lat: number;
  lon: number;
  meters: number;
  seconds: number;
  hr: number | null;
  tempC?: number;
  dewC?: number;
}

const runs: Run[] = [];
for (const { file, hr } of runFiles) {
  const { messages } = new Decoder(Stream.fromBuffer(gunzipSync(readFileSync(join(dir, file))))).read();
  const rec = messages.recordMesgs?.find((r) => r.positionLat != null && r.positionLong != null);
  const s = messages.sessionMesgs?.[0];
  if (!rec?.positionLat || !rec.positionLong || !s?.startTime || !s.totalDistance || !s.totalTimerTime) continue; // treadmill or broken file
  runs.push({
    start: new Date(s.startTime as Date),
    lat: rec.positionLat * SEMI,
    lon: rec.positionLong * SEMI,
    meters: s.totalDistance,
    seconds: s.totalTimerTime,
    hr,
  });
}
// Real runs only: at least 3 km, faster than 7:30/km (no walks)
const outdoor = runs.filter((r) => r.meters >= 3000 && r.seconds / (r.meters / 1000) < 450);

// One archive request per ~10 km cell, covering that cell's date range.
const day = (d: Date) => d.toISOString().slice(0, 10);
const cells = Map.groupBy(outdoor, (r) => `${r.lat.toFixed(1)},${r.lon.toFixed(1)}`);
for (const [key, list] of cells) {
  const [lat, lon] = key.split(',');
  const times = list.map((r) => +r.start);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${day(new Date(Math.min(...times)))}&end_date=${day(new Date(Math.max(...times)))}` +
    `&hourly=temperature_2m,dew_point_2m&timezone=GMT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for cell ${key}`);
  const { hourly } = (await res.json()) as { hourly: { time: string[]; temperature_2m: number[]; dew_point_2m: number[] } };
  const index = new Map(hourly.time.map((t, i) => [t, i]));
  for (const r of list) {
    // nearest hour to the middle of the run
    const mid = new Date(+r.start + (r.seconds * 1000) / 2);
    mid.setUTCMinutes(mid.getUTCMinutes() + 30, 0, 0);
    const i = index.get(mid.toISOString().slice(0, 13) + ':00');
    if (i === undefined) continue;
    r.tempC = hourly.temperature_2m[i];
    r.dewC = hourly.dew_point_2m[i];
  }
}

const withWeather = outdoor.filter((r) => r.tempC != null && r.dewC != null);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const toF = (c: number) => (c * 9) / 5 + 32;

/** Bins in °F (stored as °C edges too, so the page can label either unit). */
const bin = (edgesF: number[], value: (r: Run) => number) =>
  edgesF.slice(0, -1).map((lo, i) => {
    const hi = edgesF[i + 1];
    const list = withWeather.filter((r) => toF(value(r)) >= lo && toF(value(r)) < hi);
    const hrs = list.flatMap((r) => (r.hr ? [r.hr] : []));
    return {
      loF: Number.isFinite(lo) ? lo : null,
      hiF: Number.isFinite(hi) ? hi : null,
      runs: list.length,
      paceSecPerKm: list.length ? Math.round(median(list.map((r) => r.seconds / (r.meters / 1000)))!) : null,
      heartRate: hrs.length ? Math.round(median(hrs)!) : null,
    };
  });

const summary = {
  runs: withWeather.length,
  temperature: bin([-Infinity, 45, 55, 65, 75, Infinity], (r) => r.tempC!),
  dewPoint: bin([-Infinity, 40, 50, 60, 65, Infinity], (r) => r.dewC!),
};
await writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(`${runs.length} GPS runs, ${outdoor.length} kept, ${withWeather.length} with weather → ${OUT}`);
console.log(JSON.stringify(summary, null, 1));
