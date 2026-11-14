// Unit conversions and formatting for weather and running. Pure functions, no framework.

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const KM_PER_MILE = 1.609344;
export const kmToMi = (km: number) => km / KM_PER_MILE;
export const miToKm = (mi: number) => mi * KM_PER_MILE;
export const kmhToMph = (kmh: number) => kmh / KM_PER_MILE;

/** Dew point (°C) from temperature (°C) and relative humidity (%), Magnus formula (Alduchov & Eskridge 1996 coefficients). */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const g = Math.log(Math.max(rh, 0.01) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/** "3:30:00", "45:30" or "90" (minutes) → seconds; null if it doesn't parse. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 1) return n[0] * 60;
  if (n.slice(1).some((x) => x >= 60)) return null;
  return n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
}

/** seconds → "3:30:00" (or "45:30" under an hour) */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** pace in seconds per km → "4:59 /km" or "8:01 /mi" */
export function formatPace(secPerKm: number, unit: 'km' | 'mi'): string {
  const s = Math.round(unit === 'mi' ? secPerKm * KM_PER_MILE : secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /${unit}`;
}
