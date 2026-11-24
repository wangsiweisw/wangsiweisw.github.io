// Forecast card data, fetched in the visitor's browser straight from Open-Meteo (free for non-commercial use, rate
// limited per IP, so every visitor spends their own quota). About 15 requests in parallel, ~0.3 MB gzipped.
import {
  addDays,
  averageScores,
  cardDays,
  climatology,
  daysBetween,
  mergeHourly,
  memberDays,
  scoreLeads,
  seasonWindows,
  summarize,
  type ClimStat,
  type DayStat,
  type Hourly,
  type LeadScore,
  type MemberDay,
  type Window,
} from './stats';

export type Place = { name: string; lat: number; lon: number; detail?: string };
export type Lang = 'en' | 'zh';

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
/** Furthest target date the card offers, in days from today. */
export const HORIZON = 32; // GEFS runs to 35 days, but the newest run's last full day is about 32–33 days out

export type CardData = {
  place: Place;
  today: string;
  target: string;
  days: string[];
  models: { key: string; name: string; org: Record<Lang, string>; byDay: Record<string, DayStat> }[];
  /** Every member of every model, pooled per day. */
  pooled: Record<string, DayStat>;
  /** Only the models that reach the target, pooled. */
  atTarget: DayStat | null;
  clim: Record<string, ClimStat> | null;
  scores: LeadScore[] | null;
  seasons: Window[];
};

const ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const PREV = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

async function getJSON(url: string, tries = 2): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429) break; // over the free limit: retrying only makes it worse
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

/** Today's date where the visitor is, as YYYY-MM-DD. */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function loadCard(place: Place, target: string, today = localToday()): Promise<CardData> {
  const key = `fxcard1:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${target}:${today}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (c && Date.now() - c.t < 3600_000) return { ...c.d, place };
  } catch {}

  const q = `latitude=${place.lat}&longitude=${place.lon}&timezone=auto`;
  const days = cardDays(today, target, HORIZON);
  const reach = daysBetween(today, days.at(-1)!) + 2;
  const far = reach > 15;
  const ens = ENSEMBLES.filter((m) => !m.onlyFar || far);
  const seasons = seasonWindows(target, today);
  const thisYear = Number(today.slice(0, 4));
  const histVars = ['precipitation', 'temperature_2m'].flatMap((v) => [1, 2, 3, 4, 5, 6, 7].map((n) => `${v}_previous_day${n}`)).join(',');

  const [ensJson, climJson, histJson, truthJson] = await Promise.all([
    Promise.all(
      ens.map((m) =>
        getJSON(`${ENS}?${q}&models=${m.id}&hourly=temperature_2m,precipitation,snowfall&forecast_days=${Math.min(m.days, reach)}`),
      ),
    ),
    getJSON(
      `${ARCHIVE}?${q}&models=era5&daily=precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min` +
        `&start_date=${thisYear - 30}-01-01&end_date=${thisYear - 1}-12-31`,
    ),
    Promise.all(
      HISTORY.map((m) =>
        Promise.all(seasons.map((w) => getJSON(`${PREV}?${q}&models=${m.id}&hourly=${histVars}&start_date=${w.start}&end_date=${w.end}`))),
      ),
    ),
    Promise.all(seasons.map((w) => getJSON(`${ARCHIVE}?${q}&models=era5&hourly=precipitation,temperature_2m&start_date=${w.start}&end_date=${w.end}`))),
  ]);

  // forecasts: per model per day, and pooled
  const pooledMembers = new Map<string, MemberDay[]>();
  const targetMembers: MemberDay[] = [];
  const models: CardData['models'] = [];
  ens.forEach((m, i) => {
    const h = ensJson[i]?.hourly as Hourly | undefined;
    if (!h) return;
    const md = memberDays(h);
    const byDay: Record<string, DayStat> = {};
    for (const d of days) {
      const mem = md.get(d);
      if (!mem) continue;
      byDay[d] = summarize(mem);
      pooledMembers.set(d, [...(pooledMembers.get(d) ?? []), ...mem]);
      if (d === target) targetMembers.push(...mem);
    }
    if (Object.keys(byDay).length) models.push({ key: m.key, name: m.name, org: m.org, byDay });
  });
  if (!models.length) throw new Error('forecast');
  const pooled = Object.fromEntries([...pooledMembers].map(([d, mem]) => [d, summarize(mem)]));

  // what's normal for each shown day
  let clim: CardData['clim'] = null;
  if (climJson?.daily) {
    const entries = days.map((d) => [d, climatology(climJson.daily, d)] as const);
    if (entries.every(([, c]) => c)) clim = Object.fromEntries(entries) as Record<string, ClimStat>;
  }

  // how past forecasts did over the same season
  let scores: LeadScore[] | null = null;
  const truthBlocks = truthJson.map((j) => j?.hourly as Hourly | undefined);
  if (truthBlocks.some(Boolean)) {
    const truth = mergeHourly(truthBlocks.filter(Boolean) as Hourly[]);
    const perModel = histJson
      .map((blocks) => blocks.map((j) => j?.hourly as Hourly | undefined).filter(Boolean) as Hourly[])
      .filter((blocks) => blocks.length)
      .map((blocks) => scoreLeads(mergeHourly(blocks), truth));
    scores = averageScores(perModel);
  }

  const data: CardData = {
    place,
    today,
    target,
    days,
    models,
    pooled,
    atTarget: targetMembers.length ? summarize(targetMembers) : null,
    clim,
    scores,
    seasons,
  };
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
  } catch {}
  return data;
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
