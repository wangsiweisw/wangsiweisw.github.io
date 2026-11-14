// "Typical conditions" for a race day: the same week in each of the last N years, at race hours.
import { getArchive, type WeatherResponse } from './client.ts';

export interface Spread {
  p10: number;
  p50: number;
  p90: number;
}
export interface RaceClimatology {
  days: number; // race-hour days sampled
  years: [number, number];
  temperature: Spread; // °C, mean over the race hours of each day
  dewPoint: Spread; // °C
  wind: Spread; // km/h
  rainShare: number; // share of days with measurable rain (≥ RAIN_MM) during race hours, 0–1
}

/** rain during the race hours that counts as a wet day, mm */
export const RAIN_MM = 0.2;
const DAY = 86_400_000;

/** Linear-interpolated percentile (p in 0–1) of unsorted values. */
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
export const spread = (values: number[]): Spread => ({ p10: percentile(values, 0.1), p50: percentile(values, 0.5), p90: percentile(values, 0.9) });

/** The ±`pad`-day window around month-day in a year, as YYYY-MM-DD. Feb 29 falls back to Feb 28 in other years. */
export function windowFor(year: number, monthDay: string, pad = 3): { start: string; end: string } {
  let [m, d] = monthDay.split('-').map(Number);
  if (m === 2 && d === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) d = 28;
  const mid = Date.UTC(year, m - 1, d);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { start: iso(mid - pad * DAY), end: iso(mid + pad * DAY) };
}

export interface DaySample {
  temperature: number;
  dewPoint: number;
  wind: number;
  rain: number;
}

/** Per-day means over the race hours (local time; a race that runs past midnight is cut at midnight). */
export function raceHourDays(hourly: NonNullable<WeatherResponse['hourly']>, startHour: number, durationHours: number): DaySample[] {
  const endHour = Math.min(23, Math.ceil(startHour + durationHours));
  const byDay = new Map<string, number[]>();
  hourly.time.forEach((t, i) => {
    const h = Number(t.slice(11, 13));
    if (h >= Math.floor(startHour) && h <= endHour) byDay.set(t.slice(0, 10), [...(byDay.get(t.slice(0, 10)) ?? []), i]);
  });
  const col = (name: string) => hourly[name] as (number | null)[];
  const mean = (name: string, idx: number[]) => {
    const v = idx.map((i) => col(name)[i]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  return [...byDay.values()]
    .map((idx) => ({
      temperature: mean('temperature_2m', idx),
      dewPoint: mean('dew_point_2m', idx),
      wind: mean('wind_speed_10m', idx),
      rain: idx.reduce((a, i) => a + (col('precipitation')[i] ?? 0), 0),
    }))
    .filter((d) => !isNaN(d.temperature) && !isNaN(d.dewPoint));
}

export function summarize(days: DaySample[], years: [number, number]): RaceClimatology {
  return {
    days: days.length,
    years,
    temperature: spread(days.map((d) => d.temperature)),
    dewPoint: spread(days.map((d) => d.dewPoint)),
    wind: spread(days.map((d) => d.wind).filter((x) => !isNaN(x))),
    rainShare: days.length ? days.filter((d) => d.rain >= RAIN_MM).length / days.length : NaN,
  };
}

/**
 * Typical race-day weather: for each of the last `years` complete years, the hourly values within 3 days either side
 * of month-day ("MM-DD"), at race hours. One small request per year, five at a time.
 */
export async function raceDayClimatology(
  lat: number,
  lon: number,
  monthDay: string,
  startHour: number,
  durationHours: number,
  years = 20,
  now = new Date(),
): Promise<RaceClimatology> {
  // the archive lags real time by about a week: use the latest year whose window is safely in the past
  let last = now.getUTCFullYear();
  if (Date.parse(windowFor(last, monthDay).end) > +now - 10 * DAY) last--;
  const list = Array.from({ length: years }, (_, i) => last - i);
  const days: DaySample[] = [];
  for (let i = 0; i < list.length; i += 5) {
    const batch = await Promise.all(
      list.slice(i, i + 5).map((y) =>
        getArchive({ lat, lon, ...windowFor(y, monthDay), hourly: ['temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'precipitation'] }),
      ),
    );
    for (const r of batch) days.push(...raceHourDays(r.hourly!, startHour, durationHours));
  }
  return summarize(days, [last - years + 1, last]);
}
