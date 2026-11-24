// Draws the forecast card as one self-contained SVG string. The same SVG is shown on the page and rasterized for
// "Save image", so the two always match. SVG has no text wrapping, so lines are broken here with a measuring function.
import type { CardData, Lang } from './fetch';
import { LEADS, daysBetween, type DayStat } from './stats';
import { T, dayLabel, md, seasonLabel, verdict, weekday } from './text';

export type Units = 'F' | 'C';
/** Width in px of `text` at `size` px; `face` picks the display or body font. */
export type Measure = (text: string, size: number, weight: number, face: 'display' | 'body') => number;
export type Fonts = { display: string; body: string };

export const CARD_W = 440;
const PAD = 20;
const BOX = 14;
const INNER = CARD_W - 2 * PAD - 2 * BOX;
const C = {
  bg: '#f6f1e9',
  box: '#fbf8f2',
  fg: '#22201c',
  muted: '#6e675d',
  rule: '#e2d9cb',
  accent: '#b4532a',
  zero: '#efe9de',
  s1: '#2a78d6',
  s2: '#eb6834',
  bar: '#b4532a',
};
// one hue, light → dark, for chances (validated reference blue ramp)
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];
const CJK = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "WenQuanYi Zen Hei"';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Break `text` into lines no wider than `max`: Chinese wraps between characters, other text between words. */
export function wrap(text: string, max: number, width: (s: string) => number): string[] {
  const toks = text.match(/[　-〿㐀-鿿＀-￯]|[^\s　-〿㐀-鿿＀-￯]+\s*|\s+/g) ?? [];
  const lines: string[] = [];
  let cur = '';
  for (const t of toks) {
    const noBreakBefore = /^[，。、；：！？）」』%]/.test(t);
    if (cur.trim() && !noBreakBefore && width(cur + t.trimEnd()) > max) {
      lines.push(cur.trimEnd());
      cur = t.trimStart();
    } else cur += t;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

export function renderCard(d: CardData, lang: Lang, units: Units, measure: Measure, fonts: Fonts): { svg: string; height: number } {
  const L = T[lang];
  const zh = lang === 'zh';
  const body = `${fonts.body}, ${CJK}, system-ui, sans-serif`;
  const display = zh ? body : `${fonts.display}, Georgia, serif`;
  const temp = (c: number) => (units === 'F' ? (c * 9) / 5 + 32 : c);
  const fmt = {
    temp: (c: number) => `${Math.round(temp(c))}°${units}`,
    delta: (c: number) => `${Math.round(units === 'F' ? (c * 9) / 5 : c)}°${units}`,
  };
  const v = verdict(d, lang, fmt);
  const out: string[] = [];
  let y = PAD;

  const text = (x: number, yy: number, s: string, size: number, o: { weight?: number; fill?: string; anchor?: string; face?: 'display' | 'body' } = {}) =>
    out.push(
      `<text x="${r1(x)}" y="${r1(yy)}" font-family="${esc(o.face === 'display' ? display : body)}" font-size="${size}" font-weight="${o.weight ?? 400}"` +
        ` fill="${o.fill ?? C.fg}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`,
    );
  const para = (x: number, s: string, size: number, lh: number, max: number, o: { weight?: number; fill?: string; face?: 'display' | 'body' } = {}) => {
    for (const line of wrap(s, max, (t) => measure(t, size, o.weight ?? 400, o.face ?? 'body'))) {
      y += lh;
      text(x, y - (lh - size) / 2 - 2, line, size, o);
    }
  };
  /** A rounded panel; `draw` adds its contents and moves `y`. */
  const panel = (title: string, sub: string | null, draw: (x: number) => void) => {
    y += 14;
    const top = y;
    const idx = out.length;
    y += BOX;
    para(PAD + BOX, title, 15, 21, INNER, { weight: 600 });
    if (sub) para(PAD + BOX, sub, 11, 16, INNER, { fill: C.muted });
    y += 8;
    draw(PAD + BOX);
    y += BOX - 2;
    out.splice(idx, 0, `<rect x="${PAD}" y="${top}" width="${CARD_W - 2 * PAD}" height="${y - top}" rx="14" fill="${C.box}" stroke="${C.rule}"/>`);
  };

  // header
  const place = d.place.detail ? `${d.place.name} · ${d.place.detail}` : d.place.name;
  const lead = daysBetween(d.today, d.target);
  para(PAD, `${place} · ${L.forecastFrom(d.today, lead)}`, 12, 17, CARD_W - 2 * PAD, { fill: C.muted });
  y += 4;
  v.headline.forEach((h, i) => para(PAD, h, zh ? 25 : 27, zh ? 34 : 33, CARD_W - 2 * PAD, { weight: zh ? 700 : 500, face: 'display', fill: i ? C.accent : C.fg }));
  y += 6;
  if (v.lede) para(PAD, v.lede, 13.5, 21, CARD_W - 2 * PAD, { fill: '#3d3a34' });

  // the target day vs normal
  const t = d.atTarget;
  const normal = d.clim?.[d.target];
  if (t) {
    panel(zh ? `${dayLabel(d.target, lang)}当天` : `On ${dayLabel(d.target, lang)}`, null, (x) => {
      const snowy = t.pSnow >= 5 || (normal?.pSnow ?? 0) >= 5;
      const tiles: [string, string, string, string][] = [
        [L.tiles.wet, `${t.pWet}`, '%', normal ? `${L.tiles.normal} ${normal.pWet}%` : ''],
        snowy ? [L.tiles.snow, `${t.pSnow}`, '%', normal ? `${L.tiles.normal} ${normal.pSnow}%` : ''] : [L.tiles.heavy, `${t.pHeavy}`, '%', normal ? `${L.tiles.normal} ${normal.pHeavy}%` : ''],
        [L.tiles.hi, `${Math.round(temp(t.hi[1]))}`, `°${units}`, normal ? `${L.tiles.normal} ${fmt.temp(normal.hi)}` : ''],
        [L.tiles.lo, `${Math.round(temp(t.lo[1]))}`, `°${units}`, normal ? `${L.tiles.normal} ${fmt.temp(normal.lo)}` : ''],
      ];
      const tw = (INNER - 8) / 2;
      const th = 74;
      tiles.forEach(([label, val, unit, sub], i) => {
        const tx = x + (i % 2) * (tw + 8);
        const ty = y + Math.floor(i / 2) * (th + 8);
        out.push(`<rect x="${r1(tx)}" y="${ty}" width="${r1(tw)}" height="${th}" rx="10" fill="#fff" stroke="${C.rule}"/>`);
        text(tx + 10, ty + 18, label, 11, { fill: C.muted });
        text(tx + 10, ty + 48, val, 28, { weight: 700 });
        text(tx + 12 + measure(val, 28, 700, 'body'), ty + 48, unit, 13, { weight: 500 });
        if (sub) text(tx + 10, ty + 65, sub, 11, { fill: C.muted });
      });
      y += 2 * th + 8;
    });
  }

  // chance strip: one row per model, plus normal
  const strip = (title: string, sub: string, field: 'pWet' | 'pSnow', climField: 'pWet' | 'pSnow') =>
    panel(title, sub, (x) => {
      const lab = 74;
      const cw = (INNER - lab) / d.days.length;
      const rowh = 28;
      d.days.forEach((day, i) => {
        const cx = x + lab + cw * (i + 0.5);
        const pick = day === d.target;
        const o = { fill: pick ? C.accent : C.muted, weight: pick ? 700 : 400, anchor: 'middle' };
        text(cx, y + 10, weekday(day, lang).replace('周', ''), 10, o);
        text(cx, y + 23, md(day, 'zh'), 9.5, o);
      });
      y += 32;
      const rows: { name: string; org: string; vals: (number | null)[]; normal?: boolean }[] = d.models.map((m) => ({
        name: m.name,
        org: m.org[lang],
        vals: d.days.map((day) => m.byDay[day]?.[field] ?? null),
      }));
      if (d.clim) rows.push({ name: L.normalRow[0], org: L.normalRow[1], vals: d.days.map((day) => d.clim![day][climField]), normal: true });
      const ti = d.days.indexOf(d.target);
      if (ti >= 0)
        out.push(`<rect x="${r1(x + lab + cw * ti - 1)}" y="${y - 3}" width="${r1(cw + 2)}" height="${rows.length * (rowh + 2) + 4}" rx="6" fill="none" stroke="${C.accent}" stroke-width="1.6"/>`);
      rows.forEach((row) => {
        text(x, y + 12, row.name, 11, { weight: 700 });
        text(x, y + 24, row.org, 9, { fill: C.muted });
        row.vals.forEach((val, i) => {
          const cx = x + lab + cw * i;
          if (row.normal) {
            out.push(`<rect x="${r1(cx + 1)}" y="${y}" width="${r1(cw - 2)}" height="${rowh}" rx="4" fill="none" stroke="${C.rule}" stroke-dasharray="3 2"/>`);
            text(cx + cw / 2, y + rowh / 2 + 4, String(val), 10.5, { fill: C.muted, anchor: 'middle' });
            return;
          }
          const fill = val == null ? '#f4f0e8' : val === 0 ? C.zero : RAMP[Math.min(10, Math.round(val / 10))];
          const ink = val != null && val >= 45 ? '#fff' : val ? C.fg : C.muted;
          out.push(`<rect x="${r1(cx + 1)}" y="${y}" width="${r1(cw - 2)}" height="${rowh}" rx="4" fill="${fill}"/>`);
          text(cx + cw / 2, y + rowh / 2 + 4, val == null ? '–' : String(val), 10.5, { fill: ink, anchor: 'middle', weight: 500 });
        });
        y += rowh + 2;
      });
    });

  const members = Math.max(...d.days.map((day) => d.pooled[day]?.n ?? 0));
  strip(L.stripTitle, L.stripSub(members), 'pWet', 'pWet');
  if (Math.max(...d.days.map((day) => d.pooled[day]?.pSnow ?? 0)) >= 10) strip(L.snowTitle, '', 'pSnow', 'pSnow');

  // highs and lows: median of everything, normal high as a tick
  panel(`${L.tempTitle} (°${units})`, L.tempSub, (x) => {
    const lab = 74;
    const cw = (INNER - lab) / d.days.length;
    const stats = d.days.map((day) => d.pooled[day] as DayStat | undefined);
    const vals = stats.flatMap((s) => (s ? [temp(s.hi[1]), temp(s.lo[1])] : [])).concat(d.clim ? d.days.map((day) => temp(d.clim![day].hi)) : []);
    const step = units === 'F' ? 10 : 5;
    const lo = Math.floor(Math.min(...vals) / step) * step;
    const hi = Math.ceil(Math.max(...vals) / step) * step;
    const H = 130;
    const top = y + 20;
    const yy = (v: number) => top + ((hi - v) / (hi - lo || 1)) * (H - 34);
    for (let g = lo; g <= hi; g += step) {
      out.push(`<line x1="${x + lab - 6}" x2="${x + INNER}" y1="${r1(yy(g))}" y2="${r1(yy(g))}" stroke="${C.rule}"/>`);
      text(x + lab - 10, yy(g) + 3.5, `${g}°`, 9.5, { fill: C.muted, anchor: 'end' });
    }
    const frz = units === 'F' ? 32 : 0;
    if (frz > lo && frz < hi) {
      out.push(`<line x1="${x + lab - 6}" x2="${x + INNER}" y1="${r1(yy(frz))}" y2="${r1(yy(frz))}" stroke="#7aa9e0" stroke-dasharray="3 3"/>`);
      text(x, yy(frz) + 3.5, zh ? '结冰线' : 'Freezing', 9.5, { fill: '#4a7fbf' });
    }
    stats.forEach((s, i) => {
      const cx = x + lab + cw * (i + 0.5);
      const pick = d.days[i] === d.target;
      if (d.clim) {
        const n = yy(temp(d.clim[d.days[i]].hi));
        out.push(`<line x1="${r1(cx - 8)}" x2="${r1(cx + 8)}" y1="${r1(n)}" y2="${r1(n)}" stroke="${C.muted}" stroke-width="1.5"/>`);
      }
      if (!s) return;
      const a = yy(temp(s.hi[1]));
      const b = yy(temp(s.lo[1]));
      const tick = d.clim ? yy(temp(d.clim[d.days[i]].hi)) : a;
      out.push(`<rect x="${r1(cx - 4)}" y="${r1(a)}" width="8" height="${r1(Math.max(4, b - a))}" rx="4" fill="${C.bar}" opacity="${pick ? 1 : 0.75}"/>`);
      text(cx, Math.min(a, tick) - 5, String(Math.round(temp(s.hi[1]))), 10, { anchor: 'middle', weight: pick ? 700 : 500 });
      text(cx, b + 13, String(Math.round(temp(s.lo[1]))), 10, { anchor: 'middle', fill: C.muted });
    });
    y += H + 4;
  });

  // past accuracy at this spot, same season
  const s = d.scores;
  panel(L.accTitle, s ? L.accSub(s[0].days, seasonLabel(d, lang)) : L.accNone, (x) => {
    if (!s) return;
    const H = 190;
    const left = 34;
    const right = 112;
    const top = y + 10;
    const lo = 40;
    const xx = (n: number) => x + left + ((n - 1) / 6) * (INNER - left - right);
    const yy = (v: number) => top + ((100 - v) / (100 - lo)) * (H - 40);
    const lead = Math.max(1, daysBetween(d.today, d.target));
    if (lead <= 7) out.push(`<rect x="${r1(xx(lead) - 8)}" y="${top}" width="16" height="${H - 40}" rx="6" fill="${C.accent}" fill-opacity="0.08"/>`);
    for (const g of [40, 60, 80, 100]) {
      out.push(`<line x1="${x + left}" x2="${r1(xx(7) + 8)}" y1="${r1(yy(g))}" y2="${r1(yy(g))}" stroke="${C.rule}"/>`);
      text(x + left - 6, yy(g) + 3.5, `${g}%`, 9.5, { fill: C.muted, anchor: 'end' });
    }
    LEADS.forEach((n) => text(xx(n), top + H - 26, String(n), 9.5, { fill: C.muted, anchor: 'middle' }));
    text((xx(1) + xx(7)) / 2, top + H - 12, L.accX, 10, { fill: C.muted, anchor: 'middle' });
    const base = Math.round(s.reduce((a, r) => a + r.base, 0) / s.length);
    if (base >= lo) {
      out.push(`<line x1="${x + left}" x2="${r1(xx(7))}" y1="${r1(yy(base))}" y2="${r1(yy(base))}" stroke="${C.s1}" stroke-opacity="0.6" stroke-dasharray="4 4"/>`);
    }
    type Pt = readonly [number, number, number];
    const lines = (
      [
        ['wetOk', C.s1, L.saidWet],
        ['dryOk', C.s2, L.saidDry],
      ] as const
    )
      .map(([key, color, label]) => ({
        color,
        label,
        pts: s.filter((r) => r[key] != null).map((r) => [xx(r.lead), yy(r[key] as number), r[key] as number] as Pt),
      }))
      .filter((l) => l.pts.length);
    // labels go above the higher line and below the lower one, wherever the lines actually are
    const above = (l: (typeof lines)[number], i: number) => lines.every((o) => o === l || !o.pts[i] || l.pts[i][1] <= o.pts[i][1]);
    const legendY: number[] = [];
    // the lower line's legend is placed second, so it can be pushed clear of the higher one's
    [...lines]
      .sort((a, b) => a.pts.at(-1)![1] - b.pts.at(-1)![1])
      .forEach((l) => {
        out.push(`<polyline points="${l.pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ')}" fill="none" stroke="${l.color}" stroke-width="2"/>`);
        l.pts.forEach((p) => out.push(`<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="3.5" fill="${l.color}" stroke="${C.box}" stroke-width="2"/>`));
        const first = l.pts[0];
        const last = l.pts.at(-1)!;
        const upFirst = above(l, 0);
        const upLast = above(l, l.pts.length - 1);
        text(first[0] + 4, first[1] + (upFirst ? -8 : 16), `${first[2]}%`, 10, { weight: 700 });
        text(last[0] - 4, last[1] + (upLast ? -8 : 16), `${last[2]}%`, 10, { weight: 700, anchor: 'end' });
        let ly = last[1] + (upLast ? -10 : 10);
        if (legendY.length && ly - legendY[0] < 30) ly = legendY[0] + 30;
        legendY.push(ly);
        out.push(`<circle cx="${r1(last[0] + 14)}" cy="${r1(ly - 3.5)}" r="4" fill="${l.color}"/>`);
        text(last[0] + 21, ly, l.label[0], 10.5);
        text(last[0] + 21, ly + 13, l.label[1], 10.5);
      });
    if (base >= lo) text(x + left + 4, yy(lo) - 6, L.guess(base), 10, { fill: C.muted });
    y += H;
  });

  // footer
  y += 12;
  para(PAD, L.foot, 9.5, 14, CARD_W - 2 * PAD, { fill: C.muted });
  y += 2;
  para(PAD, L.source, 10, 14, CARD_W - 2 * PAD, { fill: C.accent, weight: 600 });
  y += PAD - 4;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${Math.ceil(y)}" width="${CARD_W}" height="${Math.ceil(y)}" role="img" aria-label="${esc(v.headline.join('. '))}">` +
    `<rect width="100%" height="100%" fill="${C.bg}"/>${out.join('')}</svg>`;
  return { svg, height: Math.ceil(y) };
}
