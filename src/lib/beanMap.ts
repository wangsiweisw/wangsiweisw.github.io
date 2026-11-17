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
