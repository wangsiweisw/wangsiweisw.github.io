// The small world map on a bean's page and its link-preview card: Equal Earth, cropped from 46°S up to the highest
// latitude any of the bean's arcs reaches (at least 72°N, so an arc over the Arctic isn't cut off), fitted into
// width × height and centered.
import { geoEqualEarth, geoInterpolate, geoPath } from 'd3-geo';

export function beanMap(width: number, height: number, arcs: [number, number][][]) {
  const north = Math.min(90, Math.max(72, ...arcs.flatMap(([a, b]) => Array.from({ length: 33 }, (_, i) => geoInterpolate(a, b)(i / 32)[1] + 4))));
  const world = geoEqualEarth().fitWidth(width, { type: 'Sphere' });
  const span = world([0, -46])![1] - world([0, north])![1];
  world.scale(world.scale() * Math.min(1, height / span)).translate([width / 2, height / 2]);
  const mid = (world([0, north])![1] + world([0, -46])![1]) / 2;
  world.translate([width / 2, height - mid]);
  const path = geoPath(world);
  const lons = Array.from({ length: 73 }, (_, i) => -180 + i * 5);
  const edge = (lat: number, list: number[]) => list.map((lon) => world([lon, lat])!.map((v) => v.toFixed(1)).join(','));
  return {
    world,
    path,
    sphere: path({ type: 'Sphere' })!,
    /** the band between the tropics, where coffee grows */
    tropics: `M${[...edge(23.44, lons), ...edge(-23.44, [...lons].reverse())].join('L')}Z`,
  };
}

// Map icons, drawn around (0, 0): a coffee bean where it grew, a flame where it was roasted.
/** bean: an ellipse rx 1 × ry 1.4 (scale to taste) with this crease down the middle */
export const BEAN = { rx: 1, ry: 1.4, crease: 'M0,-1.13 C-0.48,-0.39 0.48,0.39 0,1.13' };
/** flame: outline and inner drop, about 14 wide and 19 tall at scale 1 */
export const FLAME = {
  outer: 'M0,-9.75 C4,-4.75 7,-1.75 7,2.75 A7,7 0 0 1 -7,2.75 C-7,-1.25 -4,-2.75 -3,-6.75 C-1.5,-4.25 -0.5,-3.25 0,-9.75 Z',
  inner: 'M0,-0.25 C2,1.75 3,2.75 3,4.25 A3,3 0 0 1 -3,4.25 C-3,2.75 -1.5,1.75 0,-0.25 Z',
};
/** SVG markup for a bean of half-width r at (x, y), tilted like a bean dropped on a table */
export const beanSvg = (x: number, y: number, r: number, cls = 'bean') =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(-20)"><g class="${cls}"><g transform="scale(${r})"><ellipse rx="${BEAN.rx}" ry="${BEAN.ry}"/><path d="${BEAN.crease}"/></g></g></g>`;
/** SVG markup for a flame of scale s at (x, y) */
export const flameSvg = (x: number, y: number, s: number, cls = 'flame') =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g class="${cls}"><g transform="scale(${s})"><path class="outer" d="${FLAME.outer}"/><path class="inner" d="${FLAME.inner}"/></g></g></g>`;
