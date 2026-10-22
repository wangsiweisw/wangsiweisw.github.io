// Easter egg: a short burst of rain or snow over the whole page. Type "rain" or "snow", enter the Konami code,
// pick it in ⌘K, or dispatch `weather-egg` with detail 'rain' | 'snow' (the 404 page keeps a light drizzle going).
type Kind = 'rain' | 'snow';
type Drop = { x: number; y: number; z: number; ph: number };

const DURATION = 15_000;
const FADE = 2_000;

let canvas: HTMLCanvasElement | null = null;
let frame = 0;
let kind: Kind = 'rain';
let until = 0; // ms timestamp; Infinity = until the page closes
let drops: Drop[] = [];
let W = 0;
let H = 0;
let intensity = 1;

function setup() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '40' });
  document.body.append(canvas);
  addEventListener('resize', size);
  size();
  return canvas;
}

function size() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
}

function seed() {
  const n = Math.round(((W * H) / (kind === 'rain' ? 2600 : 4200)) * intensity);
  drops = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.4 + Math.random() * 0.6, ph: Math.random() * 7 }));
}

function draw(t: number, move: boolean) {
  const ctx = canvas!.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const left = until - t;
  const fade = left === Infinity ? 1 : Math.max(0, Math.min(1, left / FADE));
  ctx.strokeStyle = ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6e675d';
  for (const p of drops) {
    if (kind === 'rain') {
      const v = 9 * p.z;
      if (move) ((p.y += v), (p.x += v * 0.18));
      ctx.globalAlpha = 0.35 * p.z * fade;
      ctx.lineWidth = p.z;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - v * 0.4, p.y - v * 2.2);
      ctx.stroke();
    } else {
      if (move) ((p.y += 0.8 * p.z), (p.x += Math.sin(t / 1400 + p.ph) * 0.4));
      ctx.globalAlpha = 0.55 * p.z * fade;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8 * p.z + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.y > H + 10) ((p.y = -10), (p.x = Math.random() * W));
    if (p.x > W + 10) p.x = -10;
  }
  ctx.globalAlpha = 1;
  return fade > 0;
}

export function startWeather(k: Kind, opts: { forever?: boolean; intensity?: number } = {}) {
  const changed = k !== kind || (opts.intensity ?? 1) !== intensity || !canvas;
  kind = k;
  intensity = opts.intensity ?? 1;
  until = opts.forever ? Infinity : performance.now() + DURATION;
  setup();
  if (changed) seed();
  // reduced motion: one still frame that fades out (or stays, on the 404 page)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(performance.now(), false);
    if (!opts.forever) setTimeout(() => canvas?.getContext('2d')!.clearRect(0, 0, W, H), 4000);
    return;
  }
  if (frame) return;
  const tick = (t: number) => {
    frame = draw(t, true) ? requestAnimationFrame(tick) : 0;
    if (!frame) canvas!.getContext('2d')!.clearRect(0, 0, W, H);
  };
  frame = requestAnimationFrame(tick);
}

// --- triggers ---
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let keys: string[] = [];
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, [contenteditable], dialog[open]')) return;
  keys = [...keys, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-10);
  const typed = keys.filter((k) => k.length === 1).join('');
  if (keys.join() === KONAMI.join()) startWeather('snow');
  else if (typed.endsWith('rain')) startWeather('rain');
  else if (typed.endsWith('snow')) startWeather('snow');
  else return;
  keys = [];
});
document.addEventListener('weather-egg', (e) => startWeather((e as CustomEvent<Kind>).detail));
