import { describe, expect, it } from 'vitest';
import { averageScores, cardDays, climRange, climateWindows, climatology, memberSeries, mergeHourly, memberDays, rangeStat, scoreLeads, seasonWindows, summarize, type Hourly } from './stats';

/** Hourly block for `days` local days starting at `start`, with `fill(var, member, dayIndex, hour)` values. */
function hourly(start: string, days: number, vars: string[], members: string[], fill: (v: string, m: string, d: number, h: number) => number | null): Hourly {
  const time: string[] = [];
  for (let d = 0; d < days; d++) {
    const iso = new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) time.push(`${iso}T${String(h).padStart(2, '0')}:00`);
  }
  const out = { time } as Hourly;
  for (const v of vars)
    for (const m of members) out[`${v}${m}`] = time.map((_, i) => fill(v, m, Math.floor(i / 24), i % 24));
  return out;
}

describe('ensemble days', () => {
  const members = ['', '_member01', '_member02', '_member03'];
  // member k gets k mm of rain per hour on day 0 and nothing on day 1; temperatures climb through the day
  const h = hourly('2026-12-01', 2, ['temperature_2m', 'precipitation', 'snowfall'], members, (v, m, d, hr) => {
    const k = members.indexOf(m);
    if (v === 'temperature_2m') return hr - 5 + k;
    if (v === 'precipitation') return d === 0 ? k * 0.05 : 0; // 0, 1.2, 2.4, 3.6 mm
    return d === 0 && k === 3 ? 0.1 : 0; // member 3 also gets 2.4 cm of snow
  });

  it('totals each member per day', () => {
    const md = memberDays(h);
    expect([...md.keys()]).toEqual(['2026-12-01', '2026-12-02']);
    const day0 = md.get('2026-12-01')!;
    expect(day0.map((m) => +m.p.toFixed(6))).toEqual([0, 1.2, 2.4, 3.6]);
    expect(day0[3].sn).toBeCloseTo(2.4);
    // 2.4 cm of snow is ~3.4 mm of water, so member 3's 3.6 mm is nearly all snow
    expect(day0[3].r).toBeCloseTo(3.6 - 2.4 / 0.7);
    expect(day0[2].r).toBeCloseTo(2.4);
    expect(day0[0].tx).toBe(18);
    expect(day0[0].tn).toBe(-5);
  });

  it('turns members into chances and percentiles', () => {
    const s = summarize(memberDays(h).get('2026-12-01')!);
    expect(s.n).toBe(4);
    expect(s.pWet).toBe(75); // three of four members get ≥1 mm of something
    expect(s.pRain).toBe(50); // …but one of those is snow
    expect(s.pSnow).toBe(25);
    expect(s.hi[1]).toBeCloseTo(19.5); // median of 18, 19, 20, 21
  });

  it('skips days with too few hours', () => {
    const short = { ...h, time: h.time.slice(0, 30) } as Hourly;
    expect([...memberDays(short).keys()]).toEqual(['2026-12-01']);
  });
});

describe('season windows', () => {
  it('takes the same weeks in each past year the archive covers, never past ERA5', () => {
    expect(seasonWindows('2026-12-09', '2026-11-24')).toEqual([
      { start: '2024-10-28', end: '2025-01-20' },
      { start: '2025-10-28', end: '2026-01-20' },
      { start: '2026-10-28', end: '2026-11-18' },
    ]);
  });
  it('clips the oldest window to the archive start', () => {
    expect(seasonWindows('2026-01-10', '2026-01-05')[0]).toEqual({ start: '2024-02-01', end: '2024-02-21' });
  });
  it('drops this year when ERA5 has not reached the window yet', () => {
    const w = seasonWindows('2026-07-20', '2026-06-01');
    expect(w.at(-1)!.start.startsWith('2025')).toBe(true);
  });
});

describe('climatology', () => {
  // 30 years, wet every other day, highs 10 °C, lows 2 °C
  const time: string[] = [];
  for (let y = 1996; y <= 2025; y++)
    for (let d = 0; d < 365; d++) time.push(new Date(Date.UTC(y, 0, 1) + d * 86_400_000).toISOString().slice(0, 10));
  const daily = {
    time,
    precipitation_sum: time.map((_, i) => (i % 2 ? 5 : 0)),
    rain_sum: time.map((_, i) => (i % 2 ? 5 : 0)),
    snowfall_sum: time.map(() => 0),
    temperature_2m_max: time.map(() => 10),
    temperature_2m_min: time.map(() => 2),
  };
  it('averages the same calendar days across years', () => {
    const c = climatology(daily, '2026-12-09')!;
    expect(c.n).toBe(30 * 15);
    expect(c.pRain).toBeGreaterThan(45);
    expect(c.pRain).toBeLessThan(55);
    expect(c.hi).toBe(10);
  });
  it('wraps around New Year', () => {
    expect(climatology(daily, '2027-01-02')!.n).toBeGreaterThan(400);
  });
});

describe('scoring past forecasts', () => {
  // truth: wet on even days. Lead 1 always right, lead 2 always says wet.
  const truth = hourly('2025-12-01', 40, ['precipitation', 'temperature_2m'], [''], (v, _m, d) => (v === 'precipitation' ? (d % 2 ? 0 : 0.5) : 5));
  const vars = ['precipitation_previous_day1', 'precipitation_previous_day2', 'temperature_2m_previous_day1', 'temperature_2m_previous_day2'];
  const fc = hourly('2025-12-01', 40, vars, [''], (v, _m, d) => {
    if (v === 'precipitation_previous_day1') return d % 2 ? 0 : 0.5;
    if (v === 'precipitation_previous_day2') return 0.5;
    return v.endsWith('day1') ? 6 : 7;
  });
  const [l1, l2] = scoreLeads(fc, truth, [1, 2]);

  it('scores hits by lead', () => {
    expect(l1).toMatchObject({ lead: 1, days: 40, base: 50, wetOk: 100, dryOk: 100 });
    expect(l1.maeHi).toBeCloseTo(1);
    expect(l2).toMatchObject({ wetOk: 50, dryOk: null }); // never said dry
    expect(l2.maeHi).toBeCloseTo(2);
  });

  it('merges windows and averages models', () => {
    const merged = mergeHourly([fc, fc]);
    expect(merged.time.length).toBe(2 * fc.time.length);
    const avg = averageScores([[l1, l2], [{ ...l1, wetOk: 80 }, l2]])!;
    expect(avg[0].wetOk).toBe(90);
    expect(averageScores([[{ ...l1, days: 3 }]])).toBeNull();
  });
});

describe('card days', () => {
  it('shows a short range inside a 10-day window, starting no earlier than today', () => {
    expect(cardDays('2026-11-24', '2026-12-09', '2026-12-09')[0]).toBe('2026-12-05');
    expect(cardDays('2026-11-24', '2026-11-25', '2026-11-25')[0]).toBe('2026-11-24');
    expect(cardDays('2026-11-24', '2026-12-01', '2026-12-03')).toHaveLength(10);
  });
  it('shows a week or more exactly', () => {
    const d = cardDays('2026-11-24', '2026-12-01', '2026-12-10');
    expect([d[0], d.at(-1), d.length]).toEqual(['2026-12-01', '2026-12-10', 10]);
  });
  it('stays inside the horizon', () => {
    expect(cardDays('2026-11-24', '2026-12-28', '2026-12-28', 34).at(-1)).toBe('2026-12-28');
  });
});

describe('ranges', () => {
  // three members over three days: member k is wet on days < k
  const members = ['', '_member01', '_member02'];
  const h = hourly('2026-12-01', 3, ['temperature_2m', 'precipitation', 'snowfall'], members, (v, m, d) => {
    const k = members.indexOf(m);
    if (v === 'precipitation') return d < k ? 0.1 : 0;
    if (v === 'snowfall') return 0;
    return 5;
  });
  const days = ['2026-12-01', '2026-12-02', '2026-12-03'];

  it('follows each member through the range', () => {
    const r = rangeStat([memberSeries(h)], days)!;
    expect(r.n).toBe(3);
    expect(r.pAnyRain).toBe(67);
    expect(r.rainDays[1]).toBe(1);
    expect(r.pAnySnow).toBe(0);
  });

  it('drops members that miss a day', () => {
    const gappy = { ...h, temperature_2m_member02: (h.temperature_2m_member02 as (number | null)[]).map((v, i) => (i < 10 ? null : v)) } as Hourly;
    expect(rangeStat([memberSeries(gappy)], days)!.n).toBe(2);
  });

  it('counts wet days in the same dates of past years', () => {
    const time: string[] = [];
    for (let y = 2006; y <= 2025; y++) for (let d = 0; d < 10; d++) time.push(`${y}-12-${String(d + 1).padStart(2, '0')}`);
    const daily = {
      time,
      precipitation_sum: time.map((t) => (t.endsWith('-02') ? 3 : 0)), // Dec 2 is always wet
      rain_sum: time.map((t) => (t.endsWith('-02') ? 3 : 0)),
      snowfall_sum: time.map((t) => (t.endsWith('-03') ? 2 : 0)), // and Dec 3 always snowy
      temperature_2m_max: time.map(() => 8),
      temperature_2m_min: time.map(() => 1),
    };
    const c = climRange(daily, '2026-12-01', '2026-12-03')!;
    expect(c).toMatchObject({ years: 20, pAnyRain: 100, rainDays: 1, pAnySnow: 100, snowDays: 1, hi: 8 });
    expect(climRange(daily, '2026-12-05', '2026-12-07')!.pAnyRain).toBe(0);
  });

  it('asks for one window per past year, all of it already in ERA5', () => {
    const w = climateWindows(['2026-12-28', '2027-01-02'], '2026-11-24', 3);
    expect(w).toEqual([
      { start: '2023-12-21', end: '2024-01-09' },
      { start: '2024-12-21', end: '2025-01-09' },
      { start: '2025-12-21', end: '2026-01-09' },
    ]);
  });
});
