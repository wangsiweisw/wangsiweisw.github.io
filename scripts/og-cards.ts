// Renders the link-preview cards (Open Graph images, 1200×630) to public/og/*.jpg. Run after `astro build`;
// the built home page supplies the self-hosted fonts and colors. Commit the output.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { parse } from 'yaml';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { geoCircle } from 'd3-geo';
import { beanMap, beanSvg, flameSvg } from '../src/lib/beanMap.ts';
import { feature } from 'topojson-client';

const DIST = 'dist';
const OUT = 'public/og';
const W = 1200;
const H = 630;

interface Photo {
  file: string;
  album: string;
  date: string | null;
  webp: { width: number; url: string }[];
}
const photos: Photo[] = JSON.parse(readFileSync('src/data/photos.json', 'utf8'));
const albums: { id: string; title: string; subtitle?: string; cover?: string }[] = parse(readFileSync('src/data/albums.yaml', 'utf8'));
const site = parse(readFileSync('src/data/site.yaml', 'utf8'));
const running = JSON.parse(readFileSync('src/data/running.json', 'utf8'));
interface BeanOrigin {
  label: string;
  place: string;
  lat: number;
  lon: number;
  precision: string;
  spread?: number;
}
const beans: {
  id: string;
  name: string;
  roaster: string | null;
  roastedIn: { name: string; lat: number; lon: number };
  flavors: string[];
  origins?: BeanOrigin[];
  originsText?: string;
}[] = parse(readFileSync('src/data/beans.yaml', 'utf8')).filter((b: { roaster: string | null }) => b.roaster);
const land110 = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));

const byFile = (file: string) => photos.find((p) => p.file === file);
const src = (p: Photo | undefined, min = 1600) => p && (p.webp.find((v) => v.width >= min) ?? p.webp.at(-1)!).url;
const coverOf = (a: (typeof albums)[number]) => byFile(a.cover ?? '') ?? photos.find((p) => p.album === a.id);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const brand = `<div class="brand"><span class="dot"></span>siweiwang.me</div>`;

/** Text on the left, a photo filling the right. */
const split = (kicker: string, title: string, body: string, img?: string) => `
  <div class="split">
    <div class="text"><div class="kicker">${kicker}</div><h1>${title}</h1><p>${body}</p>${brand}</div>
    ${img ? `<img src="${img}" alt="" />` : ''}
  </div>`;

/** A photo filling the card, title over a dark gradient. */
const bleed = (title: string, sub: string, img: string) => `
  <div class="bleed"><img src="${img}" alt="" />
    <div class="shade"><div class="kicker">Photography · Siwei Wang</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
  </div>`;

/** A bean: name, roaster and flavors beside a world map with arcs from where it grew to where it was roasted. */
const MW = 600;
const MH = 330;
const landShape = feature(land110, land110.objects.land) as any;
const beanCard = (b: (typeof beans)[number]) => {
  const os = b.origins ?? [];
  const { world, path: wpath, sphere: spherePath, tropics } = beanMap(MW, MH, os.map((o) => [[o.lon, o.lat], [b.roastedIn.lon, b.roastedIn.lat]]));
  const landPath = wpath(landShape)!;
  const [cx, cy] = world([b.roastedIn.lon, b.roastedIn.lat])!;
  const arcs = os.map((o) => `<path class="arc" d="${wpath({ type: 'LineString', coordinates: [[o.lon, o.lat], [b.roastedIn.lon, b.roastedIn.lat]] })}"/>`);
  const marks = os.map((o) => {
    if (o.precision === 'area') return `<path class="area" d="${wpath(geoCircle().center([o.lon, o.lat]).radius(o.spread ?? 10)())}"/>`;
    const [x, y] = world([o.lon, o.lat])!;
    return `<circle class="halo" cx="${x}" cy="${y}" r="14"/>${beanSvg(x, y, 6.5)}`;
  });
  const from = os.length
    ? os.map((o) => esc(o.precision === 'area' ? o.label : o.place)).join(' · ')
    : esc(b.originsText ?? '');
  return `
  <div class="bean">
    <div class="text">
      <div class="kicker">Coffee · Beans</div>
      <h1>${esc(b.name)}</h1>
      <p>${esc(b.roaster ?? '')}, roasted in ${esc(b.roastedIn.name)}</p>
      <ul class="chips">${b.flavors.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      ${brand}
    </div>
    <div class="side">
      <svg viewBox="0 0 ${MW} ${MH}" width="${MW}" height="${MH}">
        <defs><clipPath id="globe"><path d="${spherePath}"/></clipPath></defs>
        <path class="belt" d="${tropics}" clip-path="url(#globe)"/><path class="land" d="${landPath}"/>
        ${arcs.join('')}${marks.join('')}
        ${flameSvg(cx, cy, 0.95)}
      </svg>
      <div class="route"><span class="grown">${from}</span><span class="to">→ ${esc(b.roastedIn.name)}</span></div>
    </div>
  </div>`;
};

const latest = (album: string) => photos.filter((p) => p.album === album).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
const miles = Math.round(running.meters / 1609.344).toLocaleString('en-US');

const cards: [slug: string, html: string][] = [
  ['default', split(esc(site.nameZh ?? ''), esc(site.name), esc(site.positioning), src(byFile(site.portrait), 960))],
  [
    'photos',
    split('Photography', 'Travel photographs', `${albums.length} albums — national parks, night skies, and New York.`, src(coverOf(albums[0]))),
  ],
  ['coffee', split('Coffee', 'Weekend pours', 'Latte art, and the beans behind it with the weather they grew in.', src(latest('coffee'), 960))],
  ['running', split('Running', `${miles} miles`, `${running.runs} runs since ${running.since.slice(0, 4)}.`, src(byFile('running/IMG_7646.JPG'), 960))],
  [
    'forecast',
    split(
      'Forecast lab',
      'AI vs physics weather models',
      `Live 15-day ensembles: <b class="m1">ECMWF AIFS</b>, <b class="m2">ECMWF IFS</b>, and <b class="m3">NOAA GEFS</b>.`,
    ),
  ],
  ...beans.map((b): [string, string] => [`bean-${b.id}`, beanCard(b)]),
  ...albums.flatMap((a): [string, string][] => {
    const img = src(coverOf(a));
    return img ? [[`album-${a.id}`, bleed(esc(a.title), esc(a.subtitle ?? ''), img)]] : [];
  }),
];

const STYLE = `
  html, body { margin: 0; background: var(--bg); }
  body > :not(.card) { display: none !important; }
  .card { position: fixed; inset: 0 auto auto 0; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--font-body); }
  .kicker { font-size: 26px; letter-spacing: 0.04em; color: var(--accent); }
  h1 { font-family: var(--font-display); font-weight: 400; font-size: 84px; line-height: 1.02; margin: 18px 0 22px; letter-spacing: -0.01em; }
  p { font-size: 30px; line-height: 1.35; margin: 0; color: var(--muted); }
  .split { display: flex; height: 100%; }
  .split .text { flex: 1; padding: 80px 64px 64px 80px; display: flex; flex-direction: column; }
  .split img { width: 430px; height: 100%; object-fit: cover; }
  .brand { margin-top: auto; display: flex; align-items: center; gap: 12px; font-size: 24px; color: var(--muted); }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
  b { font-weight: 600; color: var(--fg); }
  b.m1 { box-shadow: inset 0 -4px #b4532a; } b.m2 { box-shadow: inset 0 -4px #2f6db5; } b.m3 { box-shadow: inset 0 -4px #2a8a5a; }
  .bean { display: flex; height: 100%; }
  .bean .text { flex: 1; min-width: 0; padding: 72px 40px 64px 80px; display: flex; flex-direction: column; }
  .bean h1 { font-size: 66px; margin: 16px 0 18px; text-wrap: balance; }
  .bean p { font-size: 28px; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 0; padding: 0; list-style: none; }
  .chips li { padding: 6px 16px; border: 1.5px solid var(--rule); border-radius: 99px; font-size: 22px; color: var(--fg); background: var(--surface); }
  .bean .side { width: 600px; background: var(--surface); border-left: 1.5px solid var(--rule); display: flex; flex-direction: column; justify-content: center; }
  .side svg { display: block; }
  .side .belt { fill: var(--accent); opacity: 0.07; }
  .side .land { fill: var(--rule); }
  .side .arc { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-dasharray: 2 6; stroke-linecap: round; }
  .side .area { fill: var(--accent); fill-opacity: 0.12; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 5 5; }
  .side .halo { fill: var(--accent); opacity: 0.2; }
  .side .bean ellipse { fill: var(--accent); stroke: var(--surface); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .side .bean path { fill: none; stroke: var(--surface); stroke-width: 1.6; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .side .flame .outer { fill: var(--surface); stroke: var(--fg); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .side .flame .inner { fill: var(--accent); }
  .route { padding: 22px 40px 0; font-size: 22px; line-height: 1.4; color: var(--muted); }
  .route .to { white-space: nowrap; margin-left: 8px; color: var(--fg); }
  .bleed img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .bleed .shade { position: absolute; inset: auto 0 0 0; padding: 140px 72px 60px; background: linear-gradient(transparent, rgb(0 0 0 / 0.62)); color: #fff; }
  .bleed .kicker { color: rgb(255 255 255 / 0.85); font-size: 24px; }
  .bleed h1 { margin: 10px 0 6px; font-size: 76px; }
  .bleed p { color: rgb(255 255 255 / 0.85); }
`;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, reducedMotion: 'reduce', colorScheme: 'light' });
// cards are always light, whatever the hour (the site turns dark after sunset when no theme is saved)
await page.addInitScript(() => localStorage.setItem('theme', 'light'));
await page.goto(`http://127.0.0.1:${port}/`);
await page.addStyleTag({ content: STYLE });
// if the build couldn't self-host the fonts (no access to Google Fonts' metadata), load them from Google directly
if (!(await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Fraunces'))))) {
  await page.addStyleTag({
    url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Instrument+Sans:wght@400..600&display=block',
  });
  await page.addStyleTag({ content: `:root { --font-display: 'Fraunces'; --font-body: 'Instrument Sans'; }` });
  await page.evaluate(() => Promise.all([document.fonts.load("400 84px 'Fraunces'"), document.fonts.load("400 30px 'Instrument Sans'")]));
}
// `pnpm og:cards` renders every card; `pnpm og:cards bean-` only those whose name starts with that
const only = process.argv[2];
for (const [slug, html] of cards) {
  if (only && !slug.startsWith(only)) continue;
  await page.evaluate((h) => {
    document.querySelector('.card')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="card">${h}</div>`);
  }, html);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll<HTMLImageElement>('.card img')].map((img) => img.decode().catch(() => {})));
  });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(join(OUT, `${slug}.jpg`));
  console.log(`og/${slug}.jpg`);
}
await browser.close();
server.close();
