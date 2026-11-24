// Forecast card numbers: per-day ensemble probabilities, climatology around a date, and how past forecasts scored at
// a spot over the same season in earlier years. Pure functions on Open-Meteo JSON, so they run in the browser and in tests.

/** Open-Meteo `hourly` block: local ISO times plus one array per variable (ensemble members as `<var>_memberNN`). */
export type Hourly = { time: string[] } & Record<string, (number | null)[] | string[]>;

/** One ensemble member's day. Precipitation in mm, snowfall in cm, temperatures in °C. */
export type MemberDay = { p: number; sn: number; tx: number; tn: number };

/** A day across an ensemble (or several): chances in %, temperature percentiles [p10, p50, p90] in °C. */
export type DayStat = { n: number; pWet: number; pHeavy: number; pSnow: number; hi: [number, number, number]; lo: [number, number, number] };

/** What the same calendar days have been like over past years. */
export type ClimStat = { n: number; pWet: number; pHeavy: number; pSnow: number; hi: number; lo: number };

/** How forecasts made `lead` days ahead did on the scored days. */
export type LeadScore = { lead: number; days: number; base: number; wetOk: number | null; dryOk: number | null; maeHi: number };

export const WET_MM = 1;
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

/** Every member's daily totals and extremes, keyed by local date. Days with fewer than 20 valid hours are left out. */
export function memberDays(h: Hourly): Map<string, MemberDay[]> {
  const suffixes = Object.keys(h)
    .filter((k) => k === 'temperature_2m' || k.startsWith('temperature_2m_member'))
    .map((k) => k.slice('temperature_2m'.length));
  const byDay = new Map<string, number[]>();
  h.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  });
  const out = new Map<string, MemberDay[]>();
  for (const [d, idx] of byDay) {
    const members: MemberDay[] = [];
    for (const s of suffixes) {
      const T = h[`temperature_2m${s}`] as (number | null)[];
      const P = (h[`precipitation${s}`] ?? []) as (number | null)[];
      const S = (h[`snowfall${s}`] ?? []) as (number | null)[];
      const ok = idx.filter((i) => num(T[i]) && num(P[i]));
      if (ok.length < 20) continue;
      members.push({
        p: ok.reduce((a, i) => a + (P[i] as number), 0),
        sn: ok.reduce((a, i) => a + (num(S[i]) ? (S[i] as number) : 0), 0),
        tx: Math.max(...ok.map((i) => T[i] as number)),
        tn: Math.min(...ok.map((i) => T[i] as number)),
      });
    }
    if (members.length) out.set(d, members);
  }
  return out;
}

export function summarize(members: MemberDay[]): DayStat {
  const hi = members.map((m) => m.tx).sort((a, b) => a - b);
  const lo = members.map((m) => m.tn).sort((a, b) => a - b);
  const q = (s: number[]) => [quantile(s, 0.1), quantile(s, 0.5), quantile(s, 0.9)] as [number, number, number];
  return {
    n: members.length,
    pWet: pct(members.filter((m) => m.p >= WET_MM).length, members.length),
    pHeavy: pct(members.filter((m) => m.p >= HEAVY_MM).length, members.length),
    pSnow: pct(members.filter((m) => m.sn >= SNOW_CM).length, members.length),
    hi: q(hi),
    lo: q(lo),
  };
}

/** Climatology for a calendar day: every year's days within ±`halfWidth` days of it. `daily` is an archive `daily` block. */
export function climatology(
  daily: { time: string[]; precipitation_sum: (number | null)[]; snowfall_sum: (number | null)[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] },
  isoDay: string,
  halfWidth = 7,
): ClimStat | null {
  // Feb 29 counts as Feb 28 so every year has the day
  const md = isoDay.slice(5) === '02-29' ? '02-28' : isoDay.slice(5);
  const rows: { p: number; sn: number; tx: number; tn: number }[] = [];
  daily.time.forEach((t, i) => {
    const y = Number(t.slice(0, 4));
    // the same calendar day in this row's year and the years either side, so windows can cross New Year
    const near = [y - 1, y, y + 1].some((yy) => Math.abs(daysBetween(`${yy}-${md}`, t)) <= halfWidth);
    const p = daily.precipitation_sum[i];
    const tx = daily.temperature_2m_max[i];
    const tn = daily.temperature_2m_min[i];
    if (near && num(p) && num(tx) && num(tn)) rows.push({ p, sn: daily.snowfall_sum[i] ?? 0, tx, tn });
  });
  if (rows.length < 30) return null;
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  return {
    n: rows.length,
    pWet: pct(rows.filter((r) => r.p >= WET_MM).length, rows.length),
    pHeavy: pct(rows.filter((r) => r.p >= HEAVY_MM).length, rows.length),
    pSnow: pct(rows.filter((r) => r.sn >= SNOW_CM).length, rows.length),
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

/** The days the card shows: 10 days around the target, kept inside what the forecasts cover. */
export function cardDays(today: string, target: string, horizon = 34, count = 10): string[] {
  let start = addDays(target, -4);
  if (start < today) start = today;
  if (daysBetween(today, addDays(start, count - 1)) > horizon) start = addDays(today, horizon - count + 1);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
