// Forecast card data, fetched in the visitor's browser straight from Open-Meteo. The free tier limits each IP by
// request *cost* (600 a minute, 10,000 a day; a request's cost grows with days × variables), so everything here is
// sized to stay cheap: about 100 per card, less when the browser caches below still hold normals and scores.
// The forecast comes back first; normals and past-forecast scores fill in as they arrive.
import {
  addDays,
  averageScores,
  cardDays,
  climRange,
  climateWindows,
  climatology,
  daysBetween,
  mergeHourly,
  memberSeries,
  rangeStat,
  scoreLeads,
  seasonWindows,
  summarize,
  type ClimRange,
  type ClimStat,
  type DayStat,
  type Hourly,
  type LeadScore,
  type MemberDay,
  type RangeStat,
  type Window,
} from './stats';

export type Place = { name: string; lat: number; lon: number; detail?: string };
export type Lang = 'en' | 'zh';
export type Status = 'loading' | 'ok' | 'failed' | 'few';

type Ensemble = { key: string; id: string; name: string; org: Record<Lang, string>; days: number; onlyFar?: boolean };
export const ENSEMBLES: Ensemble[] = [
  { key: 'aifs', id: 'ecmwf_aifs025', name: 'AIFS', org: { en: 'ECMWF · AI', zh: 'ECMWF · AI' }, days: 15 },
  { key: 'ifs', id: 'ecmwf_ifs025', name: 'IFS', org: { en: 'ECMWF · physics', zh: 'ECMWF · 物理' }, days: 15 },
  { key: 'gefs', id: 'gfs_seamless', name: 'GEFS', org: { en: 'NOAA', zh: '美国 NOAA' }, days: 35 },
  // Canada's ensemble only adds a second opinion where the ECMWF runs stop
  { key: 'gem', id: 'gem_global', name: 'GEM', org: { en: 'Canada', zh: '加拿大' }, days: 16, onlyFar: true },
];
const HISTORY = [
  { key: 'aifs', id: 'ecmwf_aifs025_single' },
  { key: 'ifs', id: 'ecmwf_ifs025' },
  { key: 'gfs', id: 'gfs_seamless' },
];
/** Leads scored. Fewer variables per request keeps the cost down; 4 and 6 add little to the curve. */
export const SCORED_LEADS = [1, 2, 3, 5, 7];
/** Furthest date the card offers, in days from today: GEFS runs 35 days, the newest run's last full day is ~32 out. */
export const HORIZON = 32;
/** Longest range the card takes, in days. */
export const MAX_RANGE = 14;
/** Years of normals. */
export const CLIM_YEARS = 20;

export type CardData = {
  place: Place;
  /** Today where the place is. */
  today: string;
  from: string;
  to: string;
  days: string[];
  models: { key: string; name: string; org: Record<Lang, string>; byDay: Record<string, DayStat>; range: RangeStat | null }[];
  /** Every member of every model, pooled per day. */
  pooled: Record<string, DayStat>;
  /** Single day (`from` = `to`): the models that reach it, pooled. */
  atDay: DayStat | null;
  /** The range followed member by member, pooled over the models that cover all of it. */
  range: RangeStat | null;
  clim: Record<string, ClimStat> | null;
  climRange: ClimRange | null;
  climStatus: Status;
  scores: LeadScore[] | null;
  scoresStatus: Status;
  seasons: Window[];
};

const ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const PREV = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

/** JSON or null. A per-minute limit (429 "Minutely…") waits and tries once more; the daily limit doesn't. */
async function getJSON(url: string, tries = 2): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429) {
        const reason = String((await res.json().catch(() => ({})))?.reason ?? '');
        if (!/minut/i.test(reason) || i === tries - 1) return null;
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

/**
 * One model's ensemble, kept in memory for 30 minutes so changing dates doesn't ask again. Lengths come in a few
 * steps (10 days, the model's full run) so nearby dates share a request.
 */
const ensCache = new Map<string, { t: number; v: Promise<any> }>();
function ensemble(q: string, m: Ensemble, reach: number): Promise<any> {
  const days = reach <= 10 ? Math.min(10, m.days) : m.days;
  const key = `${q}:${m.id}:${days}`;
  const hit = ensCache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.v;
  const v = getJSON(`${ENS}?${q}&models=${m.id}&hourly=temperature_2m,precipitation,snowfall&forecast_days=${days}`);
  ensCache.set(key, { t: Date.now(), v });
  v.then((j) => j || ensCache.delete(key)); // don't keep a failure
  return v;
}

/** Long-lived per-browser cache for things that barely change (normals, past scores). */
const store = {
  get<T>(key: string, maxAgeMs: number): T | null {
    try {
      const c = JSON.parse(localStorage.getItem(key) ?? 'null');
      return c && Date.now() - c.t < maxAgeMs ? (c.v as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
    } catch {}
  },
};

/** Today's date where the visitor is, as YYYY-MM-DD. */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Build a card for `place` over `from`…`to` (equal for one day). `onUpdate` gets the card three times as it fills
 * in: forecast, then normals and scores in whichever order they land. Resolves with the finished card.
 */
export async function loadCard(place: Place, from: string, to: string, onUpdate: (d: CardData) => void, today = localToday()): Promise<CardData> {
  const q = `latitude=${place.lat}&longitude=${place.lon}&timezone=auto`;
  // through the last day the card will show, plus slack for places a day ahead of the visitor
  const reach = daysBetween(today, cardDays(today, from, to, HORIZON).at(-1)!) + 2;
  const ens = ENSEMBLES.filter((m) => !m.onlyFar || reach > 16);
  const ensJson = await Promise.all(ens.map((m) => ensemble(q, m, reach)));

  // the place's own today: forecasts start at its local midnight
  const first = ensJson.find((j) => j?.hourly?.time?.length)?.hourly.time[0] as string | undefined;
  if (!first) throw new Error('forecast');
  const placeToday = first.slice(0, 10);
  if (from < placeToday) from = placeToday;
  if (to < from) to = from;
  const days = cardDays(placeToday, from, to, HORIZON);
  const rangeDays = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));

  const pooledMembers = new Map<string, MemberDay[]>();
  const dayMembers: MemberDay[] = [];
  const allSeries: Map<string, (MemberDay | null)[]>[] = [];
  const models: CardData['models'] = [];
  ens.forEach((m, i) => {
    const h = ensJson[i]?.hourly as Hourly | undefined;
    if (!h) return;
    const series = memberSeries(h);
    const byDay: Record<string, DayStat> = {};
    for (const d of days) {
      const mem = series.get(d)?.filter(Boolean) as MemberDay[] | undefined;
      if (!mem?.length) continue;
      byDay[d] = summarize(mem);
      pooledMembers.set(d, [...(pooledMembers.get(d) ?? []), ...mem]);
      if (from === to && d === from) dayMembers.push(...mem);
    }
    if (!Object.keys(byDay).length) return;
    allSeries.push(series);
    models.push({ key: m.key, name: m.name, org: m.org, byDay, range: rangeStat([series], rangeDays) });
  });
  if (!models.length) throw new Error('forecast');

  const data: CardData = {
    place,
    today: placeToday,
    from,
    to,
    days,
    models,
    pooled: Object.fromEntries([...pooledMembers].map(([d, mem]) => [d, summarize(mem)])),
    atDay: dayMembers.length ? summarize(dayMembers) : null,
    range: rangeStat(allSeries, rangeDays),
    clim: null,
    climRange: null,
    climStatus: 'loading',
    scores: null,
    scoresStatus: 'loading',
    seasons: seasonWindows(from, placeToday),
  };
  onUpdate({ ...data });

  const cell = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  await Promise.all([loadNormals(data, q, cell, rangeDays, onUpdate), loadScores(data, q, cell, onUpdate)]);
  return data;
}

/** Normals from ERA5: one small request per past year, just the weeks around the shown days. */
async function loadNormals(data: CardData, q: string, cell: string, rangeDays: string[], onUpdate: (d: CardData) => void) {
  const key = `fxclim2:${cell}:${data.days[0]}:${data.days.at(-1)}:${data.from}:${data.to}`;
  const cached = store.get<Pick<CardData, 'clim' | 'climRange'>>(key, 30 * 86_400_000);
  if (cached) {
    Object.assign(data, cached, { climStatus: 'ok' });
    return onUpdate({ ...data });
  }
  const windows = climateWindows(data.days, data.today);
  const blocks = await Promise.all(
    windows.map((w) =>
      getJSON(`${ARCHIVE}?${q}&models=era5&daily=precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min&start_date=${w.start}&end_date=${w.end}`),
    ),
  );
  const ok = blocks.filter((b) => b?.daily);
  if (ok.length < windows.length * 0.75) {
    data.climStatus = 'failed';
    return onUpdate({ ...data });
  }
  const vars = ['precipitation_sum', 'snowfall_sum', 'temperature_2m_max', 'temperature_2m_min'] as const;
  const daily = { time: ok.flatMap((b) => b.daily.time) } as any;
  for (const v of vars) daily[v] = ok.flatMap((b) => b.daily[v]);
  const entries = data.days.map((d) => [d, climatology(daily, d)] as const);
  data.clim = entries.every(([, c]) => c) ? (Object.fromEntries(entries) as Record<string, ClimStat>) : null;
  data.climRange = climRange(daily, rangeDays[0], rangeDays.at(-1)!);
  data.climStatus = data.clim ? 'ok' : 'few';
  if (data.clim) store.set(key, { clim: data.clim, climRange: data.climRange });
  onUpdate({ ...data });
}

/** Past forecasts over the same season in earlier years, scored against ERA5. */
async function loadScores(data: CardData, q: string, cell: string, onUpdate: (d: CardData) => void) {
  // scores move slowly: one cache entry per place and week of the year, kept for three days
  const week = `${data.from.slice(5, 7)}-${Math.floor(Number(data.from.slice(8)) / 7)}`;
  const key = `fxscore2:${cell}:${week}`;
  const cached = store.get<{ scores: LeadScore[] | null; status: Status }>(key, 3 * 86_400_000);
  if (cached) {
    data.scores = cached.scores;
    data.scoresStatus = cached.status;
    return onUpdate({ ...data });
  }
  const vars = ['precipitation', 'temperature_2m'].flatMap((v) => SCORED_LEADS.map((n) => `${v}_previous_day${n}`)).join(',');
  const [hist, truth] = await Promise.all([
    Promise.all(
      HISTORY.map((m) => Promise.all(data.seasons.map((w) => getJSON(`${PREV}?${q}&models=${m.id}&hourly=${vars}&start_date=${w.start}&end_date=${w.end}`)))),
    ),
    Promise.all(data.seasons.map((w) => getJSON(`${ARCHIVE}?${q}&models=era5&hourly=precipitation,temperature_2m&start_date=${w.start}&end_date=${w.end}`))),
  ]);
  const truthBlocks = truth.map((j) => j?.hourly as Hourly | undefined).filter(Boolean) as Hourly[];
  const histBlocks = hist.map((blocks) => blocks.map((j) => j?.hourly as Hourly | undefined).filter(Boolean) as Hourly[]);
  const requested = data.seasons.length * (HISTORY.length + 1);
  const received = truthBlocks.length + histBlocks.reduce((a, b) => a + b.length, 0);
  if (!truthBlocks.length || received < requested * 0.6) {
    data.scoresStatus = 'failed';
    return onUpdate({ ...data });
  }
  const t = mergeHourly(truthBlocks);
  const perModel = histBlocks.filter((b) => b.length).map((b) => scoreLeads(mergeHourly(b), t, SCORED_LEADS));
  data.scores = averageScores(perModel);
  data.scoresStatus = data.scores ? 'ok' : 'few';
  store.set(key, { scores: data.scores, status: data.scoresStatus });
  onUpdate({ ...data });
}

/** Place search (Open-Meteo Geocoding). It matches names written in Latin script; results come back in `lang`. */
export async function searchPlaces(name: string, lang: Lang): Promise<Place[]> {
  const j = await getJSON(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=${lang}&format=json`,
    1,
  );
  return (j?.results ?? []).map((r: any) => ({
    name: r.name,
    lat: +r.latitude.toFixed(3),
    lon: +r.longitude.toFixed(3),
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
  }));
}

export { addDays, daysBetween };
