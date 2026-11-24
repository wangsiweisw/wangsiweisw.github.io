// Forecast card numbers: per-day ensemble probabilities, climatology around a date, and how past forecasts scored at
// a spot over the same season in earlier years. Pure functions on Open-Meteo JSON, so they run in the browser and in tests.

/** Open-Meteo `hourly` block: local ISO times plus one array per variable (ensemble members as `<var>_memberNN`). */
export type Hourly = { time: string[] } & Record<string, (number | null)[] | string[]>;

/** One ensemble member's day: all precipitation and the rain part of it in mm, snowfall in cm, temperatures in °C. */
export type MemberDay = { p: number; r: number; sn: number; tx: number; tn: number };

/**
 * A day across an ensemble (or several): chances in % of rain (≥1 mm), heavy rain (≥10 mm), snow (≥1 cm) and of
 * any precipitation (≥1 mm of rain or snow's water), plus temperature percentiles [p10, p50, p90] in °C.
 */
export type DayStat = { n: number; pRain: number; pHeavy: number; pSnow: number; pWet: number; hi: [number, number, number]; lo: [number, number, number] };

/** What the same calendar days have been like over past years. */
export type ClimStat = { n: number; pRain: number; pHeavy: number; pSnow: number; pWet: number; hi: number; lo: number };

/** How forecasts made `lead` days ahead did on the scored days. */
export type LeadScore = { lead: number; days: number; base: number; wetOk: number | null; dryOk: number | null; maeHi: number };

export const WET_MM = 1;
export const RAIN_MM = 1;
/** Open-Meteo's snowfall is 7 cm of snow per 10 mm of water. */
const SNOW_CM_PER_MM = 0.7;
export const HEAVY_MM = 10;
export const SNOW_CM = 1;
export const LEADS = [1, 2, 3, 4, 5, 6, 7];

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (hits: number, n: number) => (n ? Math.round((100 * hits) / n) : 0);
const quantile = (sorted: number[], p: number) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

/**
 * Every member's daily totals and extremes, keyed by local date, in a fixed member order (`null` where a member has
 * fewer than 20 valid hours that day), so a member can be followed across days.
 */
export function memberSeries(h: Hourly): Map<string, (MemberDay | null)[]> {
  const suffixes = Object.keys(h)
    .filter((k) => k === 'temperature_2m' || k.startsWith('temperature_2m_member'))
    .map((k) => k.slice('temperature_2m'.length));
  const byDay = new Map<string, number[]>();
  h.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  });
  const out = new Map<string, (MemberDay | null)[]>();
  for (const [d, idx] of byDay) {
    const members = suffixes.map((s): MemberDay | null => {
      const T = h[`temperature_2m${s}`] as (number | null)[];
      const P = (h[`precipitation${s}`] ?? []) as (number | null)[];
      const S = (h[`snowfall${s}`] ?? []) as (number | null)[];
      const ok = idx.filter((i) => num(T[i]) && num(P[i]));
      if (ok.length < 20) return null;
      // rain is whatever precipitation isn't snow, hour by hour
      const snowWater = (i: number) => (num(S[i]) ? (S[i] as number) / SNOW_CM_PER_MM : 0);
      return {
        p: ok.reduce((a, i) => a + (P[i] as number), 0),
        r: ok.reduce((a, i) => a + Math.max(0, (P[i] as number) - snowWater(i)), 0),
        sn: ok.reduce((a, i) => a + (num(S[i]) ? (S[i] as number) : 0), 0),
        tx: Math.max(...ok.map((i) => T[i] as number)),
        tn: Math.min(...ok.map((i) => T[i] as number)),
      };
    });
    if (members.some(Boolean)) out.set(d, members);
  }
  return out;
}

/** Like `memberSeries`, without the gaps: only the members that cover each day. */
export function memberDays(h: Hourly): Map<string, MemberDay[]> {
  return new Map([...memberSeries(h)].map(([d, m]) => [d, m.filter(Boolean) as MemberDay[]]));
}

export function summarize(members: MemberDay[]): DayStat {
  const hi = members.map((m) => m.tx).sort((a, b) => a - b);
  const lo = members.map((m) => m.tn).sort((a, b) => a - b);
  const q = (s: number[]) => [quantile(s, 0.1), quantile(s, 0.5), quantile(s, 0.9)] as [number, number, number];
  return {
    n: members.length,
    pRain: pct(members.filter((m) => m.r >= RAIN_MM).length, members.length),
    pHeavy: pct(members.filter((m) => m.r >= HEAVY_MM).length, members.length),
    pSnow: pct(members.filter((m) => m.sn >= SNOW_CM).length, members.length),
    pWet: pct(members.filter((m) => m.p >= WET_MM).length, members.length),
    hi: q(hi),
    lo: q(lo),
  };
}

/** An archive `daily` block: ERA5 rain and all precipitation in mm, snowfall in cm, temperatures in °C. */
export type Daily = {
  time: string[];
  precipitation_sum: (number | null)[];
  rain_sum: (number | null)[];
  snowfall_sum: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
};

/** Climatology for a calendar day: every year's days within ±`halfWidth` days of it. `daily` is an archive `daily` block. */
export function climatology(
  daily: Daily,
  isoDay: string,
  halfWidth = 7,
): ClimStat | null {
  // Feb 29 counts as Feb 28 so every year has the day
  const md = isoDay.slice(5) === '02-29' ? '02-28' : isoDay.slice(5);
  const rows: { p: number; r: number; sn: number; tx: number; tn: number }[] = [];
  daily.time.forEach((t, i) => {
    const y = Number(t.slice(0, 4));
    // the same calendar day in this row's year and the years either side, so windows can cross New Year
    const near = [y - 1, y, y + 1].some((yy) => Math.abs(daysBetween(`${yy}-${md}`, t)) <= halfWidth);
    const p = daily.precipitation_sum[i];
    const tx = daily.temperature_2m_max[i];
    const tn = daily.temperature_2m_min[i];
    if (near && num(p) && num(tx) && num(tn)) rows.push({ p, r: daily.rain_sum[i] ?? p, sn: daily.snowfall_sum[i] ?? 0, tx, tn });
  });
  if (rows.length < 30) return null;
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  return {
    n: rows.length,
    pRain: pct(rows.filter((r) => r.r >= RAIN_MM).length, rows.length),
    pHeavy: pct(rows.filter((r) => r.r >= HEAVY_MM).length, rows.length),
    pSnow: pct(rows.filter((r) => r.sn >= SNOW_CM).length, rows.length),
    pWet: pct(rows.filter((r) => r.p >= WET_MM).length, rows.length),
    hi: mean((r) => r.tx),
    lo: mean((r) => r.tn),
  };
}

export type Window = { start: string; end: string };

/**
 * The stretches of past forecasts to score: the target date ±`halfWidth` days in this year and every earlier year the
 * archive holds, never past what ERA5 has caught up to (`today` − `lag`). Same season, not "the last N days". The
 * Previous Runs archive starts in early 2024 (Feb 2025 for AIFS); clipped stubs under `minDays` aren't worth a request.
 */
export function seasonWindows(target: string, today: string, archiveStart = '2024-02-01', halfWidth = 42, lag = 6, minDays = 7): Window[] {
  const lastTruth = addDays(today, -lag);
  const out: Window[] = [];
  for (let k = 0; k < 30; k++) {
    const center = `${Number(target.slice(0, 4)) - k}${target.slice(4)}`;
    let start = addDays(center, -halfWidth);
    let end = addDays(center, halfWidth);
    if (end < archiveStart) break;
    if (start < archiveStart) start = archiveStart;
    if (end > lastTruth) end = lastTruth;
    if (daysBetween(start, end) + 1 >= minDays) out.push({ start, end });
  }
  return out.reverse();
}

/** Stitch several hourly blocks (one per window) into one. Variables missing from a block are padded with nulls. */
export function mergeHourly(blocks: Hourly[]): Hourly {
  const keys = [...new Set(blocks.flatMap((b) => Object.keys(b)))].filter((k) => k !== 'time');
  const out = { time: blocks.flatMap((b) => b.time) } as Hourly;
  for (const k of keys) out[k] = blocks.flatMap((b) => (b[k] as (number | null)[]) ?? b.time.map(() => null));
  return out;
}

/** Complete local days only (24 valid hours): date → hourly values. */
function fullDays(h: Hourly, key: string): Map<string, number[]> {
  const by = new Map<string, (number | null)[]>();
  const v = (h[key] ?? []) as (number | null)[];
  h.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    by.set(d, [...(by.get(d) ?? []), v[i] ?? null]);
  });
  const out = new Map<string, number[]>();
  for (const [d, xs] of by) if (xs.length === 24 && xs.every(num)) out.set(d, xs as number[]);
  return out;
}

/**
 * Score one model's past forecasts against ERA5 by lead. A day is "wet" with ≥1 mm. `base` is how often the scored
 * days were wet anyway: the "just guess" line for "said wet → was wet".
 */
export function scoreLeads(forecast: Hourly, truth: Hourly, leads = LEADS): LeadScore[] {
  const tp = fullDays(truth, 'precipitation');
  const tt = fullDays(truth, 'temperature_2m');
  return leads.map((n) => {
    const fp = fullDays(forecast, `precipitation_previous_day${n}`);
    const ft = fullDays(forecast, `temperature_2m_previous_day${n}`);
    const days = [...fp.keys()].filter((d) => tp.has(d) && ft.has(d) && tt.has(d));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const saidWet = days.filter((d) => sum(fp.get(d)!) >= WET_MM);
    const saidDry = days.filter((d) => sum(fp.get(d)!) < WET_MM);
    const wasWet = (d: string) => sum(tp.get(d)!) >= WET_MM;
    return {
      lead: n,
      days: days.length,
      base: pct(days.filter(wasWet).length, days.length),
      wetOk: saidWet.length >= 5 ? pct(saidWet.filter(wasWet).length, saidWet.length) : null,
      dryOk: saidDry.length >= 5 ? pct(saidDry.filter((d) => !wasWet(d)).length, saidDry.length) : null,
      maeHi: days.length ? days.reduce((a, d) => a + Math.abs(Math.max(...ft.get(d)!) - Math.max(...tt.get(d)!)), 0) / days.length : NaN,
    };
  });
}

/** Average several models' scores lead by lead, skipping models with too few scored days. */
export function averageScores(perModel: LeadScore[][], minDays = 30): LeadScore[] | null {
  const usable = perModel.filter((s) => s[0] && s[0].days >= minDays);
  if (!usable.length) return null;
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter(num);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return usable[0].map((_, i) => ({
    lead: usable[0][i].lead,
    days: Math.max(...usable.map((s) => s[i].days)),
    base: mean(usable.map((s) => s[i].base)) ?? 0,
    wetOk: mean(usable.map((s) => s[i].wetOk)),
    dryOk: mean(usable.map((s) => s[i].dryOk)),
    maeHi: usable.reduce((a, s) => a + s[i].maeHi, 0) / usable.length,
  }));
}

/** A stretch of days across an ensemble: each member is followed through every day of the range. */
export type RangeStat = {
  n: number;
  /** chance of at least one rainy (≥1 mm of rain) day, %. */
  pAnyRain: number;
  /** chance of at least one snowy (≥1 cm) day, %. */
  pAnySnow: number;
  /** chance of at least one day with ≥1 mm of anything, %. */
  pAnyWet: number;
  /** number of rainy days and of snowy days: [p25, p50, p75]. */
  rainDays: [number, number, number];
  snowDays: [number, number, number];
};

/** Range stats pooled over models; members missing any day of the range are left out. */
export function rangeStat(series: Map<string, (MemberDay | null)[]>[], days: string[]): RangeStat | null {
  const rows: { rain: number; snow: number; wet: number }[] = [];
  for (const s of series) {
    const perDay = days.map((d) => s.get(d));
    if (perDay.some((x) => !x)) continue;
    const width = perDay[0]!.length;
    for (let i = 0; i < width; i++) {
      const m = perDay.map((x) => x![i]);
      if (m.some((x) => !x)) continue;
      rows.push({
        rain: m.filter((x) => x!.r >= RAIN_MM).length,
        snow: m.filter((x) => x!.sn >= SNOW_CM).length,
        wet: m.filter((x) => x!.p >= WET_MM).length,
      });
    }
  }
  if (!rows.length) return null;
  const q3 = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return [quantile(s, 0.25), quantile(s, 0.5), quantile(s, 0.75)] as [number, number, number];
  };
  return {
    n: rows.length,
    pAnyRain: pct(rows.filter((r) => r.rain > 0).length, rows.length),
    pAnySnow: pct(rows.filter((r) => r.snow > 0).length, rows.length),
    pAnyWet: pct(rows.filter((r) => r.wet > 0).length, rows.length),
    rainDays: q3(rows.map((r) => r.rain)),
    snowDays: q3(rows.map((r) => r.snow)),
  };
}

export type ClimRange = { years: number; pAnyRain: number; pAnySnow: number; rainDays: number; snowDays: number; hi: number; lo: number };

/** The same dates in each past year: how many had rain or snow, and how warm. `daily` may hold many years' windows. */
export function climRange(daily: Daily, from: string, to: string): ClimRange | null {
  const idx = new Map(daily.time.map((t, i) => [t, i]));
  const len = daysBetween(from, to) + 1;
  const years: { rain: number; snow: number; hi: number[]; lo: number[] }[] = [];
  for (let k = 1; k <= 60; k++) {
    const start = `${Number(from.slice(0, 4)) - k}${from.slice(4) === '-02-29' ? '-02-28' : from.slice(4)}`;
    const ds = Array.from({ length: len }, (_, i) => addDays(start, i));
    const rows = ds.map((d) => idx.get(d)).filter((i): i is number => i != null);
    if (rows.length < len) continue;
    const tx = rows.map((i) => daily.temperature_2m_max[i]);
    const tn = rows.map((i) => daily.temperature_2m_min[i]);
    const r = rows.map((i) => daily.rain_sum[i] ?? daily.precipitation_sum[i]);
    if (![...r, ...tx, ...tn].every(num)) continue;
    years.push({
      rain: (r as number[]).filter((x) => x >= RAIN_MM).length,
      snow: rows.filter((i) => (daily.snowfall_sum[i] ?? 0) >= SNOW_CM).length,
      hi: tx as number[],
      lo: tn as number[],
    });
  }
  if (years.length < 5) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    years: years.length,
    pAnyRain: pct(years.filter((y) => y.rain > 0).length, years.length),
    pAnySnow: pct(years.filter((y) => y.snow > 0).length, years.length),
    rainDays: mean(years.map((y) => y.rain)),
    snowDays: mean(years.map((y) => y.snow)),
    hi: mean(years.flatMap((y) => y.hi)),
    lo: mean(years.flatMap((y) => y.lo)),
  };
}

/** Days with something to show: a range of a week or more as it is, a shorter one inside a 10-day window around it. */
export function cardDays(today: string, from: string, to: string, horizon = 34, count = 10): string[] {
  const len = daysBetween(from, to) + 1;
  if (len >= 7) return Array.from({ length: len }, (_, i) => addDays(from, i));
  let start = addDays(from, -Math.floor((count - len) / 2));
  if (start < today) start = today;
  if (daysBetween(today, addDays(start, count - 1)) > horizon) start = addDays(today, horizon - count + 1);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** For each past year, the window of daily data the normals need: the shown days ±`pad`, wholly in ERA5's past. */
export function climateWindows(days: string[], today: string, years = 20, pad = 7, lag = 6): Window[] {
  const first = addDays(days[0], -pad);
  const last = addDays(days.at(-1)!, pad);
  const lastTruth = addDays(today, -lag);
  const shift = (iso: string, k: number) => `${Number(iso.slice(0, 4)) - k}${iso.slice(4) === '-02-29' ? '-02-28' : iso.slice(4)}`;
  const out: Window[] = [];
  for (let k = 1; out.length < years && k < 80; k++) {
    const w = { start: shift(first, k), end: shift(last, k) };
    if (w.end <= lastTruth) out.push(w);
  }
  return out.reverse();
}
