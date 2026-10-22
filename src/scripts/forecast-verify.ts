// "How did the models do?": past forecasts from AIFS, IFS and GFS (Open-Meteo Previous Runs API: the forecast for each
// hour as issued 1–7 days earlier) scored against ERA5 reanalysis, which none of the three models produced.
type City = { id: string; name: string; lat: number; lon: number };
type Model = { key: string; id: string; name: string };
type Scores = {
  days: number;
  mae: Record<string, (number | null)[]>; // per model, lead day 1..7, °C
  daily: { day: string; truth: number; fc: Record<string, number | null> }[]; // daily highs, last 30 days, 5-day lead
};

const MODELS: Model[] = [
  { key: 'aifs', id: 'ecmwf_aifs025_single', name: 'AIFS' },
  { key: 'ifs', id: 'ecmwf_ifs025', name: 'IFS' },
  { key: 'gfs', id: 'gfs_global', name: 'GFS' },
];
const LEADS = [1, 2, 3, 4, 5, 6, 7];
const WINDOW = 60; // days scored
const SHOWN_LEAD = 5;
const NS = 'http://www.w3.org/2000/svg';

const svgEl = (tag: string, attrs: Record<string, string | number> = {}, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const metric = () => document.documentElement.dataset.units === 'metric';
const temp = (c: number) => (metric() ? c : (c * 9) / 5 + 32);
const diff = (c: number) => (metric() ? c : (c * 9) / 5);
const unit = () => (metric() ? '°C' : '°F');

async function getJSON(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function score(city: City): Promise<Scores> {
  const cacheKey = `fxv1-${city.lat.toFixed(2)},${city.lon.toFixed(2)}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(cacheKey) ?? 'null');
    if (c && Date.now() - c.t < 6 * 3600_000) return c.s;
  } catch {}

  const q = `latitude=${city.lat}&longitude=${city.lon}&timezone=GMT`;
  // ERA5 lags real time by about 6 days: find the last day it has, and score the WINDOW days before that
  const probeEnd = Date.now() - 86_400_000;
  const era = await getJSON(
    `https://archive-api.open-meteo.com/v1/archive?${q}&models=era5&hourly=temperature_2m` +
      `&start_date=${iso(probeEnd - (WINDOW + 12) * 86_400_000)}&end_date=${iso(probeEnd)}`,
  );
  const truth = new Map<string, number>();
  era.hourly.time.forEach((t: string, i: number) => era.hourly.temperature_2m[i] != null && truth.set(t, era.hourly.temperature_2m[i]));
  const lastDay = [...truth.keys()].filter((t) => t.endsWith('23:00')).at(-1)!.slice(0, 10);
  const firstDay = iso(+new Date(`${lastDay}T00:00Z`) - (WINDOW - 1) * 86_400_000);

  const vars = ['temperature_2m', ...LEADS.map((d) => `temperature_2m_previous_day${d}`)].join(',');
  const runs = await Promise.all(
    MODELS.map((m) =>
      getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${q}&models=${m.id}&hourly=${vars}&start_date=${firstDay}&end_date=${lastDay}`),
    ),
  );

  // only hours where every model has a forecast at every lead, so the comparison is fair
  const times: string[] = runs[0].hourly.time;
  const ok = times.map(
    (t, i) => truth.has(t) && runs.every((r) => LEADS.every((d) => r.hourly[`temperature_2m_previous_day${d}`][i] != null)),
  );
  const mae: Scores['mae'] = {};
  MODELS.forEach((m, mi) => {
    mae[m.key] = LEADS.map((d) => {
      const f = runs[mi].hourly[`temperature_2m_previous_day${d}`];
      let sum = 0;
      let n = 0;
      times.forEach((t, i) => {
        if (ok[i]) {
          sum += Math.abs(f[i] - truth.get(t)!);
          n++;
        }
      });
      return n ? sum / n : null;
    });
  });

  // daily highs (UTC days) for the last 30 days, forecast issued SHOWN_LEAD days ahead
  const daily: Scores['daily'] = [];
  const byDay = Map.groupBy(
    times.map((t, i) => ({ t, i })),
    ({ t }) => t.slice(0, 10),
  );
  for (const [day, hours] of [...byDay].slice(-30)) {
    const tv = hours.map(({ t }) => truth.get(t)).filter((v): v is number => v != null);
    if (tv.length < 24) continue;
    const fc: Record<string, number | null> = {};
    MODELS.forEach((m, mi) => {
      const f = hours.map(({ i }) => runs[mi].hourly[`temperature_2m_previous_day${SHOWN_LEAD}`][i]).filter((v: number | null) => v != null);
      fc[m.key] = f.length === 24 ? Math.max(...f) : null;
    });
    daily.push({ day, truth: Math.max(...tv), fc });
  }

  const s: Scores = { days: new Set(times.filter((_, i) => ok[i]).map((t) => t.slice(0, 10))).size, mae, daily };
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), s }));
  } catch {}
  return s;
}

class ForecastVerify extends HTMLElement {
  city!: City;
  scores: Scores | null = null;
  token = 0;
  started = false;

  connectedCallback() {
    this.city = JSON.parse(this.dataset.city!);
    document.addEventListener('fx-city', (e) => this.setCity((e as CustomEvent<City>).detail));
    document.addEventListener('fx-pick', (e) => {
      const { lat, lon } = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      this.setCity({ id: 'pin', name: 'the spot you picked', lat, lon });
    });
    document.addEventListener('unitschange', () => this.render());
    new MutationObserver(() => this.render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-effective-theme'] });
    new ResizeObserver(() => this.render()).observe(this.querySelector('[data-mae]')!);
    // load only when scrolled near
    new IntersectionObserver(
      (entries, io) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          this.started = true;
          this.load();
        }
      },
      { rootMargin: '400px' },
    ).observe(this);
  }

  setCity(c: City) {
    this.city = c;
    if (this.started) this.load();
  }

  async load() {
    const token = ++this.token;
    this.status('Scoring the last two months of forecasts…');
    try {
      const s = await score(this.city);
      if (token !== this.token) return;
      this.scores = s;
      this.render();
    } catch {
      if (token === this.token) this.status('Couldn’t load past forecasts right now.');
    }
  }

  status(text: string) {
    this.scores = null;
    this.querySelector('[data-finding]')!.textContent = text;
    this.querySelector('[data-mae]')!.replaceChildren();
    this.querySelector('[data-daily]')!.replaceChildren();
    this.querySelector('[data-table]')!.replaceChildren();
  }

  render() {
    const s = this.scores;
    if (!s) return;
    const at5 = MODELS.map((m) => ({ m, v: s.mae[m.key][SHOWN_LEAD - 1] })).filter((x) => x.v != null) as { m: Model; v: number }[];
    const best = [...at5].sort((a, b) => a.v - b.v);
    const fmt = (c: number) => `${diff(c).toFixed(1)}${unit()}`;
    this.querySelector('[data-finding]')!.innerHTML =
      best.length >= 2
        ? `Over the last ${s.days} days in ${this.city.name}, <strong>${best[0].m.name}</strong>’s 5-day forecasts were off by ` +
          `${fmt(best[0].v)} on average, vs ${best.slice(1).map((b) => `${fmt(b.v)} for ${b.m.name}`).join(' and ')}.`
        : '';
    this.drawMae(s);
    this.drawDaily(s);
    this.drawTable(s);
  }

  drawMae(s: Scores) {
    const box = this.querySelector<HTMLElement>('[data-mae]')!;
    const W = Math.max(280, box.clientWidth);
    const H = 240;
    const m = { l: 44, r: 56, t: 16, b: 36 };
    const all = MODELS.flatMap((x) => s.mae[x.key]).filter((v): v is number => v != null).map(diff);
    const top = Math.ceil(Math.max(...all) + 0.5);
    const x = (d: number) => m.l + ((d - 1) / (LEADS.length - 1)) * (W - m.l - m.r);
    const y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Average error by forecast lead time' });
    for (let v = 0; v <= top; v += top > 6 ? 2 : 1) {
      svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(svgEl('text', { x: m.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, `${v}°`));
    }
    LEADS.forEach((d) => svg.append(svgEl('text', { x: x(d), y: H - m.b + 20, class: 'axis', 'text-anchor': 'middle' }, `${d} day${d > 1 ? 's' : ''}`)));
    const ends: { name: string; x: number; y: number }[] = [];
    for (const mod of MODELS) {
      const pts = s.mae[mod.key].map((v, i) => (v == null ? null : [x(LEADS[i]), y(diff(v))])).filter(Boolean) as number[][];
      svg.append(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: `line c-${mod.key}` }));
      s.mae[mod.key].forEach((v, i) => {
        if (v == null) return;
        const g = svgEl('g');
        g.append(svgEl('title', {}, `${mod.name}, ${LEADS[i]}-day forecast: off by ${diff(v).toFixed(1)}${unit()} on average`));
        g.append(svgEl('circle', { cx: x(LEADS[i]), cy: y(diff(v)), r: 4, class: `dot c-${mod.key}` }));
        svg.append(g);
      });
      const last = pts.at(-1);
      if (last) ends.push({ name: mod.name, x: last[0] + 10, y: last[1] + 4 });
    }
    // end labels: nudge apart so close lines don't print on top of each other
    ends.sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => i > 0 && (e.y = Math.max(e.y, ends[i - 1].y + 14)));
    ends.forEach((e) => svg.append(svgEl('text', { x: e.x, y: e.y, class: 'label' }, e.name)));
    box.replaceChildren(svg);
  }

  drawDaily(s: Scores) {
    const box = this.querySelector<HTMLElement>('[data-daily]')!;
    const W = Math.max(280, box.clientWidth);
    const H = 240;
    const m = { l: 44, r: 16, t: 16, b: 36 };
    const vals = s.daily.flatMap((d) => [d.truth, ...Object.values(d.fc).filter((v): v is number => v != null)]).map(temp);
    const lo = Math.floor(Math.min(...vals) - 2);
    const hi = Math.ceil(Math.max(...vals) + 2);
    const n = s.daily.length;
    const x = (i: number) => m.l + (i / Math.max(1, n - 1)) * (W - m.l - m.r);
    const y = (v: number) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Daily highs: actual vs 5-day forecasts' });
    const step = Math.max(1, Math.round((hi - lo) / 5));
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(svgEl('text', { x: m.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, `${v}°`));
    }
    const label = (day: string) => new Date(`${day}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i) =>
      svg.append(svgEl('text', { x: x(i), y: H - m.b + 20, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, label(s.daily[i].day))),
    );
    const path = (get: (d: Scores['daily'][number]) => number | null) =>
      s.daily
        .map((d, i) => {
          const v = get(d);
          return v == null ? null : `${x(i)},${y(temp(v))}`;
        })
        .filter(Boolean)
        .join(' ');
    for (const mod of MODELS) svg.append(svgEl('polyline', { points: path((d) => d.fc[mod.key]), class: `line thin c-${mod.key}` }));
    svg.append(svgEl('polyline', { points: path((d) => d.truth), class: 'line truth' }));
    // hover: one column per day
    const tip = this.querySelector<HTMLElement>('[data-tip]')!;
    const cross = svgEl('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' });
    svg.append(cross);
    s.daily.forEach((d, i) => {
      const hit = svgEl('rect', { x: x(i) - (W - m.l - m.r) / n / 2, y: 0, width: (W - m.l - m.r) / n, height: H, class: 'hit' });
      hit.addEventListener('pointerenter', () => {
        cross.setAttribute('x1', String(x(i)));
        cross.setAttribute('x2', String(x(i)));
        cross.setAttribute('visibility', 'visible');
        const rows = MODELS.map((mod) => {
          const v = d.fc[mod.key];
          return `<span><i class="sw c-${mod.key}"></i>${mod.name} <b>${v == null ? '–' : `${Math.round(temp(v))}°`}</b></span>`;
        });
        tip.innerHTML = `<strong>${label(d.day)}</strong><span><i class="sw truth"></i>Actual <b>${Math.round(temp(d.truth))}°</b></span>${rows.join('')}`;
        tip.hidden = false;
        const left = Math.min(Math.max(0, x(i) - tip.offsetWidth / 2), W - tip.offsetWidth);
        tip.style.left = `${left}px`;
      });
      svg.append(hit);
    });
    svg.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    });
    box.replaceChildren(svg);
  }

  drawTable(s: Scores) {
    const t = document.createElement('table');
    t.innerHTML =
      `<thead><tr><th>Lead time</th>${MODELS.map((m) => `<th>${m.name}</th>`).join('')}</tr></thead><tbody>` +
      LEADS.map(
        (d, i) =>
          `<tr><td>${d} day${d > 1 ? 's' : ''}</td>${MODELS.map((m) => {
            const v = s.mae[m.key][i];
            return `<td>${v == null ? '–' : `${diff(v).toFixed(1)}${unit()}`}</td>`;
          }).join('')}</tr>`,
      ).join('') +
      '</tbody>';
    this.querySelector('[data-table]')!.replaceChildren(t);
  }
}

customElements.define('forecast-verify', ForecastVerify);
