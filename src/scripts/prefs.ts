// Visitor preferences (theme, units), persisted in localStorage when available.
export type Theme = 'light' | 'dark';
export type Units = 'imperial' | 'metric';

const root = document.documentElement;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, blocked): the choice lasts for this page only.
  }
}

/**
 * Whether the sun is more than 3° below the horizon for the visitor. Position is guessed from the time zone's
 * standard offset (longitude) at a mid latitude: no location request. Mirrors the inline script in Base.astro.
 */
export function sunIsDown(now = new Date()): boolean {
  const y = now.getFullYear();
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
  const lon = -std / 4;
  const lat = 40;
  const r = Math.PI / 180;
  const d = now.getTime() / 864e5 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * r;
  const L = (280.459 + 0.98564736 * d) * r + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 3.6e-7 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = (18.697374558 + 24.06570982441908 * d) * 15 * r + lon * r - ra;
  return Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha) < Math.sin(-3 * r);
}

/** The theme to show when the visitor hasn't picked one. */
export function autoTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches || sunIsDown() ? 'dark' : 'light';
}

export function effectiveTheme(): Theme {
  return root.dataset.effectiveTheme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  root.dataset.theme = theme;
  root.dataset.effectiveTheme = theme;
  write('theme', theme);
}

export function getUnits(): Units {
  return read('units') === 'metric' ? 'metric' : 'imperial';
}

export function setUnits(units: Units) {
  root.dataset.units = units;
  write('units', units);
  document.dispatchEvent(new CustomEvent<Units>('unitschange', { detail: units }));
}
