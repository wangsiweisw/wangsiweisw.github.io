// Prints the built /resume page to resume.pdf (dist/ for deploy, public/ for local dev). Run after `astro build`.
import { createServer } from 'node:http';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'dist';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

// Minimal static server so absolute asset paths (/_astro/...) resolve like on the real site.
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

// Skip while the resume is unpublished (the built page is just a redirect home).
if ((await readFile(join(DIST, 'resume', 'index.html'), 'utf8')).includes('http-equiv="refresh"')) {
  console.log('Resume not published (sample content); skipping resume.pdf');
  server.close();
  process.exit(0);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/resume/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await writeFile(join(DIST, 'resume.pdf'), pdf);
  await copyFile(join(DIST, 'resume.pdf'), join('public', 'resume.pdf'));
  console.log(`resume.pdf written (${(pdf.length / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  server.close();
}
