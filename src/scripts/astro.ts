// Low-precision sun and moon positions (good to a fraction of a degree, plenty for "is it dark" and moon phase).
const RAD = Math.PI / 180;

/** days since J2000.0 */
const days = (ms: number) => ms / 864e5 - 10957.5;

/** Sun's elevation above the horizon in degrees. */
export function sunElevation(lat: number, lon: number, ms: number): number {
  const d = days(ms);
  const g = (357.529 + 0.98560028 * d) * RAD;
  const L = (280.459 + 0.98564736 * d) * RAD + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 3.6e-7 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = (18.697374558 + 24.06570982441908 * d) * 15 * RAD + lon * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** How dark it is, 0 (sun up or civil twilight) → 1 (sun 15° or more below the horizon). */
export function darkness(lat: number, lon: number, ms: number): number {
  const t = Math.max(0, Math.min(1, (-6 - sunElevation(lat, lon, ms)) / 9));
  return t * t * (3 - 2 * t);
}

/** Moon's illuminated fraction (0–1) and whether it's waxing, from the Sun–Moon elongation. */
export function moonPhase(ms: number): { lit: number; waxing: boolean } {
  const d = days(ms);
  // mean elements (degrees)
  const Lm = 218.316 + 13.176396 * d; // moon mean longitude
  const Mm = (134.963 + 13.064993 * d) * RAD; // moon mean anomaly
  const Ms = (357.529 + 0.98560028 * d) * RAD; // sun mean anomaly
  const moonLon = Lm + 6.289 * Math.sin(Mm);
  const sunLon = 280.459 + 0.98564736 * d + 1.915 * Math.sin(Ms) + 0.02 * Math.sin(2 * Ms);
  const elong = ((((moonLon - sunLon) % 360) + 360) % 360) * RAD; // 0 new, 180 full
  return { lit: (1 - Math.cos(elong)) / 2, waxing: elong < Math.PI };
}
