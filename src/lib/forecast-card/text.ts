// Forecast card wording in English and Chinese, and the rules that turn the numbers into a short verdict (no LLM).
import type { CardData, Lang } from './fetch';
import { addDays, daysBetween } from './stats';

const WD = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZH_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const md = (iso: string, lang: Lang) => (lang === 'zh' ? `${+iso.slice(5, 7)}/${+iso.slice(8)}` : `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`);
export const weekday = (iso: string, lang: Lang) => WD[lang][dow(iso)];
/** "Wed, Dec 9" / "12/9（周三）" */
export const dayLabel = (iso: string, lang: Lang) => (lang === 'zh' ? `${md(iso, lang)}（${weekday(iso, lang)}）` : `${weekday(iso, lang)}, ${md(iso, lang)}`);

export const T = {
  en: {
    forecastFrom: (today: string, lead: number) => `Forecast from ${md(today, 'en')}, ${lead === 0 ? 'for today' : `${lead} day${lead === 1 ? '' : 's'} ahead`}`,
    tiles: { wet: 'Rain or snow (≥1 mm)', heavy: 'Heavy (≥10 mm)', snow: 'Snow (≥1 cm)', hi: 'High', lo: 'Low', normal: 'Normal' },
    rangeTiles: { anyWet: 'At least one wet day', wetDays: 'Wet days', anySnow: 'At least one snowy day', his: 'Highs', los: 'Lows', of: (n: number) => ` of ${n}`, normal: 'Normal' },
    rangeLabel: (a: string, b: string) => `${md(a, 'en')}–${md(b, 'en')}`,
    onRange: (a: string, b: string) => `${weekday(a, 'en')}, ${md(a, 'en')} – ${weekday(b, 'en')}, ${md(b, 'en')}`,
    climLoading: 'Loading normals…',
    climFailed: "Couldn't load the normals just now.",
    accLoading: 'Checking past forecasts at this spot…',
    accFailed: "Couldn't load past forecasts just now: the free weather service limits how much each visitor can ask for per minute. Try again in a minute.",
    stripTitle: 'Chance of rain or snow each day (%)',
    stripSub: (n: number) => `Share of ${n} possible versions of the weather with ≥1 mm. Dashed row: how often these days are wet in a normal year.`,
    snowTitle: 'Chance of snow each day (%)',
    normalRow: ['Normal', '20-year'],
    tempTitle: 'Highs and lows',
    tempSub: 'Median of every possible version; the tick marks a normal high.',
    accTitle: 'Have forecasts here been right?',
    accSub: (days: number, seasons: string) => `Past forecasts at this spot over the same season (${seasons}), ${days} days, checked against what happened. Average of AIFS, IFS and GFS.`,
    accNone: 'Not enough past forecasts here to score yet.',
    accX: 'Days ahead the forecast was made',
    saidWet: ['Said "wet"', '→ was wet'],
    saidDry: ['Said "dry"', '→ stayed dry'],
    guess: (b: number) => `- - Just guessing (blue line): ${b}% of these days are wet`,
    foot: 'Data: Open-Meteo. Ensembles: ECMWF AIFS & IFS (51 members each), NOAA GEFS (31), Canada GEM (21) past 15 days. Normals (20 years) and scores use ERA5 reanalysis (≈25 km grid, not a weather station); a day is wet with ≥1 mm.',
    source: 'siweiwang.me/forecast',
    na: 'no forecast this far out',
  },
  zh: {
    forecastFrom: (today: string, lead: number) => `${md(today, 'zh')} 的预报，${lead === 0 ? '今天' : `提前 ${lead} 天`}`,
    tiles: { wet: '下雨或下雪（≥1 毫米）', heavy: '大雨（≥10 毫米）', snow: '积雪（≥1 厘米）', hi: '最高', lo: '最低', normal: '往年' },
    rangeTiles: { anyWet: '至少一天下雨或下雪', wetDays: '下雨的天数', anySnow: '至少一天积雪', his: '最高', los: '最低', of: (n: number) => ` / ${n} 天`, normal: '往年' },
    rangeLabel: (a: string, b: string) => `${md(a, 'zh')}–${md(b, 'zh')}`,
    onRange: (a: string, b: string) => `${md(a, 'zh')}（${weekday(a, 'zh')}）到 ${md(b, 'zh')}（${weekday(b, 'zh')}）`,
    climLoading: '正在加载往年数据…',
    climFailed: '往年数据暂时没拿到。',
    accLoading: '正在回看这里过去的预报…',
    accFailed: '过去的预报暂时没拿到：免费的天气服务限制每个访客每分钟能查多少，过一分钟再试。',
    stripTitle: '每天下雨或下雪的概率（%）',
    stripSub: (n: number) => `${n} 种可能的天气里下 ≥1 毫米的比例。虚线一行是往年这几天下雨的比例。`,
    snowTitle: '每天积雪的概率（%）',
    normalRow: ['往年同期', '20 年'],
    tempTitle: '最高 / 最低气温',
    tempSub: '所有可能的中位数，短横线是往年的平均最高温。',
    accTitle: '这里的预报以前准吗？',
    accSub: (days: number, seasons: string) => `在这个点只看往年同季节（${seasons}）共 ${days} 天的预报，和后来实际的天气对照，AIFS、IFS、GFS 取平均。`,
    accNone: '这里过去的预报还不够多，没法打分。',
    accX: '提前几天的预报',
    saidWet: ['说「会下」', '→ 真下了'],
    saidDry: ['说「不下」', '→ 真没下'],
    guess: (b: number) => `- - 随便猜（对比蓝线）：本来 ${b}% 的天会下`,
    foot: '数据：Open-Meteo。集合预报：ECMWF AIFS 和 IFS（各 51 个成员）、NOAA GEFS（31），超过 15 天加上加拿大 GEM（21）。往年（20 年）和准确率对照 ERA5 再分析（约 25 公里网格，不是站点实测），一天 ≥1 毫米算「下了」。',
    source: 'siweiwang.me/forecast',
    na: '预报还到不了',
  },
};

/** "Nov 24–Jan 20 in 2024–25 and 2025–26" style label for the scored windows. */
export function seasonLabel(d: CardData, lang: Lang): string {
  if (!d.seasons.length) return '';
  const w = d.seasons[0];
  const years = [...new Set(d.seasons.map((s) => s.start.slice(0, 4)))];
  const span = `${md(w.start, lang)}–${md(w.end, lang)}`;
  return lang === 'zh' ? `${span}，${years[0]}–${years.at(-1)} 年` : `${span}, ${years[0]}–${years.at(-1)}`;
}

type Fmt = { temp: (c: number) => string; delta: (c: number) => string };

const nearestScore = (d: CardData, lead: number) =>
  d.scores?.reduce((best, x) => (Math.abs(x.lead - lead) < Math.abs(best.lead - lead) ? x : best), d.scores[0]);

/** "rain", "snow" or "rain or snow": snow when the members say so, neither promised near freezing. */
function precipWord(lang: Lang, pWet: number, pSnow: number, hi: number) {
  const zh = lang === 'zh';
  const snowy = pSnow >= 30 || (pSnow >= 15 && pSnow >= 0.6 * pWet);
  const mixed = !snowy && hi <= 2;
  return { snowy, what: snowy ? (zh ? '下雪' : 'snow') : mixed ? (zh ? '下雨或下雪' : 'rain or snow') : zh ? '下雨' : 'rain' };
}

function tempLine(lang: Lang, fmt: Fmt, hi: number, normalHi: number | undefined) {
  const zh = lang === 'zh';
  if (normalHi == null) return zh ? `最高 ${fmt.temp(hi)}` : `High near ${fmt.temp(hi)}`;
  const diff = hi - normalHi;
  if (Math.abs(diff) < 1) return zh ? '气温跟往年差不多' : 'About as warm as usual';
  return zh ? `比往年${diff < 0 ? '冷' : '暖'} ${fmt.delta(Math.abs(diff))}` : `${fmt.delta(Math.abs(diff))} ${diff < 0 ? 'colder' : 'warmer'} than usual`;
}

/** The last sentence: how far ahead this is, and what past forecasts here say about trusting it. */
function confidence(d: CardData, lang: Lang, saidWet: boolean): string {
  const zh = lang === 'zh';
  const first = Math.max(1, daysBetween(d.today, d.from));
  const last = daysBetween(d.today, d.to);
  if (first > 7) {
    const again = dayLabel(addDays(d.from, -4), lang);
    return zh
      ? `提前 ${first} 天没法回测（存档只到 7 天），只能当大方向，${again}前后再看一次。`
      : `${first} days out can't be checked against past forecasts (the archive stops at 7 days), so treat it as a hint and look again around ${again}.`;
  }
  const s = nearestScore(d, first);
  const ok = s && (saidWet ? s.wetOk : s.dryOk);
  let out = '';
  if (ok != null && s)
    out = zh
      ? `在这里的同一季节，提前 ${s.lead} 天说「${saidWet ? '会下' : '不下'}」有 ${ok}% 是对的。`
      : `Here, in this season, forecasts ${s.lead} day${s.lead > 1 ? 's' : ''} out that said "${saidWet ? 'wet' : 'dry'}" were right ${ok}% of the time.`;
  if (last > 7) out += zh ? `${dayLabel(addDays(d.today, 8), lang)}以后的几天还没法回测，只能当大方向。` : `${out ? ' ' : ''}Days from ${md(addDays(d.today, 8), lang)} on can't be checked yet; treat them as a hint.`;
  return out;
}

/** Headline (one or two short lines) and a few sentences, from simple rules on the numbers. */
export function verdict(d: CardData, lang: Lang, fmt: Fmt): { headline: string[]; lede: string } {
  return d.from === d.to ? dayVerdict(d, lang, fmt) : rangeVerdict(d, lang, fmt);
}

function dayVerdict(d: CardData, lang: Lang, fmt: Fmt): { headline: string[]; lede: string } {
  const zh = lang === 'zh';
  const t = d.atDay;
  const when = dayLabel(d.from, lang);
  if (!t) return { headline: [zh ? `${when}：${T.zh.na}` : `${when}: ${T.en.na}`], lede: '' };

  const { snowy, what } = precipWord(lang, t.pWet, t.pSnow, t.hi[1]);
  const p = snowy ? t.pSnow : t.pWet;
  const n = Math.round(p / 10);
  let precip: string;
  if (p <= 5) precip = zh ? (snowy ? '几乎肯定不下雪' : '几乎肯定不下') : snowy ? 'almost certainly no snow' : 'almost certainly dry';
  else if (p <= 25) precip = zh ? (snowy ? '多半不下雪' : '多半不下') : snowy ? 'probably no snow' : 'probably dry';
  else if (p < 85) precip = zh ? `大约${ZH_NUM[n]}成会${what}` : `about a ${n} in 10 chance of ${what}`;
  else if (p < 95) precip = zh ? `多半会${what}` : `${what} likely`;
  else precip = zh ? `几乎肯定${what}` : `${what} almost certain`;

  const normal = d.clim?.[d.from];
  const headline = [zh ? `${when}${precip}` : `${when}: ${precip}`, tempLine(lang, fmt, t.hi[1], normal?.hi)];

  const parts: string[] = [];
  const reaching = d.models.filter((m) => m.byDay[d.from]);
  parts.push(
    zh
      ? `${reaching.length} 套集合预报一共 ${t.n} 种可能的天气，${t.pWet}% 会下雨或下雪${t.pSnow >= 5 ? `，${t.pSnow}% 会积雪` : ''}。`
      : `Across ${t.n} possible versions of the weather from ${reaching.length === 1 ? 'one ensemble' : `${reaching.length} ensembles`}, ${t.pWet}% bring rain or snow${t.pSnow >= 5 ? ` and ${t.pSnow}% bring snow` : ''}.`,
  );
  if (normal) parts.push(zh ? `往年这几天 ${normal.pWet}% 下雨。` : `In a normal year ${normal.pWet}% of these days are wet.`);
  parts.push(disagreement(reaching.map((m) => ({ name: m.name, p: m.byDay[d.from].pWet })), lang));
  parts.push(confidence(d, lang, t.pWet >= 50));
  return { headline, lede: parts.filter(Boolean).join(zh ? '' : ' ') };
}

function disagreement(spread: { name: string; p: number }[], lang: Lang) {
  if (spread.length < 2) return '';
  const hi = spread.reduce((a, b) => (b.p > a.p ? b : a));
  const lo = spread.reduce((a, b) => (b.p < a.p ? b : a));
  if (hi.p - lo.p < 30) return '';
  return lang === 'zh' ? `模型还对不上：${hi.name} ${hi.p}%，${lo.name} ${lo.p}%。` : `The models disagree: ${hi.name} ${hi.p}%, ${lo.name} ${lo.p}%.`;
}

function rangeVerdict(d: CardData, lang: Lang, fmt: Fmt): { headline: string[]; lede: string } {
  const zh = lang === 'zh';
  const r = d.range;
  const L = T[lang];
  const len = daysBetween(d.from, d.to) + 1;
  const when = L.rangeLabel(d.from, d.to);
  if (!r) return { headline: [zh ? `${when}：${L.na}` : `${when}: ${L.na}`], lede: '' };

  const rangeDays = d.days.filter((x) => x >= d.from && x <= d.to);
  const stats = rangeDays.map((x) => d.pooled[x]).filter(Boolean);
  const meanHi = stats.reduce((a, s) => a + s.hi[1], 0) / stats.length;
  const { snowy, what } = precipWord(lang, r.pAnyWet, r.pAnySnow, Math.min(...stats.map((s) => s.hi[1])));
  const a = Math.round(r.wetDays[0]);
  const b = Math.round(r.wetDays[2]);
  const count = a === b ? `${a}` : `${a}–${b}`;
  let precip: string;
  if (r.pAnyWet <= 10) precip = zh ? '几乎肯定一直不下' : 'almost certainly dry throughout';
  else if (r.pAnyWet <= 30) precip = zh ? '多半一直不下' : 'probably dry throughout';
  else if (b === 0) precip = zh ? `可能有一天${what}` : `maybe one day of ${what}`;
  else precip = zh ? `${len} 天里大约 ${count} 天${what}` : `${what} on about ${count} of ${len} days`;
  if (snowy && r.pAnySnow >= 30 && r.pAnyWet > 30) precip += zh ? `（${r.pAnySnow}% 会积雪）` : ` (${r.pAnySnow}% chance of snow)`;

  const headline = [zh ? `${when}：${precip}` : `${when}: ${precip}`, tempLine(lang, fmt, meanHi, d.climRange?.hi)];
  const parts: string[] = [];
  const ens = d.models.filter((m) => m.range).length;
  parts.push(
    zh
      ? `${ens} 套集合预报一共 ${r.n} 种可能的天气，${r.pAnyWet}% 这 ${len} 天里至少有一天下雨或下雪。`
      : `Across ${r.n} possible versions of the weather from ${ens === 1 ? 'one ensemble' : `${ens} ensembles`}, ${r.pAnyWet}% have at least one wet day in these ${len}.`,
  );
  if (d.climRange)
    parts.push(
      zh
        ? `往年同样的 ${len} 天，${d.climRange.pAnyWet}% 的年份至少下一天，平均下 ${d.climRange.wetDays.toFixed(1)} 天。`
        : `In past years ${d.climRange.pAnyWet}% had at least one wet day in the same dates, ${d.climRange.wetDays.toFixed(1)} on average.`,
    );
  parts.push(disagreement(d.models.filter((m) => m.range).map((m) => ({ name: m.name, p: m.range!.pAnyWet })), lang));
  parts.push(confidence(d, lang, r.wetDays[1] >= len / 2));
  return { headline, lede: parts.filter(Boolean).join(zh ? '' : ' ') };
}
