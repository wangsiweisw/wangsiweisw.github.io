import { describe, expect, it } from 'vitest';
import { adjustPace, heatBand, heatScore } from './heatAdjustment';

describe('Hadley heat bands', () => {
  it('puts the band edges where the table does', () => {
    expect(heatBand(100).pct).toEqual([0, 0]);
    expect(heatBand(101).pct).toEqual([0, 0.5]);
    expect(heatBand(180).pct).toEqual([8, 10]);
    expect(heatBand(181).pct).toBeNull();
  });
  it('covers cold days and every band in between', () => {
    expect(heatBand(-20).index).toBe(0);
    expect(heatBand(145).pct).toEqual([3, 4.5]); // Hadley's own example: 74°F + 71°F dew point
  });
  it('rounds the sum before looking it up', () => {
    expect(heatScore(60.4, 40.4)).toBe(101);
    expect(heatScore(60.2, 40.2)).toBe(100);
  });
  it('slows a pace by the band range', () => {
    expect(adjustPace(420, 145)).toEqual([432.6, 438.9]); // 7:00/mi → about 7:13–7:19
    expect(adjustPace(420, 90)).toEqual([420, 420]);
    expect(adjustPace(420, 190)).toBeNull();
  });
});
