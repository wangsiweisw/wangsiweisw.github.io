// <forecast-map>: a 10-day animated field around the selected city on a Leaflet basemap — temperature, precipitation,
// wind (with moving streaks), 500 hPa height, the 10-day rain total, or AIFS − IFS — with optional isobars and H/L.
// Data from ./fx-data (precomputed in CI, or live from Open-Meteo as a fallback). Loads only when scrolled to.
import type * as Leaflet from 'leaflet';
import { WindParticles } from './wind-particles';
import { contours, extrema, upsample } from './contours';
import { darkness, moonPhase } from './astro';
import { regionFor, sourceFor, type City, type FieldName, type FxSource, type ModelKey } from './fx-data';

type Layer = 'temp' | 'precip' | 'wind' | 'sun' | 'cloud' | 'stars' | 'z500' | 'total' | 'diff';

const MODEL_NAMES: Record<ModelKey, string> = {
  aifs: 'AIFS (ECMWF, machine learning)',
  ifs: 'IFS (ECMWF, physics)',
  gfs: 'GFS (NOAA, physics)',
};
// layers that only the precomputed data has
const PRE_ONLY: Layer[] = ['sun', 'cloud', 'stars', 'z500', 'total'];

// --- color ramps (validated diverging blue ↔ terracotta, sequential blue and teal) ---
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const COLD = ['#0d366b', '#256abf', '#6da7ec', '#b7d3f6'].map(hex);
const WARM = ['#f3c9b4', '#e07a4f', '#b4532a', '#7a3418'].map(hex);
const BLUE = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'].map(hex);
const TEAL = ['#dcefeb', '#9fd1c6', '#5aa898', '#2c7a6b', '#134d43'].map(hex);
// stargazing: overcast grey → clear night-sky navy
const SKY = ['#a3a8b0', '#6d7891', '#3a4a78', '#1b2756', '#0c1438'].map(hex);
const AMBER = ['#fff1cf', '#fbd47e', '#f2ae3d', '#d6831a', '#9a5a0c'].map(hex);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const RAIN_STEPS = [0.1, 0.5, 1, 2.5, 5, 10, 15]; // mm per step
const TOTAL_STEPS = [1, 5, 10, 25, 50, 100, 200]; // mm in 10 days

const lerpRamp = (stops: RGB[], f: number): RGB => {
  const x = Math.max(0, Math.min(1, f)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const t = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * t)) as RGB;
};
/** f in [-1, 1] → color, with a neutral midpoint */
const diverging = (f: number, mid: RGB): RGB => (f < 0 ? lerpRamp([...COLD, mid], 1 + f) : lerpRamp([mid, ...WARM], f));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Stepped bands (like a radar map), each step softened over a narrow range so edges don't look cut out. */
function banded(v: number, steps: number[]): [RGB, number] | null {
  const lv = Math.log(v + 1e-6);
  const SOFT = 0.12; // in log units
  let f = 0;
  let a = 0;
  steps.forEach((x, i) => {
    const w = Math.max(0, Math.min(1, (lv - Math.log(x)) / SOFT + 0.5));
    if (i === 0) a = w;
    else f += w / (steps.length - 1);
  });
  return a > 0 ? [lerpRamp(BLUE, f), a * (95 + 140 * f)] : null;
}

// Web Mercator y, so the overlay lines up with the basemap
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
const wrapLon = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
const pct = (all: number[], p: number) => all[Math.min(all.length - 1, Math.floor(all.length * p))];

class ForecastMap extends HTMLElement {
  L!: typeof Leaflet;
  map!: Leaflet.Map;
  overlay?: Leaflet.ImageOverlay;
  base?: Leaflet.TileLayer;
  dot?: Leaflet.Marker;
  lines?: Leaflet.Polyline;
  centres?: Leaflet.LayerGroup;
  renderer?: Leaflet.Canvas;
  wind?: WindParticles;
  city!: City;
  src: FxSource | null = null;
  data = new Map<string, Float32Array[]>();
  layer: Layer = 'temp';
  model: ModelKey = 'aifs';
  isobars = false;
  night?: Float32Array; // stargazing: how dark it is at each grid point for the current frame
  t = 0;
  playing = 0;
  canvas = document.createElement('canvas');
  range: [number, number] = [0, 1];
  started = false;
  token = 0;

  connectedCallback() {
    const first = document.querySelector<HTMLElement>('forecast-lab');
    this.city = JSON.parse(first?.dataset.cities ?? '[]')[0];
    document.addEventListener('fx-city', (e) => {
      this.city = (e as CustomEvent<City>).detail;
      if (this.started) this.load();
    });
    // load Leaflet + data only when the map scrolls near the viewport
    new IntersectionObserver(
      ([e], obs) => {
        if (e.isIntersecting) (obs.disconnect(), this.start());
      },
      { rootMargin: '200px' },
    ).observe(this);

    this.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) =>
      b.addEventListener('click', () => this.setLayer(b.dataset.layer as Layer)),
    );
    this.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((b) =>
      b.addEventListener('click', () => {
        this.model = b.dataset.model as ModelKey;
        this.querySelectorAll('[data-model]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.update();
      }),
    );
    this.querySelector<HTMLInputElement>('[data-isobars]')!.addEventListener('change', (e) => {
      this.isobars = (e.currentTarget as HTMLInputElement).checked;
      this.update();
    });
    const slider = this.querySelector<HTMLInputElement>('[data-time]')!;
    slider.addEventListener('input', () => {
      this.stop();
      this.t = Number(slider.value);
      this.draw();
    });
    this.querySelector('[data-play]')!.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    document.addEventListener('unitschange', () => (this.computeRange(), this.draw()));
    new MutationObserver(() => this.draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-effective-theme'] });
  }

  setLayer(layer: Layer) {
    this.layer = layer;
    this.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.layer === layer)));
    (this.querySelector('[data-model-group]') as HTMLElement).hidden = layer === 'diff';
    this.wind?.setActive(layer === 'wind');
    // the 10-day total is one picture: no timeline
    const still = layer === 'total';
    if (still) this.stop();
    this.querySelector<HTMLInputElement>('[data-time]')!.disabled = still;
    this.querySelector<HTMLButtonElement>('[data-play]')!.disabled = still;
    // stargazing in daylight shows nothing: jump to the next frame when it's dark at the city
    if (layer === 'stars' && this.src && darkness(this.city.lat, this.city.lon, this.src.time[this.t]) < 0.5) {
      const next = this.src.time.findIndex((t, i) => i > this.t && darkness(this.city.lat, this.city.lon, t) >= 0.5);
      if (next !== -1) this.t = next;
    }
    this.update();
  }

  async start() {
    this.started = true;
    this.L = (await import('leaflet')).default;
    const L = this.L;
    this.map = L.map(this.querySelector<HTMLElement>('[data-map]')!, {
      zoomControl: true,
      zoomSnap: 0.25,
      maxZoom: 9,
      maxBoundsViscosity: 1,
      scrollWheelZoom: true,
      wheelPxPerZoomLevel: 120,
    });
    this.map.createPane('lines').style.zIndex = '420';
    this.renderer = L.canvas({ pane: 'lines', padding: 0.5 });
    // OpenStreetMap tiles (no key needed), toned down with CSS filters to sit quietly under the data
    this.base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 10,
      className: 'osm-muted',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Data: ECMWF, NOAA',
    }).addTo(this.map);
    this.map.on('mousemove', (e: Leaflet.LeafletMouseEvent) => this.readout(e.latlng.lat, e.latlng.lng));
    this.map.on('mouseout', () => ((this.querySelector('[data-readout]') as HTMLElement).hidden = true));
    // tap/click a spot: a small popup offers that spot's forecast (no accidental page jumps on phones)
    this.map.on('click', (e: Leaflet.LeafletMouseEvent) => {
      const lat = +e.latlng.lat.toFixed(2);
      const lon = +wrapLon(e.latlng.lng).toFixed(2);
      const label = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
      const html = `<div class="pick"><span>${label}</span><button type="button" data-pick>Forecast here ↑</button></div>`;
      const popup = L.popup({ closeButton: false, autoPan: false, className: 'pick-popup' }).setLatLng(e.latlng).setContent(html).openOn(this.map);
      popup.getElement()?.querySelector('[data-pick]')?.addEventListener('click', () => {
        this.dot?.setLatLng([lat, lon]);
        this.map.closePopup();
        document.dispatchEvent(new CustomEvent('fx-pick', { detail: { lat, lon } }));
      });
    });
    this.wind = new WindParticles(
      this.map,
      (lat, lon) => this.windAt(lat, lon),
      () => (this.dark ? 'rgba(244,238,228,0.85)' : 'rgba(30,28,24,0.7)'),
    );
    // no animation work while the map is scrolled out of view
    new IntersectionObserver(([e]) => this.wind?.setVisible(e.isIntersecting)).observe(this);
    this.wind.setActive(this.layer === 'wind');
    this.load();
  }

  /** New city: frame its region, then find the data. */
  async load() {
    this.stop();
    const token = ++this.token;
    const L = this.L;
    const c = this.city;
    this.map.invalidateSize();
    const area = regionFor(c);
    // drag and zoom freely inside the region, but never past the data (a hair inside, so no edge peeks through)
    const bounds = L.latLngBounds([area.s, area.w], [area.n, area.e]).pad(-0.02);
    this.map.setMaxBounds(undefined as any);
    this.map.setMinZoom(0);
    const cover = this.map.getBoundsZoom(bounds, true);
    this.map.setMinZoom(cover);
    this.map.setMaxBounds(bounds);
    this.map.setView([c.lat, c.lon], cover + 1, { animate: false });
    this.dot?.remove();
    this.dot = L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="city-dot"></div>', iconSize: [10, 10] }), interactive: false }).addTo(this.map);

    this.status(`Loading the forecast map around ${c.name}…`);
    this.src = null;
    this.data.clear();
    const src = await sourceFor(c);
    if (token !== this.token) return;
    if (!src) return this.status('Couldn’t load the map data. The free weather service may be busy.', () => this.load());
    this.src = src;
    // layers that need the precomputed data
    for (const b of this.querySelectorAll<HTMLElement>('[data-pre-only]')) b.hidden = src.kind !== 'pre';
    if (src.kind !== 'pre' && (PRE_ONLY.includes(this.layer) || this.isobars)) {
      this.isobars = false;
      this.querySelector<HTMLInputElement>('[data-isobars]')!.checked = false;
      if (PRE_ONLY.includes(this.layer)) this.layer = 'temp';
      this.setLayer(this.layer);
    }
    const slider = this.querySelector<HTMLInputElement>('[data-time]')!;
    slider.max = String(src.time.length - 1);
    // start at the frame closest to now
    const now = Date.now();
    this.t = src.time.reduce((best, t, i) => (Math.abs(t - now) < Math.abs(src.time[best] - now) ? i : best), 0);
    this.runNote();
    await this.update();
  }

  /** the fields the current view needs */
  needs(): [FieldName, ModelKey][] {
    const m = this.model;
    const list: [FieldName, ModelKey][] = {
      temp: [['t2m', m]],
      precip: [['tp6', m]],
      wind: [
        ['u10', m],
        ['v10', m],
      ],
      sun: [['sw', m]],
      cloud: [['tcc', m]],
      stars: (['tcc', 'lcc', 'mcc', 'hcc', 'tcw', 'jet', 'd2m', 't2m'] as FieldName[]).map((f) => [f, m]),
      z500: [['z500', m]],
      total: [['tptot', m]],
      diff: [
        ['t2m', 'aifs'],
        ['t2m', 'ifs'],
      ],
    }[this.layer] as [FieldName, ModelKey][];
    if (this.isobars) list.push(['msl', this.layer === 'diff' ? 'aifs' : m]);
    return list;
  }

  /** Load whatever the view needs that isn't loaded yet, then redraw. */
  async update() {
    const src = this.src;
    if (!src) return;
    const token = this.token;
    const missing = this.needs().filter(([f, m]) => !this.data.has(`${f}/${m}`));
    if (missing.length) {
      this.status('Loading…');
      const got = await Promise.all(missing.map(([f, m]) => src.load(f, m)));
      if (token !== this.token || src !== this.src) return;
      if (got.some((g) => !g)) return this.status('Couldn’t load this layer right now.', () => this.update());
      missing.forEach(([f, m], i) => this.data.set(`${f}/${m}`, got[i]!));
    }
    this.status('');
    this.computeRange();
    this.draw();
    if (this.layer === 'wind') this.wind?.reset();
  }

  frame(field: FieldName, model: ModelKey, t = this.t): Float32Array | undefined {
    const f = this.data.get(`${field}/${model}`);
    return f?.[field === 'tptot' ? 0 : t];
  }

  status(text: string, retry?: () => void) {
    const s = this.querySelector<HTMLElement>('[data-map-status]')!;
    s.textContent = text;
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Try again';
      b.addEventListener('click', retry);
      s.append(b);
    }
    s.hidden = !text;
  }

  /** which model run the map shows */
  runNote() {
    const el = this.querySelector<HTMLElement>('[data-run]')!;
    const src = this.src;
    if (!src) return void (el.textContent = '');
    if (src.kind === 'live') return void (el.textContent = 'Live from Open-Meteo (coarse grid).');
    const fmt = (t: number) => `${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${String(new Date(t).getUTCHours()).padStart(2, '0')}z`;
    const r = src.runs;
    const ec = r.aifs ?? r.ifs;
    el.textContent = `Runs: AIFS and IFS ${ec ? fmt(ec) : '—'}, GFS ${r.gfs ? fmt(r.gfs) : '—'} · updated every 6 hours · 0.5° grid`;
  }

  get metric() {
    return document.documentElement.dataset.units === 'metric';
  }
  get dark() {
    return document.documentElement.dataset.effectiveTheme === 'dark';
  }
  conv(c: number) {
    return this.metric ? c : (c * 9) / 5 + 32;
  }
  windConv(kmh: number) {
    return this.metric ? kmh : kmh / 1.609344;
  }

  /** fixed color range across all times, so colors keep their meaning while the animation plays */
  computeRange() {
    const all = (field: FieldName, model: ModelKey, map: (v: number) => number) => {
      const out: number[] = [];
      for (const f of this.data.get(`${field}/${model}`) ?? []) for (const v of f) if (!isNaN(v)) out.push(map(v));
      return out.sort((a, b) => a - b);
    };
    const m = this.model;
    if (this.layer === 'temp') {
      const a = all('t2m', m, (v) => this.conv(v));
      if (a.length) this.range = [pct(a, 0.02), pct(a, 0.98)];
    } else if (this.layer === 'z500') {
      const a = all('z500', m, (v) => v);
      if (a.length) this.range = [Math.floor(pct(a, 0.02) / 60) * 60, Math.ceil(pct(a, 0.98) / 60) * 60];
    } else if (this.layer === 'wind') {
      const u = this.data.get(`u10/${m}`);
      const v = this.data.get(`v10/${m}`);
      const sp: number[] = [];
      u?.forEach((f, t) => f.forEach((x, i) => !isNaN(x) && sp.push(this.windConv(Math.hypot(x, v![t][i])))));
      sp.sort((a, b) => a - b);
      this.range = [0, Math.max(10, Math.ceil((pct(sp, 0.98) ?? 10) / 5) * 5)];
    } else if (this.layer === 'diff') {
      // 98th percentile of |AIFS − IFS| so a few extreme cells don't wash out the rest
      const a = this.data.get('t2m/aifs') ?? [];
      const b = this.data.get('t2m/ifs') ?? [];
      const d: number[] = [];
      a.forEach((f, t) => f.forEach((x, i) => !isNaN(x - b[t][i]) && d.push(Math.abs(x - b[t][i]))));
      d.sort((x, y) => x - y);
      const k = this.metric ? 1 : 1.8;
      const top = Math.max(2, Math.ceil((pct(d, 0.98) ?? 0) * k));
      this.range = [-top, top];
    }
  }

  /** grid position of a point, or null outside the data */
  gridPos(lat: number, lon: number): [number, number] | null {
    const s = this.src;
    if (!s) return null;
    const gx = ((lon - s.lons[0]) / (s.lons[s.cols - 1] - s.lons[0])) * (s.cols - 1);
    const gy = ((s.lats[0] - lat) / (s.lats[0] - s.lats[s.rows - 1])) * (s.rows - 1);
    return gx < 0 || gx > s.cols - 1 || gy < 0 || gy > s.rows - 1 ? null : [gx, gy];
  }

  sample(f: Float32Array | undefined, gx: number, gy: number) {
    if (!f) return NaN;
    const { cols, rows } = this.src!;
    const c0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
    const r0 = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
    // smoothstep weights: rounder contours than plain bilinear on a coarse grid
    const fx = smooth(gx - c0);
    const fy = smooth(gy - r0);
    const at = (r: number, c: number) => f[r * cols + c];
    return (at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx) * (1 - fy) + (at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx) * fy;
  }

  /** wind components (km/h) at a point, for the particles */
  windAt(lat: number, lon: number): [number, number] | null {
    const pos = this.gridPos(lat, lon);
    if (!pos) return null;
    const u = this.sample(this.frame('u10', this.model), pos[0], pos[1]);
    const v = this.sample(this.frame('v10', this.model), pos[0], pos[1]);
    return isNaN(u) || isNaN(v) ? null : [u, v];
  }

  value(gx: number, gy: number): number {
    const m = this.model;
    const s = (f: FieldName, model = m) => this.sample(this.frame(f, model), gx, gy);
    switch (this.layer) {
      case 'temp':
        return this.conv(s('t2m'));
      case 'precip':
        return s('tp6');
      case 'wind':
        return this.windConv(Math.hypot(s('u10'), s('v10')));
      case 'sun':
        return s('sw');
      case 'cloud':
      case 'stars':
        return s('tcc');
      case 'z500':
        return s('z500');
      case 'total':
        return s('tptot');
      case 'diff': {
        const d = s('t2m', 'aifs') - s('t2m', 'ifs');
        return this.metric ? d : d * 1.8;
      }
    }
  }

  color(v: number): [number, number, number, number] {
    if (isNaN(v)) return [0, 0, 0, 0];
    const [lo, hi] = this.range;
    if (this.layer === 'precip' || this.layer === 'total') {
      const b = banded(v, this.layer === 'total' ? TOTAL_STEPS : RAIN_STEPS);
      return b ? [...b[0], Math.round(b[1])] : [0, 0, 0, 0];
    }
    if (this.layer === 'wind') return [...lerpRamp(TEAL, v / hi), 130];
    // sunlight: transparent at night, warmer and more solid as it gets stronger (fixed 0–800 W/m² scale)
    if (this.layer === 'sun') return v < 5 ? [0, 0, 0, 0] : [...lerpRamp(AMBER, v / 800), Math.round(60 + 120 * Math.min(1, v / 400))];
    // clouds: clear is see-through, overcast is a solid grey veil
    if (this.layer === 'cloud') return this.dark ? [225, 225, 222, Math.round((v / 100) * 190)] : [96, 100, 108, Math.round((v / 100) * 170)];
    const mid: RGB = this.dark ? [56, 56, 53] : [240, 239, 236];
    const center = this.layer === 'diff' ? 0 : (lo + hi) / 2;
    const half = this.layer === 'diff' ? hi : (hi - lo) / 2;
    return [...diverging((v - center) / half, mid), 150];
  }

  draw() {
    const s = this.src;
    if (!s || !this.map || this.needs().some(([f, m]) => !this.data.has(`${f}/${m}`))) return;
    const L = this.L;
    if (this.layer === 'stars') this.nightGrid();
    // fine enough that band edges don't show stair steps when the overlay is stretched
    const W = s.cols >= s.rows ? 720 : 576;
    const H = s.cols >= s.rows ? 576 : 720;
    const cv = this.canvas;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const latN = s.lats[0];
    const latS = s.lats[s.rows - 1];
    const yN = mercY(latN);
    const yS = mercY(latS);
    for (let py = 0; py < H; py++) {
      const lat = invMercY(yN + ((py + 0.5) / H) * (yS - yN));
      const gy = ((latN - lat) / (latN - latS)) * (s.rows - 1);
      for (let px = 0; px < W; px++) {
        const gx = ((px + 0.5) / W) * (s.cols - 1);
        const c = this.layer === 'stars' ? this.starColor(gx, gy) : this.color(this.value(gx, gy));
        const o = (py * W + px) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = c[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL();
    const bounds = L.latLngBounds([latS, s.lons[0]], [latN, s.lons[s.cols - 1]]);
    if (this.overlay) this.overlay.setUrl(url).setBounds(bounds);
    else this.overlay = L.imageOverlay(url, bounds, { interactive: false, className: 'fx-field' }).addTo(this.map);

    this.drawLines();
    const label = this.querySelector('[data-time-label]')!;
    label.textContent =
      this.layer === 'total'
        ? 'Next 10 days'
        : new Date(s.time[this.t]).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: this.city.tz });
    (this.querySelector('[data-time]') as HTMLInputElement).value = String(this.t);
    this.legend();
    if (this.layer === 'wind') this.wind?.refresh();
  }

  /** darkness at every grid point for the current frame (sampled per pixel like the data) */
  nightGrid() {
    const s = this.src!;
    const g = new Float32Array(s.rows * s.cols);
    const t = s.time[this.t];
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) g[r * s.cols + c] = darkness(s.lats[r], s.lons[c], t);
    this.night = g;
  }

  /** clear night sky → deep navy, cloud → grey; fades out where it isn't dark yet */
  starColor(gx: number, gy: number): [number, number, number, number] {
    const dark = this.sample(this.night, gx, gy);
    const cloud = this.value(gx, gy);
    if (!(dark > 0) || isNaN(cloud)) return [0, 0, 0, 0];
    const clear = 1 - cloud / 100;
    return [...lerpRamp(SKY, clear), Math.round(dark * (90 + 120 * clear))];
  }

  /** a word for each stargazing factor (rules of thumb, not a forecast of their own) */
  starNotes(gx: number, gy: number): string {
    const m = this.model;
    const s = (f: FieldName) => this.sample(this.frame(f, m), gx, gy);
    const tcw = s('tcw');
    const jet = s('jet') / 3.6; // m/s
    const spread = s('t2m') - s('d2m');
    const transparency = tcw < 10 ? 'excellent' : tcw < 20 ? 'good' : tcw < 30 ? 'fair' : 'poor';
    const seeing = jet < 20 ? 'steady' : jet < 40 ? 'fair' : 'twinkly';
    const layers = `low ${Math.round(s('lcc'))}% · mid ${Math.round(s('mcc'))}% · high ${Math.round(s('hcc'))}%`;
    return `${layers} · transparency ${transparency} · seeing ${seeing}${spread < 2 ? ' · dew likely' : ''}`;
  }

  /** isobars every 4 hPa with H/L centres, and 500 hPa height contours every 60 m */
  drawLines() {
    const L = this.L;
    const s = this.src!;
    this.lines?.remove();
    this.centres?.remove();
    const segs: Leaflet.LatLngExpression[][] = [];
    const toLatLng = (r: number, c: number, rows: number, cols: number): [number, number] => [
      s.lats[0] + (r / (rows - 1)) * (s.lats[s.rows - 1] - s.lats[0]),
      s.lons[0] + (c / (cols - 1)) * (s.lons[s.cols - 1] - s.lons[0]),
    ];
    const add = (f: Float32Array, interval: number) => {
      const up = upsample(f, s.rows, s.cols);
      for (const [a, b] of contours(up.f, up.rows, up.cols, interval)) segs.push([toLatLng(a[0], a[1], up.rows, up.cols), toLatLng(b[0], b[1], up.rows, up.cols)]);
    };
    const ink = this.dark ? '#efe8dd' : '#22201c';
    if (this.layer === 'z500') {
      const z = this.frame('z500', this.model);
      if (z) add(z, 60);
    }
    const msl = this.isobars ? this.frame('msl', this.layer === 'diff' ? 'aifs' : this.model) : undefined;
    if (msl) {
      add(msl, 4);
      this.centres = L.layerGroup(
        extrema(msl, s.rows, s.cols)
          .slice(0, 12)
          .map((e) =>
            L.marker(toLatLng(e.r, e.c, s.rows, s.cols), {
              interactive: false,
              icon: L.divIcon({ className: `hl hl-${e.kind}`, html: `<b>${e.kind}</b><span>${Math.round(e.v)}</span>`, iconSize: [40, 34] }),
            }),
          ),
      ).addTo(this.map);
    }
    if (segs.length) this.lines = L.polyline(segs, { renderer: this.renderer, color: ink, weight: 1, opacity: 0.55, interactive: false }).addTo(this.map);
  }

  legend() {
    const box = this.querySelector<HTMLElement>('[data-legend]')!;
    const unit = this.metric ? '°C' : '°F';
    const [lo, hi] = this.range;
    const name = MODEL_NAMES[this.model];
    const mid = this.dark ? 'rgb(56,56,53)' : 'rgb(240,239,236)';
    const div = [...COLD.map((c) => `rgb(${c})`), mid, ...WARM.map((c) => `rgb(${c})`)];
    let title = '';
    let stops = div;
    let ticks: string[] = [];
    switch (this.layer) {
      case 'precip':
        title = `Precipitation, mm per ${this.src?.stepHours ?? 6} hours · ${name}`;
        stops = BLUE.map((c) => `rgb(${c})`);
        ticks = ['0.1', '1', '5', '15+'];
        break;
      case 'total':
        title = `Total precipitation, next 10 days (mm) · ${name}`;
        stops = BLUE.map((c) => `rgb(${c})`);
        ticks = ['1', '10', '50', '200+'];
        break;
      case 'wind':
        title = `Wind speed (${this.metric ? 'km/h' : 'mph'}) · ${name}`;
        stops = TEAL.map((c) => `rgb(${c})`);
        ticks = ['0', `${Math.round(hi / 2)}`, `${hi}+`];
        break;
      case 'sun':
        title = `Sunlight at the ground, W/m² (6-hour average) · ${name}`;
        stops = AMBER.map((c) => `rgb(${c})`);
        ticks = ['0', '200', '400', '600', '800'];
        break;
      case 'stars': {
        const moon = moonPhase(this.src?.time[this.t] ?? Date.now());
        title = `Stargazing: darker = clearer night sky (blank where it isn't dark yet) · Moon ${Math.round(moon.lit * 100)}% lit, ${moon.waxing ? 'waxing' : 'waning'} · ${name}`;
        stops = SKY.map((c) => `rgb(${c})`);
        ticks = ['overcast', 'clear'];
        break;
      }
      case 'cloud':
        title = `Cloud cover (%) · ${name}`;
        stops = this.dark ? ['rgba(225,225,222,0)', 'rgba(225,225,222,0.75)'] : ['rgba(96,100,108,0)', 'rgba(96,100,108,0.67)'];
        ticks = ['0', '50', '100'];
        break;
      case 'z500':
        title = `500 hPa height (m): troughs blue, ridges red · lines every 60 m · ${name}`;
        ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v).toLocaleString('en-US'));
        break;
      case 'diff':
        title = `AIFS minus IFS temperature (${unit}): red = ML model warmer`;
        ticks = [`${lo}`, '0', `+${hi}`];
        break;
      default:
        title = `Temperature (${unit}) · ${name}`;
        ticks = [lo, (lo + hi) / 2, hi].map((v) => `${Math.round(v)}°`);
    }
    if (this.isobars) title += ' · isobars every 4 hPa';
    box.querySelector<HTMLElement>('[data-legend-title]')!.textContent = title;
    box.querySelector<HTMLElement>('[data-ramp]')!.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    box.querySelector<HTMLElement>('[data-ticks]')!.innerHTML = ticks.map((t) => `<span>${t}</span>`).join('');
    box.hidden = false;
  }

  readout(lat: number, lon: number) {
    const box = this.querySelector<HTMLElement>('[data-readout]')!;
    const pos = this.gridPos(lat, lon);
    if (!pos || !this.src) return void (box.hidden = true);
    const v = this.value(pos[0], pos[1]);
    if (isNaN(v)) return void (box.hidden = true);
    const unit = this.metric ? '°C' : '°F';
    let text: string;
    switch (this.layer) {
      case 'wind': {
        const uv = this.windAt(lat, lon);
        // direction the wind blows from
        const from = uv ? COMPASS[Math.round(((Math.atan2(-uv[0], -uv[1]) * 180) / Math.PI + 360) / 45) % 8] : '';
        text = `${Math.round(v)} ${this.metric ? 'km/h' : 'mph'} from the ${from}`;
        break;
      }
      case 'precip':
        text = `${v.toFixed(1)} mm in ${this.src.stepHours} h`;
        break;
      case 'total':
        text = `${Math.round(v)} mm in 10 days`;
        break;
      case 'sun':
        text = `${Math.round(v)} W/m² of sunlight`;
        break;
      case 'cloud':
        text = `${Math.round(v)}% cloud cover`;
        break;
      case 'stars':
        text =
          this.sample(this.night, pos[0], pos[1]) > 0
            ? `${Math.round(100 - v)}% clear sky · ${this.starNotes(pos[0], pos[1])}`
            : 'Not dark yet here';
        break;
      case 'z500':
        text = `500 hPa at ${Math.round(v).toLocaleString('en-US')} m`;
        break;
      case 'diff':
        text = `AIFS ${v >= 0 ? 'warmer' : 'colder'} by ${Math.abs(v).toFixed(1)}${unit}`;
        break;
      default:
        text = `${Math.round(v)}${unit}`;
    }
    if (this.isobars) {
      const p = this.sample(this.frame('msl', this.layer === 'diff' ? 'aifs' : this.model), pos[0], pos[1]);
      if (!isNaN(p)) text += ` · ${Math.round(p)} hPa`;
    }
    box.textContent = text;
    box.hidden = false;
  }

  play() {
    if (!this.src || this.layer === 'total') return;
    const btn = this.querySelector<HTMLElement>('[data-play]')!;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"></path></svg>';
    btn.setAttribute('aria-label', 'Pause');
    this.playing = window.setInterval(() => {
      this.t = (this.t + 1) % this.src!.time.length;
      this.draw();
    }, 260);
  }

  stop() {
    if (!this.playing) return;
    clearInterval(this.playing);
    this.playing = 0;
    const btn = this.querySelector<HTMLElement>('[data-play]')!;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>';
    btn.setAttribute('aria-label', 'Play');
  }
}

customElements.define('forecast-map', ForecastMap);
