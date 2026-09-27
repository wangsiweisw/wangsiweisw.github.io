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
