import { describe, expect, it } from 'vitest';
import type { CardData } from './fetch';
import type { DayStat } from './stats';
import { verdict } from './text';

const fmt = { temp: (c: number) => `${Math.round(c)}°C`, delta: (c: number) => `${Math.round(c)}°C` };
const day = (o: Partial<DayStat>): DayStat => ({ n: 52, pWet: 40, pHeavy: 5, pSnow: 0, hi: [5, 8, 11], lo: [0, 3, 5], ...o });

function card(o: { target?: Partial<DayStat>; models?: Record<string, number>; today?: string; normalHi?: number; scores?: boolean } = {}): CardData {
  const target = '2026-12-09';
  const t = day(o.target ?? {});
  const models = Object.entries(o.models ?? { GEFS: t.pWet }).map(([name, p]) => ({
    key: name.toLowerCase(),
    name,
    org: { en: '', zh: '' },
    byDay: { [target]: day({ ...o.target, pWet: p }) },
  }));
  return {
    place: { name: 'Seattle', lat: 47.6, lon: -122.3 },
    today: o.today ?? '2026-11-24',
    target,
    days: [target],
    models,
    pooled: { [target]: t },
    atTarget: t,
    clim: { [target]: { n: 450, pWet: 56, pHeavy: 22, pSnow: 3, hi: o.normalHi ?? 10, lo: 4 } },
    scores: o.scores
      ? [1, 2, 3, 4, 5, 6, 7].map((lead) => ({ lead, days: 191, base: 64, wetOk: 90 - lead, dryOk: 80 - lead, maeHi: 1 }))
      : null,
    seasons: [],
  };
}

describe('verdict', () => {
  it('puts the chance in tenths and compares with normal', () => {
    const v = verdict(card({ target: { pWet: 38 } }), 'en', fmt);
    expect(v.headline).toEqual(['Wed, Dec 9: about a 4 in 10 chance of rain', '2°C colder than usual']);
    expect(v.lede).toContain("can't be checked");
  });

  it('says so when the models disagree', () => {
    const v = verdict(card({ target: { pWet: 38 }, models: { GEFS: 52, GEM: 19 } }), 'zh', fmt);
    expect(v.headline[0]).toBe('12/9（周三）大约四成会下雨');
    expect(v.lede).toContain('模型还对不上：GEFS 52%，GEM 19%');
  });

  it('calls snow snow, and stays neutral near freezing', () => {
    expect(verdict(card({ target: { pWet: 80, pSnow: 70, hi: [-5, -3, 0] } }), 'en', fmt).headline[0]).toContain('about a 7 in 10 chance of snow');
    expect(verdict(card({ target: { pWet: 60, pSnow: 20, hi: [-6, -4, -1] } }), 'en', fmt).headline[0]).toContain('rain or snow');
  });

  it('quotes the past hit rate for forecasts a few days out', () => {
    const v = verdict(card({ target: { pWet: 3 }, today: '2026-12-06', scores: true }), 'en', fmt);
    expect(v.headline[0]).toBe('Wed, Dec 9: almost certainly dry');
    expect(v.lede).toContain('forecasts 3 days out that said "dry" were right 77% of the time');
  });
});
