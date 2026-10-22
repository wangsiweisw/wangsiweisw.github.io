// Where the forecast map's numbers come from.
//  - PrecomputedSource: 0.5° fields cut from the latest AIFS / IFS / GFS runs by scripts/forecast-data/build.py in CI
//    and served from /fx/ with the site (no third-party requests, no quotas).
//  - LiveSource: the older fallback, a coarse grid of points from Open-Meteo, used when /fx/ is missing or stale.
// Both expose fields as one Float32Array (rows × cols, north-west first) per frame of a shared timeline.

export type ModelKey = 'aifs' | 'ifs' | 'gfs';
export type FieldName = 't2m' | 'tp6' | 'u10' | 'v10' | 'msl' | 'z500' | 'tptot';
export type City = { id: string; name: string; lat: number; lon: number; tz?: string };
export type Box = { s: number; n: number; w: number; e: number };

export interface FxSource {
  kind: 'pre' | 'live';
  rows: number;
  cols: number;
  lats: number[]; // north → south
  lons: number[]; // west → east
  time: number[]; // valid times, UTC ms
  stepHours: number; // precipitation accumulation period of tp6
  runs: Partial<Record<ModelKey, number>>; // model run times, UTC ms
  has(field: FieldName): boolean;
  /** frames for the timeline (tptot: a single frame); null if it can't be loaded */
  load(field: FieldName, model: ModelKey): Promise<Float32Array[] | null>;
}

const HOUR = 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- precomputed ------------------------------------------------------------------------------------------------

type Manifest = {
  generated: string;
  res: number;
  steps: number[];
  cities: Record<string, Box & { rows: number; cols: number }>;
  models: Record<string, { run: string; files: Record<string, { file: string; lo: number; hi: number; scale: 'linear' | 'sqrt' }> }>;
};

let manifest: Promise<Manifest | null> | null = null;
function getManifest() {
  manifest ??= fetch('/fx/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return manifest;
}

/** decode an 8-bit grayscale PNG to its raw pixel values */
async function pixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
}

class PrecomputedSource implements FxSource {
  kind = 'pre' as const;
  stepHours = 6;
  rows: number;
  cols: number;
  lats: number[];
  lons: number[];
  time: number[];
  runs: Partial<Record<ModelKey, number>> = {};
  private offset: Partial<Record<ModelKey, number>> = {}; // frames to skip so every model starts at time[0]
  private cache = new Map<string, Promise<Float32Array[] | null>>();

  constructor(
    private m: Manifest,
    private city: string,
  ) {
    const g = m.cities[city];
    this.rows = g.rows;
    this.cols = g.cols;
    this.lats = Array.from({ length: g.rows }, (_, i) => g.n - i * m.res);
    this.lons = Array.from({ length: g.cols }, (_, i) => g.w + i * m.res);
    for (const [k, v] of Object.entries(m.models)) this.runs[k as ModelKey] = Date.parse(v.run);
    // the timeline starts at the newest run; older runs skip their first frames to line up
    const start = Math.max(...Object.values(this.runs));
    const stepMs = (m.steps[1] - m.steps[0]) * HOUR;
    let frames = m.steps.length;
    for (const [k, run] of Object.entries(this.runs)) {
      const off = Math.round((start - run) / stepMs);
      this.offset[k as ModelKey] = off;
      frames = Math.min(frames, m.steps.length - off);
    }
    this.time = Array.from({ length: frames }, (_, i) => start + i * stepMs);
  }

  has(field: FieldName) {
    return Object.values(this.m.models).some((v) => `${this.city}/${field}` in v.files);
  }

  load(field: FieldName, model: ModelKey) {
    const key = `${field}/${model}`;
    if (!this.cache.has(key)) this.cache.set(key, this.read(field, model));
    return this.cache.get(key)!;
  }

  private async read(field: FieldName, model: ModelKey): Promise<Float32Array[] | null> {
    const meta = this.m.models[model]?.files[`${this.city}/${field}`];
    if (!meta) return null;
    try {
      const img = await pixels(`/fx/${meta.file}`);
      const n = this.rows * this.cols;
      const frames = Math.floor(img.height / this.rows);
      const span = meta.hi - meta.lo;
      const out: Float32Array[] = [];
      for (let f = 0; f < frames; f++) {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const p = img.data[(f * n + i) * 4] / 255; // gray: R = G = B
          a[i] = meta.scale === 'sqrt' ? p * p * meta.hi : meta.lo + p * span;
        }
        out.push(a);
      }
      if (field === 'tptot') return out;
      const off = this.offset[model] ?? 0;
      return out.slice(off, off + this.time.length);
    } catch {
      return null;
    }
  }
}

// --- live (Open-Meteo) fallback ---------------------------------------------------------------------------------

const LIVE_MODELS: Record<ModelKey, string> = { aifs: 'ecmwf_aifs025_single', ifs: 'ecmwf_ifs025', gfs: 'gfs_global' };
const LIVE_KEYS = Object.keys(LIVE_MODELS) as ModelKey[];
const ROWS = 16;
const COLS = 20;
type Raw = { time: number[]; v: Record<string, (number | null)[]>[] };

/** Save to localStorage; if it's full, drop other map entries (they're ~1 MB each) and try once more. */
function store(key: string, value: string) {
  const drop = (keep: (k: string) => boolean) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('fxmap') && !keep(k)) localStorage.removeItem(k);
    }
  };
  try {
    drop((k) => {
      try {
        return Date.now() - (JSON.parse(localStorage.getItem(k) ?? '{}').t ?? 0) < HOUR;
      } catch {
        return false;
      }
    });
    localStorage.setItem(key, value);
  } catch {
    try {
      drop((k) => k === key);
      localStorage.setItem(key, value);
    } catch {}
  }
}

class LiveSource implements FxSource {
  kind = 'live' as const;
  stepHours = 3;
  rows = ROWS;
  cols = COLS;
  lats: number[];
  lons: number[];
  time: number[] = [];
  runs = {};
  private raws = new Map<string, Promise<Raw | null>>();

  constructor(private box: Box) {
    this.lats = Array.from({ length: ROWS }, (_, i) => +(box.n - (i * (box.n - box.s)) / (ROWS - 1)).toFixed(2));
    this.lons = Array.from({ length: COLS }, (_, i) => +(box.w + (i * (box.e - box.w)) / (COLS - 1)).toFixed(2));
  }

  has(field: FieldName) {
    return ['t2m', 'tp6', 'u10', 'v10'].includes(field);
  }

  /** the temperature/precipitation request also sets the timeline */
  async init() {
    const raw = await this.raw('tp');
    if (raw) this.time = raw.time.map((s) => s * 1000);
    return !!raw;
  }

  private raw(tag: 'tp' | 'wind') {
    if (!this.raws.has(tag)) this.raws.set(tag, this.fetch(tag === 'tp' ? ['temperature_2m', 'precipitation'] : ['wind_speed_10m', 'wind_direction_10m'], tag));
    return this.raws.get(tag)!;
  }

  /** all grid points and models in one request; cached an hour in localStorage, retried once */
  private async fetch(vars: string[], tag: string): Promise<Raw | null> {
    const b = this.box;
    const r = (x: number) => Math.round(x);
    const key = `fxmap6-${tag}-${r(b.s)},${r(b.n)},${r(b.w)},${r(b.e)}-${ROWS}x${COLS}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (cached && Date.now() - cached.t < HOUR) return cached.raw;
    } catch {}
    const qLat: number[] = [];
    const qLon: number[] = [];
    const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
    for (const la of this.lats) for (const lo of this.lons) (qLat.push(la), qLon.push(+wrap(lo).toFixed(2)));
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${qLat}&longitude=${qLon}&hourly=${vars.join(',')}` +
      `&models=${LIVE_KEYS.map((k) => LIVE_MODELS[k]).join(',')}&forecast_days=10&temporal_resolution=hourly_3&timeformat=unixtime`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(3000);
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const raw: Raw = {
          time: data[0].hourly.time,
          v: data.map((d: any) =>
            Object.fromEntries(LIVE_KEYS.flatMap((k) => vars.map((name) => [`${name}_${k}`, d.hourly[`${name}_${LIVE_MODELS[k]}`]]))),
          ),
        };
        store(key, JSON.stringify({ t: Date.now(), raw }));
        return raw;
      } catch {}
    }
    return null;
  }

  async load(field: FieldName, model: ModelKey): Promise<Float32Array[] | null> {
    if (!this.has(field)) return null;
    const raw = await this.raw(field === 'u10' || field === 'v10' ? 'wind' : 'tp');
    if (!raw) return null;
    const col = (name: string) =>
      Array.from({ length: raw.time.length }, (_, t) => Float32Array.from(raw.v, (loc) => loc[`${name}_${model}`]?.[t] ?? NaN));
    if (field === 't2m') return col('temperature_2m');
    if (field === 'tp6') return col('precipitation');
    // speed + "blowing from" direction → components of the flow (km/h)
    const sp = col('wind_speed_10m');
    const dir = col('wind_direction_10m');
    return sp.map((f, t) =>
      f.map((s, i) => {
        const rad = (dir[t][i] * Math.PI) / 180;
        return field === 'u10' ? -s * Math.sin(rad) : -s * Math.cos(rad);
      }),
    );
  }
}

/** the region shown for a city (the precomputed data covers the same area) */
export function regionFor(c: City): Box {
  const lonHalf = Math.min(45, 20 / Math.cos((c.lat * Math.PI) / 180));
  return { s: Math.max(-80, c.lat - 15), n: Math.min(80, c.lat + 15), w: c.lon - lonHalf, e: c.lon + lonHalf };
}

/** Precomputed data when it's there and recent (≤ 30 h), else the live fallback. Null if neither loads. */
export async function sourceFor(city: City): Promise<FxSource | null> {
  const m = await getManifest();
  if (m?.cities[city.id] && Date.now() - Date.parse(m.generated) < 30 * HOUR) return new PrecomputedSource(m, city.id);
  const live = new LiveSource(regionFor(city));
  return (await live.init()) ? live : null;
}
