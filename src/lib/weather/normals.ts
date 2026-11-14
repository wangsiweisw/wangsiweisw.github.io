// Monthly climate normals from daily values (for the coffee origin climate cards).
import { getArchive } from './client.ts';

export interface MonthNormal {
  month: number; // 1–12
  tmin: number; // mean daily minimum, °C
  tmax: number; // mean daily maximum, °C
  precip: number; // mean monthly total, mm
}

/** Daily min/max/precipitation → 12 monthly normals. Precipitation is totalled per calendar month, then averaged over the years. */
export function monthlyNormals(daily: { time: string[]; tmax: (number | null)[]; tmin: (number | null)[]; precip: (number | null)[] }): MonthNormal[] {
  const acc = Array.from({ length: 12 }, () => ({ tmin: 0, tmax: 0, n: 0, byYear: new Map<string, number>() }));
  daily.time.forEach((t, i) => {
    const m = acc[Number(t.slice(5, 7)) - 1];
    const [lo, hi, p] = [daily.tmin[i], daily.tmax[i], daily.precip[i]];
    if (lo != null && hi != null) {
      m.tmin += lo;
      m.tmax += hi;
      m.n++;
    }
    if (p != null) m.byYear.set(t.slice(0, 4), (m.byYear.get(t.slice(0, 4)) ?? 0) + p);
  });
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return acc.map((m, i) => {
    const totals = [...m.byYear.values()];
    return {
      month: i + 1,
      tmin: r1(m.n ? m.tmin / m.n : NaN),
      tmax: r1(m.n ? m.tmax / m.n : NaN),
      precip: r1(totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : NaN),
    };
  });
}

/** 1991–2020 normals for a place; pass the farm's altitude so temperatures aren't the grid cell's. */
export async function fetchNormals(lat: number, lon: number, elevation?: number) {
  const r = await getArchive({ lat, lon, elevation, start: '1991-01-01', end: '2020-12-31', daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'] });
  const d = r.daily!;
  return {
    elevation: r.elevation,
    months: monthlyNormals({ time: d.time, tmax: d.temperature_2m_max as number[], tmin: d.temperature_2m_min as number[], precip: d.precipitation_sum as number[] }),
  };
}
