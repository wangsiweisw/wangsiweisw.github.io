// Animated wind streaks drawn over a Leaflet map: particles drift with the wind sampled at their position and leave
// fading trails. Lives in screen space (a canvas over the map); hidden while the map moves, reseeded when it stops.
import type * as Leaflet from 'leaflet';

/** Wind at a point as [east, north] components in km/h, or null outside the data. */
export type WindSampler = (lat: number, lon: number) => [number, number] | null;

const SPEED = 0.05; // px per frame, per km/h
const MAX_AGE = 90; // frames

export class WindParticles {
  canvas = document.createElement('canvas');
  ctx = this.canvas.getContext('2d')!;
  particles: { x: number; y: number; age: number }[] = [];
  frame = 0;
  active = false;
  visible = true;
  moving = false;
  w = 0;
  h = 0;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private map: Leaflet.Map,
    private sample: WindSampler,
    private ink: () => string,
  ) {
    this.canvas.className = 'wind-canvas';
    map.getContainer().append(this.canvas);
    map.on('movestart zoomstart', () => {
      this.moving = true;
      this.clear();
    });
    map.on('moveend zoomend resize', () => {
      this.moving = false;
      this.reset();
    });
    document.addEventListener('visibilitychange', () => this.loop());
  }

  setActive(on: boolean) {
    this.active = on;
    this.canvas.hidden = !on;
    if (on) this.reset();
    else this.clear();
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.loop();
  }

  /** the field changed (new time step or model): keep particles, just redraw a still frame if not animating */
  refresh() {
    if (this.active && this.still) this.drawStill();
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  reset() {
    if (!this.active) return;
    const size = this.map.getSize();
    this.w = size.x;
    this.h = size.y;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    const n = Math.round((this.w * this.h) / 700);
    this.particles = Array.from({ length: n }, () => this.spawn(Math.random() * MAX_AGE));
    if (this.still) this.drawStill();
    else this.loop();
  }

  spawn(age = 0) {
    return { x: Math.random() * this.w, y: Math.random() * this.h, age };
  }

  /** move every particle one step and stroke its path segment */
  step() {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const p of this.particles) {
      const ll = this.map.containerPointToLatLng([p.x, p.y]);
      const uv = this.sample(ll.lat, ll.lng);
      if (!uv || ++p.age > MAX_AGE) {
        Object.assign(p, this.spawn());
        continue;
      }
      const nx = p.x + uv[0] * SPEED;
      const ny = p.y - uv[1] * SPEED;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      p.x = nx;
      p.y = ny;
      if (nx < 0 || ny < 0 || nx > this.w || ny > this.h) Object.assign(p, this.spawn());
    }
    ctx.strokeStyle = this.ink();
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  fade() {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.93)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
  }

  loop() {
    if (this.frame || this.still) return;
    const tick = () => {
      this.frame = 0;
      if (!this.active || !this.visible || this.moving || document.hidden) return;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.fade();
      this.step();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** reduced motion: one still frame of short streaks */
  drawStill() {
    this.clear();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.particles.forEach((p) => (p.age = 0));
    for (let i = 0; i < 24; i++) {
      this.fade();
      this.step();
    }
  }
}
