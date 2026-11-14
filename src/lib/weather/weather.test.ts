import { describe, expect, it } from 'vitest';
import { cToF, dewPoint, fToC, formatDuration, formatPace, kmToMi, miToKm, parseDuration } from './units';
import { percentile, raceHourDays, spread, summarize, windowFor } from './climatology';
import { monthlyNormals } from './normals';

describe('units', () => {
  it('converts temperature both ways', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(fToC(50)).toBeCloseTo(10);
  });
  it('converts distance both ways', () => {
    expect(kmToMi(42.195)).toBeCloseTo(26.219, 2);
    expect(miToKm(kmToMi(10))).toBeCloseTo(10);
  });
  it('dew point: saturated air equals the temperature; a known case', () => {
    expect(dewPoint(20, 100)).toBeCloseTo(20, 5);
    expect(dewPoint(25, 50)).toBeCloseTo(13.9, 0);
  });
  it('parses and formats durations', () => {
    expect(parseDuration('3:30:00')).toBe(12600);
    expect(parseDuration('45:30')).toBe(2730);
    expect(parseDuration('90')).toBe(5400);
    expect(parseDuration('3:75:00')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(formatDuration(12600)).toBe('3:30:00');
    expect(formatDuration(2730)).toBe('45:30');
  });
  it('formats pace per km and per mile', () => {
    expect(formatPace(300, 'km')).toBe('5:00 /km');
    expect(formatPace(300, 'mi')).toBe('8:03 /mi');
  });
});

describe('climatology', () => {
  it('percentiles interpolate', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(percentile(v, 0.5)).toBe(6);
    expect(percentile(v, 0.1)).toBe(2);
    expect(percentile(v, 0.9)).toBe(10);
    expect(percentile([1, 2], 0.5)).toBe(1.5);
    expect(percentile([], 0.5)).toBeNaN();
    expect(spread([5])).toEqual({ p10: 5, p50: 5, p90: 5 });
  });
  it('window is 3 days either side, across month ends and for Feb 29', () => {
    expect(windowFor(2024, '04-15')).toEqual({ start: '2024-04-12', end: '2024-04-18' });
    expect(windowFor(2023, '03-02')).toEqual({ start: '2023-02-27', end: '2023-03-05' });
    expect(windowFor(2024, '02-29')).toEqual({ start: '2024-02-26', end: '2024-03-03' });
    expect(windowFor(2023, '02-29')).toEqual({ start: '2023-02-25', end: '2023-03-03' });
  });
  it('averages race hours per day and counts rainy days', () => {
    const time: string[] = [];
    const temp: number[] = [];
    const rain: number[] = [];
    for (const day of ['2024-04-14', '2024-04-15'])
      for (let h = 0; h < 24; h++) {
        time.push(`${day}T${String(h).padStart(2, '0')}:00`);
        temp.push(h); // temperature equals the hour
        rain.push(day === '2024-04-15' && h === 10 ? 1 : 0);
      }
    const days = raceHourDays({ time, temperature_2m: temp, dew_point_2m: temp.map((t) => t - 5), wind_speed_10m: temp.map(() => 10), precipitation: rain }, 9, 3);
    expect(days).toHaveLength(2);
    expect(days[0].temperature).toBe(10.5); // hours 9–12
    expect(days[0].dewPoint).toBe(5.5);
    const s = summarize(days, [2024, 2024]);
    expect(s.rainShare).toBe(0.5);
    expect(s.wind.p50).toBe(10);
  });
});

describe('monthly normals', () => {
  it('averages temperatures by month and precipitation by monthly total across years', () => {
    const time: string[] = [];
    const tmax: number[] = [];
    const tmin: number[] = [];
    const precip: number[] = [];
    for (const [year, rainPerDay] of [
      [2000, 1],
      [2001, 3],
    ] as const)
      for (let d = 1; d <= 31; d++) {
        time.push(`${year}-01-${String(d).padStart(2, '0')}`);
        tmax.push(20);
        tmin.push(10);
        precip.push(rainPerDay);
      }
    const n = monthlyNormals({ time, tmax, tmin, precip });
    expect(n).toHaveLength(12);
    expect(n[0]).toEqual({ month: 1, tmin: 10, tmax: 20, precip: 62 }); // (31 + 93) / 2
    expect(n[1].precip).toBeNaN();
  });
});
