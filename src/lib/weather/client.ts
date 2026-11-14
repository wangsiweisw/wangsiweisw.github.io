// Typed wrappers around Open-Meteo (https://open-meteo.com, CC BY 4.0, free tier, no key): forecast, historical
// archive and geocoding. One timeout, one retry, typed errors. Times always come back in the place's local time.

export type WeatherErrorKind = 'timeout' | 'network' | 'http' | 'no-data';
export class WeatherError extends Error {
  kind: WeatherErrorKind;
  status?: number;
  constructor(kind: WeatherErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'WeatherError';
    this.kind = kind;
    this.status = status;
  }
}

export type Series = { time: string[] } & Record<string, (number | null)[] | string[]>;
export interface WeatherResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  utcOffsetSeconds: number;
  hourly?: Series;
  daily?: Series;
}
export interface Place {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
}

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

/** coordinates rounded to 2 decimals (~1 km): plenty for weather, and it makes cache keys stable */
const coord = (x: number) => x.toFixed(2);

const memory = new Map<string, unknown>();
function cached(url: string): unknown {
  if (memory.has(url)) return memory.get(url);
  try {
    const hit = globalThis.sessionStorage?.getItem(`om:${url}`);
    if (hit) return JSON.parse(hit);
  } catch {}
  return undefined;
}
function remember(url: string, data: unknown) {
  memory.set(url, data);
  try {
    globalThis.sessionStorage?.setItem(`om:${url}`, JSON.stringify(data));
  } catch {}
}

async function getJSON(url: string, timeoutMs = 15_000): Promise<any> {
  const hit = cached(url);
  if (hit !== undefined) return hit;
  let last: WeatherError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        last = new WeatherError('http', `Open-Meteo answered ${res.status}`, res.status);
        // a bad request won't get better on retry
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw last;
        continue;
      }
      const data = await res.json();
      remember(url, data);
      return data;
    } catch (e) {
      if (e instanceof WeatherError) throw e;
      last = new WeatherError((e as Error).name === 'AbortError' ? 'timeout' : 'network', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new WeatherError('network', 'request failed');
}

const shape = (d: any): WeatherResponse => ({
  latitude: d.latitude,
  longitude: d.longitude,
  elevation: d.elevation,
  timezone: d.timezone,
  utcOffsetSeconds: d.utc_offset_seconds,
  hourly: d.hourly,
  daily: d.daily,
});

/** Hourly forecast, up to 16 days ahead. */
export async function getForecast(o: { lat: number; lon: number; hourly: string[]; days?: number }): Promise<WeatherResponse> {
  const url = `${FORECAST}?latitude=${coord(o.lat)}&longitude=${coord(o.lon)}&hourly=${o.hourly.join(',')}&forecast_days=${o.days ?? 16}&timezone=auto`;
  return shape(await getJSON(url));
}

/** Historical weather (ERA5 reanalysis), dates as YYYY-MM-DD. `elevation` adjusts temperatures to that height. */
export async function getArchive(o: {
  lat: number;
  lon: number;
  start: string;
  end: string;
  hourly?: string[];
  daily?: string[];
  elevation?: number;
}): Promise<WeatherResponse> {
  const url =
    `${ARCHIVE}?latitude=${coord(o.lat)}&longitude=${coord(o.lon)}&start_date=${o.start}&end_date=${o.end}` +
    (o.hourly?.length ? `&hourly=${o.hourly.join(',')}` : '') +
    (o.daily?.length ? `&daily=${o.daily.join(',')}` : '') +
    (o.elevation != null ? `&elevation=${Math.round(o.elevation)}` : '') +
    '&timezone=auto';
  return shape(await getJSON(url, 60_000));
}

/** Place search by name. Throws WeatherError('no-data') when nothing matches. */
export async function geocode(name: string, count = 5): Promise<Place[]> {
  const d = await getJSON(`${GEOCODE}?name=${encodeURIComponent(name.trim())}&count=${count}&language=en`);
  if (!d.results?.length) throw new WeatherError('no-data', `No place found for “${name}”`);
  return d.results.map((r: any) => ({
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
    elevation: r.elevation,
    timezone: r.timezone,
  }));
}
