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
    stripTitle: 'Chance of rain or snow each day (%)',
    stripSub: (n: number) => `Share of ${n} possible versions of the weather with ≥1 mm. Dashed row: how often these days are wet in a normal year.`,
    snowTitle: 'Chance of snow each day (%)',
    normalRow: ['Normal', '30-year'],
    tempTitle: 'Highs and lows',
    tempSub: 'Median of every possible version; the tick marks a normal high.',
    accTitle: 'Have forecasts here been right?',
    accSub: (days: number, seasons: string) => `Past forecasts at this spot over the same season (${seasons}), ${days} days, checked against what happened. Average of AIFS, IFS and GFS.`,
    accNone: 'Not enough past forecasts here to score yet.',
    accX: 'Days ahead the forecast was made',
    saidWet: ['Said "wet"', '→ was wet'],
    saidDry: ['Said "dry"', '→ stayed dry'],
    guess: (b: number) => `- - Just guessing (blue line): ${b}% of these days are wet`,
    foot: 'Data: Open-Meteo. Ensembles: ECMWF AIFS & IFS (51 members each), NOAA GEFS (31), Canada GEM (21) when past 15 days. Normals and scores use ERA5 reanalysis (≈25 km grid, not a weather station); a day is wet with ≥1 mm.',
    source: 'siweiwang.me/forecast',
    na: 'no forecast this far out',
  },
  zh: {
    forecastFrom: (today: string, lead: number) => `${md(today, 'zh')} 的预报，${lead === 0 ? '今天' : `提前 ${lead} 天`}`,
    tiles: { wet: '下雨或下雪（≥1 毫米）', heavy: '大雨（≥10 毫米）', snow: '积雪（≥1 厘米）', hi: '最高', lo: '最低', normal: '往年' },
    stripTitle: '每天下雨或下雪的概率（%）',
    stripSub: (n: number) => `${n} 种可能的天气里下 ≥1 毫米的比例。虚线一行是往年这几天下雨的比例。`,
    snowTitle: '每天积雪的概率（%）',
    normalRow: ['往年同期', '30 年'],
    tempTitle: '最高 / 最低气温',
    tempSub: '所有可能的中位数，短横线是往年的平均最高温。',
    accTitle: '这里的预报以前准吗？',
    accSub: (days: number, seasons: string) => `在这个点只看往年同季节（${seasons}）共 ${days} 天的预报，和后来实际的天气对照，AIFS、IFS、GFS 取平均。`,
    accNone: '这里过去的预报还不够多，没法打分。',
    accX: '提前几天的预报',
    saidWet: ['说「会下」', '→ 真下了'],
    saidDry: ['说「不下」', '→ 真没下'],
    guess: (b: number) => `- - 随便猜（对比蓝线）：本来 ${b}% 的天会下`,
    foot: '数据：Open-Meteo。集合预报：ECMWF AIFS 和 IFS（各 51 个成员）、NOAA GEFS（31），超过 15 天加上加拿大 GEM（21）。往年和准确率对照 ERA5 再分析（约 25 公里网格，不是站点实测），一天 ≥1 毫米算「下了」。',
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

/** Headline (one or two short lines) and a few sentences, from simple rules on the numbers. */
export function verdict(d: CardData, lang: Lang, fmt: Fmt): { headline: string[]; lede: string } {
  const zh = lang === 'zh';
  const t = d.atTarget;
  const when = dayLabel(d.target, lang);
  const lead = daysBetween(d.today, d.target);
  if (!t) return { headline: [zh ? `${when}：${T.zh.na}` : `${when}: ${T.en.na}`], lede: '' };

  const snowy = t.pSnow >= 30 || (t.pSnow >= 15 && t.pSnow >= 0.6 * t.pWet);
  const p = snowy ? t.pSnow : t.pWet;
  const n = Math.round(p / 10);
  // near freezing and not clearly snow: don't promise either
  const mixed = !snowy && t.hi[1] <= 2;
  const what = snowy ? (zh ? '下雪' : 'snow') : mixed ? (zh ? '下雨或下雪' : 'rain or snow') : zh ? '下雨' : 'rain';
  let precip: string;
  if (p <= 5) precip = zh ? (snowy ? '几乎肯定不下雪' : '几乎肯定不下') : snowy ? 'almost certainly no snow' : 'almost certainly dry';
  else if (p <= 25) precip = zh ? (snowy ? '多半不下雪' : '多半不下') : snowy ? 'probably no snow' : 'probably dry';
  else if (p < 85) precip = zh ? `大约${ZH_NUM[n]}成会${what}` : `about a ${n} in 10 chance of ${what}`;
  else if (p < 95) precip = zh ? `多半会${what}` : `${what} likely`;
  else precip = zh ? `几乎肯定${what}` : `${what} almost certain`;

  const normal = d.clim?.[d.target];
  let temp = '';
  if (normal) {
    const diff = t.hi[1] - normal.hi;
    if (Math.abs(diff) < 1) temp = zh ? '气温跟往年差不多' : 'about as warm as usual';
    else if (zh) temp = `比往年${diff < 0 ? '冷' : '暖'} ${fmt.delta(Math.abs(diff))}`;
    else temp = `${fmt.delta(Math.abs(diff))} ${diff < 0 ? 'colder' : 'warmer'} than usual`;
  } else temp = zh ? `最高 ${fmt.temp(t.hi[1])}` : `high near ${fmt.temp(t.hi[1])}`;

  const headline = zh ? [`${when}${precip}`, temp] : [`${when}: ${precip}`, temp.charAt(0).toUpperCase() + temp.slice(1)];

  const parts: string[] = [];
  const reaching = d.models.filter((m) => m.byDay[d.target]);
  parts.push(
    zh
      ? `${reaching.length} 套集合预报一共 ${t.n} 种可能的天气，${t.pWet}% 会下雨或下雪${t.pSnow >= 5 ? `，${t.pSnow}% 会积雪` : ''}。`
      : `Across ${t.n} possible versions of the weather from ${reaching.length === 1 ? 'one ensemble' : `${reaching.length} ensembles`}, ${t.pWet}% bring rain or snow${t.pSnow >= 5 ? ` and ${t.pSnow}% bring snow` : ''}.`,
  );
  if (normal) parts.push(zh ? `往年这几天 ${normal.pWet}% 下雨。` : `In a normal year ${normal.pWet}% of these days are wet.`);
  const spread = reaching.map((m) => ({ name: m.name, p: m.byDay[d.target].pWet }));
  if (spread.length > 1) {
    const hi = spread.reduce((a, b) => (b.p > a.p ? b : a));
    const lo = spread.reduce((a, b) => (b.p < a.p ? b : a));
    if (hi.p - lo.p >= 30) parts.push(zh ? `模型还对不上：${hi.name} ${hi.p}%，${lo.name} ${lo.p}%。` : `The models disagree: ${hi.name} ${hi.p}%, ${lo.name} ${lo.p}%.`);
  }
  const s = d.scores?.find((x) => x.lead === Math.max(1, lead));
  if (lead <= 7 && s) {
    const wet = t.pWet >= 50;
    const ok = wet ? s.wetOk : s.dryOk;
    if (ok != null)
      parts.push(
        zh
          ? `在这里的同一季节，提前 ${Math.max(1, lead)} 天说「${wet ? '会下' : '不下'}」有 ${ok}% 是对的。`
          : `Here, in this season, forecasts ${Math.max(1, lead)} day${lead > 1 ? 's' : ''} out that said "${wet ? 'wet' : 'dry'}" were right ${ok}% of the time.`,
      );
  } else if (lead > 7) {
    const again = dayLabel(addDays(d.target, -4), lang);
    parts.push(
      zh
        ? `提前 ${lead} 天没法回测（存档只到 7 天），只能当大方向，${again}前后再看一次。`
        : `${lead} days out can't be checked against past forecasts (the archive stops at 7 days), so treat it as a hint and look again around ${again}.`,
    );
  }
  return { headline, lede: parts.join(zh ? '' : ' ') };
}
