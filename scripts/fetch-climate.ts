// pnpm climate — 1991–2020 monthly climate normals for each bean origin in src/data/beans.yaml, cached as
// src/data/climate/<origin id>.json. Fetches only missing files; the site build itself never calls the network.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { fetchNormals } from '../src/lib/weather/normals.ts';
import { getArchive } from '../src/lib/weather/client.ts';

const DIR = 'src/data/climate';
await mkdir(DIR, { recursive: true });
const beans: { origins?: { id: string; place: string; lat: number; lon: number; altitude?: number }[] }[] = parse(readFileSync('src/data/beans.yaml', 'utf8'));
const origins = new Map(beans.flatMap((b) => b.origins ?? []).map((o) => [o.id, o]));
// last 12 complete months that the archive already covers (it lags real time by about a week)
const now = new Date();
const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() < 10 ? 2 : 1), 1));
const startMonth = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 11, 1));
const lastDay = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const refresh = process.argv.includes('--recent');

for (const o of origins.values()) {
  const file = `${DIR}/${o.id}.json`;
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (existing?.recent && !(refresh && existing.recent.to !== iso(lastDay).slice(0, 7))) continue;
  const n = existing ?? (await fetchNormals(o.lat, o.lon, o.altitude));
  // what the weather actually was, month by month (shown on its own: no comparison, no outlook)
  const r = await getArchive({ lat: o.lat, lon: o.lon, elevation: o.altitude, start: iso(startMonth), end: iso(lastDay), daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'] });
  const d = r.daily!;
  const byMonth = Map.groupBy(d.time.map((t, i) => ({ t, i })), ({ t }) => t.slice(0, 7));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recent = {
    from: iso(startMonth).slice(0, 7),
    to: iso(lastDay).slice(0, 7),
    months: [...byMonth].map(([ym, days]) => ({
      ym,
      tmin: r1(mean(days.map(({ i }) => d.temperature_2m_min[i] as number))),
      tmax: r1(mean(days.map(({ i }) => d.temperature_2m_max[i] as number))),
      precip: r1(days.reduce((a, { i }) => a + ((d.precipitation_sum[i] as number) ?? 0), 0)),
    })),
  };
  await writeFile(
    file,
    JSON.stringify(
      {
        place: o.place,
        latitude: o.lat,
        longitude: o.lon,
        elevation: n.elevation,
        period: '1991–2020',
        source: 'Open-Meteo Historical Weather API (ERA5), CC BY 4.0',
        fetched: iso(now),
        months: n.months,
        recent,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${file}: normals ${Math.round(n.months.reduce((a: number, m: { precip: number }) => a + m.precip, 0))} mm/yr; ${recent.from} to ${recent.to}: ${Math.round(recent.months.reduce((a, m) => a + m.precip, 0))} mm`);
}
