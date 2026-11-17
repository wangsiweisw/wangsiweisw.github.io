// Mark Hadley's pace adjustment for heat and humidity: add the air temperature and the dew point (both °F) and look
// the sum up below. The percentages are for continuous runs; Hadley suggests half for repeat workouts.
// Source: https://maximumperformancerunning.blogspot.com/2013/07/temperature-dew-point.html (Maximum Performance
// Running, July 2013). Informational only: the range reflects individual factors such as fitness and body size.

export interface HeatBand {
  /** highest sum in the band (inclusive); Infinity for the top band */
  max: number;
  /** pace slows by this much, in percent: [low, high] */
  pct: [number, number] | null;
  label: string;
}

export const HEAT_BANDS: HeatBand[] = [
  { max: 100, pct: [0, 0], label: 'No adjustment' },
  { max: 110, pct: [0, 0.5], label: 'Barely noticeable' },
  { max: 120, pct: [0.5, 1], label: 'Slightly warm' },
  { max: 130, pct: [1, 2], label: 'Warm' },
  { max: 140, pct: [2, 3], label: 'Warm and sticky' },
  { max: 150, pct: [3, 4.5], label: 'Hot' },
  { max: 160, pct: [4.5, 6], label: 'Hot and humid' },
  { max: 170, pct: [6, 8], label: 'Very hot' },
  { max: 180, pct: [8, 10], label: 'Very hot and humid' },
  { max: Infinity, pct: null, label: 'Hard running not recommended' },
];

/** temperature + dew point, °F, rounded to a whole number as the table is read */
export const heatScore = (tempF: number, dewPointF: number) => Math.round(tempF + dewPointF);

export function heatBand(score: number): HeatBand & { index: number } {
  const index = HEAT_BANDS.findIndex((b) => score <= b.max);
  return { ...HEAT_BANDS[index], index };
}

/** a pace (seconds per unit distance) slowed by the band's range: [low, high], or null above the table */
export function adjustPace(secPerUnit: number, score: number): [number, number] | null {
  const { pct } = heatBand(score);
  return pct && [secPerUnit * (1 + pct[0] / 100), secPerUnit * (1 + pct[1] / 100)];
}
