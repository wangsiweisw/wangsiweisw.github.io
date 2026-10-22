// Renders the link-preview cards (Open Graph images, 1200×630) to public/og/*.jpg. Run after `astro build`;
// the built home page supplies the self-hosted fonts and colors. Commit the output.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { parse } from 'yaml';
import sharp from 'sharp';
import { chromium } from 'playwright';

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

const latest = (album: string) => photos.filter((p) => p.album === album).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
const miles = Math.round(running.meters / 1609.344).toLocaleString('en-US');

const cards: [slug: string, html: string][] = [
  ['default', split(esc(site.nameZh ?? ''), esc(site.name), esc(site.positioning), src(byFile(site.portrait), 960))],
  [
    'photos',
    split('Photography', 'Travel photographs', `${albums.length} albums — national parks, night skies, and New York.`, src(coverOf(albums[0]))),
  ],
  ['coffee', split('Latte art', 'Weekend pours', 'Hearts, tulips, and the occasional swan.', src(latest('coffee'), 960))],
  ['running', split('Running', `${miles} miles`, `${running.runs} runs since ${running.since.slice(0, 4)}.`, src(byFile('running/IMG_7646.JPG'), 960))],
  [
    'forecast',
    split(
      'Forecast lab',
      'AI vs physics weather models',
      `Live 15-day ensembles: <b class="m1">ECMWF AIFS</b>, <b class="m2">ECMWF IFS</b>, and <b class="m3">NOAA GEFS</b>.`,
    ),
  ],
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
await page.goto(`http://127.0.0.1:${port}/`);
await page.addStyleTag({ content: STYLE });
const only = process.argv[2];
for (const [slug, html] of cards) {
  if (only && slug !== only) continue;
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
