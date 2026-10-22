// Contour lines (isobars, height contours) by marching squares, and pressure highs/lows, on a rows × cols grid.

/** Segments of the `level` isoline as [[y0, x0], [y1, x1]] in fractional grid coordinates (row, col). */
function isoline(f: Float32Array, rows: number, cols: number, level: number, out: number[][][]) {
  const at = (r: number, c: number) => f[r * cols + c];
  // where the line crosses an edge between two corners
  const cross = (r0: number, c0: number, r1: number, c1: number): number[] => {
    const a = at(r0, c0);
    const b = at(r1, c1);
    const t = (level - a) / (b - a);
    return [r0 + (r1 - r0) * t, c0 + (c1 - c0) * t];
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = at(r, c);
      const tr = at(r, c + 1);
      const br = at(r + 1, c + 1);
      const bl = at(r + 1, c);
      if (isNaN(tl + tr + br + bl)) continue;
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cross(r, c, r, c + 1);
      const right = () => cross(r, c + 1, r + 1, c + 1);
      const bottom = () => cross(r + 1, c, r + 1, c + 1);
      const left = () => cross(r, c, r + 1, c);
      switch (code) {
        case 1:
        case 14:
          out.push([left(), bottom()]);
          break;
        case 2:
        case 13:
          out.push([bottom(), right()]);
          break;
        case 3:
        case 12:
          out.push([left(), right()]);
          break;
        case 4:
        case 11:
          out.push([top(), right()]);
          break;
        case 6:
        case 9:
          out.push([top(), bottom()]);
          break;
        case 7:
        case 8:
          out.push([left(), top()]);
          break;
        case 5: // saddles: pick by the cell's mean
        case 10: {
          const hi = (tl + tr + br + bl) / 4 > level;
          if ((code === 5) === hi) out.push([left(), top()], [bottom(), right()]);
          else out.push([left(), bottom()], [top(), right()]);
        }
      }
    }
  }
}

/** All isolines every `interval` units (levels aligned to multiples of it). */
export function contours(f: Float32Array, rows: number, cols: number, interval: number): number[][][] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) if (!isNaN(v)) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  const out: number[][][] = [];
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) isoline(f, rows, cols, level, out);
  return out;
}

/** Doubles a grid's resolution with smooth interpolation, so contours come out rounder. */
export function upsample(f: Float32Array, rows: number, cols: number): { f: Float32Array; rows: number; cols: number } {
  const R = rows * 2 - 1;
  const C = cols * 2 - 1;
  const g = new Float32Array(R * C);
  const at = (r: number, c: number) => f[Math.min(rows - 1, r) * cols + Math.min(cols - 1, c)];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const r0 = r >> 1;
      const c0 = c >> 1;
      const fy = (r & 1) * 0.5;
      const fx = (c & 1) * 0.5;
      g[r * C + c] = (at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx) * (1 - fy) + (at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx) * fy;
    }
  }
  return { f: g, rows: R, cols: C };
}

/** Pressure centres: points lower (L) or higher (H) than everything within `radius` cells, by a clear margin. */
export function extrema(f: Float32Array, rows: number, cols: number, radius = 8): { r: number; c: number; v: number; kind: 'H' | 'L' }[] {
  const out: { r: number; c: number; v: number; kind: 'H' | 'L' }[] = [];
  for (let r = radius; r < rows - radius; r++) {
    for (let c = radius; c < cols - radius; c++) {
      const v = f[r * cols + c];
      let isMin = true;
      let isMax = true;
      let sum = 0;
      let n = 0;
      for (let dr = -radius; dr <= radius && (isMin || isMax); dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (!dr && !dc) continue;
          const w = f[(r + dr) * cols + c + dc];
          if (w <= v) isMin = false;
          if (w >= v) isMax = false;
          sum += w;
          n++;
        }
      }
      if (isMin && sum / n - v > 2) out.push({ r, c, v, kind: 'L' });
      if (isMax && v - sum / n > 2) out.push({ r, c, v, kind: 'H' });
    }
  }
  return out;
}
