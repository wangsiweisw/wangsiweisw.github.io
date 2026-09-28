// photos:sync — resize, strip metadata, upload to R2 (or write locally), and update src/data/photos.json.
//
//   pnpm photos:sync            upload to R2 (needs .env), falls back to --local when R2 isn't configured
//   pnpm photos:sync --local    write variants to public/photos-local/ for previewing (never deployed)
//   pnpm photos:sync --prune    also drop manifest entries whose source file is gone from photos-src/
//
// Privacy: GPS is rounded to 2 decimals (~1 km) or dropped (hide_location), and every output
// file is re-encoded without any metadata. The script verifies that before writing anything.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import exifr from 'exifr';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const SRC = process.env.PHOTOS_SRC ?? 'photos-src';
const MANIFEST = 'src/data/photos.json';
const LOCAL_DIR = 'public/photos-local';
// 720 fills phone-sized slots (~380 CSS px at 1.75–2x) without jumping to 960
const WIDTHS = [480, 720, 960, 1600, 2400];
const FORMATS = { avif: { quality: 55, effort: 4 }, webp: { quality: 78 } } as const;
// bump when the pixelation changes so blurred photos get new files instead of reusing old uploads
const BLUR_VERSION = 'v2';
const STICKER_VERSION = 'cat-v1';

// Opaque ginger-cat sticker (white rim, soft shadow) used to cover bib numbers. The face sits in the lower ~60%.
const CAT_SHAPE = `<path d="M40 86 L46 20 L92 54 Q100 52 108 54 L154 20 L160 86 Q178 110 170 140 Q156 186 100 186 Q44 186 30 140 Q22 110 40 86 Z"/>`;
const STICKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 210">
  <g transform="translate(0 7)" fill="#000" opacity=".18" stroke="#000" stroke-width="18" stroke-linejoin="round">${CAT_SHAPE}</g>
  <g fill="#fff" stroke="#fff" stroke-width="18" stroke-linejoin="round">${CAT_SHAPE}</g>
  <g fill="#F2A65A">${CAT_SHAPE}</g>
  <path d="M52 40 L56 76 L80 58 Z" fill="#F7C3B5"/><path d="M148 40 L144 76 L120 58 Z" fill="#F7C3B5"/>
  <path d="M92 66 L94 84 M100 62 L100 84 M108 66 L106 84" stroke="#D9803A" stroke-width="6" stroke-linecap="round"/>
  <ellipse cx="72" cy="118" rx="10" ry="13" fill="#3B2A20"/><ellipse cx="128" cy="118" rx="10" ry="13" fill="#3B2A20"/>
  <circle cx="75" cy="113" r="3.8" fill="#fff"/><circle cx="131" cy="113" r="3.8" fill="#fff"/>
  <ellipse cx="54" cy="144" rx="12" ry="7" fill="#F4978E" opacity=".75"/><ellipse cx="146" cy="144" rx="12" ry="7" fill="#F4978E" opacity=".75"/>
  <path d="M94 136 L106 136 L100 143 Z" fill="#E0707A" stroke="#E0707A" stroke-width="3" stroke-linejoin="round"/>
  <path d="M100 143 Q100 152 91 152 M100 143 Q100 152 109 152" fill="none" stroke="#3B2A20" stroke-width="4" stroke-linecap="round"/>
  <path d="M40 132 L64 136 M38 146 L63 144 M160 132 L136 136 M162 146 L137 144" stroke="#3B2A20" stroke-width="3" stroke-linecap="round" opacity=".6"/>
</svg>`;
const INPUT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif']);

const { values: args } = parseArgs({ options: { local: { type: 'boolean' }, prune: { type: 'boolean' } } });

// ---------- config ----------
if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const r2Configured = Boolean(
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_PUBLIC_HOST,
);
const local = args.local || !r2Configured;
if (local && !args.local) console.warn('R2 is not configured in .env — writing variants locally (preview only).');

const s3 = local
  ? null
  : new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    });
const publicBase = local ? '/photos-local' : `https://${env.R2_PUBLIC_HOST}`;

// ---------- meta.yaml ----------
const metaSchema = z.record(
  z.string(),
  z.object({
    title: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    album: z.string().optional(),
    location: z.string().optional(),
    featured: z.boolean().optional(),
    hide_location: z.boolean().optional(),
    // leave this file out entirely (not processed, not uploaded)
    skip: z.boolean().optional(),
    // regions to pixelate before anything is published, e.g. race bibs: [x, y, w, h] as fractions of the image
    blur: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(),
    // cat stickers covering things like race bibs: [centerX, centerY, size] as fractions of the image width/height/width
    stickers: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
  }),
);
type Meta = z.infer<typeof metaSchema>[string];

const metaPath = join(SRC, 'meta.yaml');
const meta = existsSync(metaPath) ? metaSchema.parse(parse(await readFile(metaPath, 'utf8')) ?? {}) : {};

// ---------- manifest ----------
interface Variant { width: number; url: string }
interface Photo {
  id: string;
  file: string;
  width: number;
  height: number;
  alt: string | null;
  title: string | null;
  caption: string | null;
  album: string;
  location: string | null;
  featured: boolean;
  date: string | null;
  coords: { lat: number; lon: number } | null;
  exif: { camera?: string; lens?: string; focalLength?: string; aperture?: string; shutter?: string; iso?: number };
  placeholder: string;
  avif: Variant[];
  webp: Variant[];
}

const manifest: Photo[] = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : [];
const byId = new Map(manifest.map((p) => [p.id, p]));

// ---------- helpers ----------
const round2 = (n: number) => Math.round(n * 100) / 100;

function formatShutter(t?: number) {
  if (!t) return undefined;
  return t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`;
}

async function decodable(file: string): Promise<{ input: string | Buffer; cleanup?: () => Promise<void> }> {
  const ext = extname(file).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return { input: file };
  // sharp's prebuilt libvips can't decode HEVC; use macOS `sips` to make a temporary JPEG.
  const dir = await mkdtemp(join(tmpdir(), 'photos-'));
  const out = join(dir, basename(file, ext) + '.jpg');
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', file, '--out', out], { stdio: 'ignore' });
  return { input: out, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function exists(key: string): Promise<boolean> {
  if (local) return existsSync(join(LOCAL_DIR, key));
  try {
    await s3!.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function put(key: string, body: Buffer, contentType: string) {
  if (local) {
    await mkdir(LOCAL_DIR, { recursive: true });
    await writeFile(join(LOCAL_DIR, key), body);
    return;
  }
  await s3!.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/** Refuse to publish a file that still carries EXIF/GPS/XMP/IPTC. */
async function assertNoMetadata(buf: Buffer, label: string) {
  const info = await sharp(buf).metadata();
  const leftover = await exifr.parse(buf, { tiff: true, gps: true, xmp: true, iptc: true, icc: false }).catch(() => undefined);
  if (info.exif || info.xmp || info.iptc || (leftover && Object.keys(leftover).length > 0)) {
    throw new Error(`Metadata survived in ${label}; aborting.`);
  }
}

// ---------- main ----------
// Images anywhere under photos-src/, as paths relative to it (e.g. "london/DSC00093.jpg").
const files = existsSync(SRC)
  ? (await readdir(SRC, { recursive: true }))
      .map((f) => f.split('\\').join('/'))
      .filter((f) => INPUT_EXT.has(extname(f).toLowerCase()) && !basename(f).startsWith('.'))
      .sort()
  : [];

/** Album from the first folder in the path, as a slug ("Cherry Spring/x.jpg" → "cherry-spring"). */
const folderAlbum = (file: string) =>
  file.includes('/') ? file.split('/')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'misc';
if (files.length === 0) console.warn(`No images found in ${SRC}/.`);

const seen = new Set<string>();
let uploaded = 0;

for (const file of files) {
  if (meta[file]?.skip) {
    console.log(`- ${file} skipped (meta.yaml)`);
    continue;
  }
  const path = join(SRC, file);
  const original = await readFile(path);
  // blur regions are part of the id, so changing them produces fresh files instead of reusing old uploads
  const hash = createHash('sha256').update(original);
  if (meta[file]?.blur?.length) hash.update(BLUR_VERSION + JSON.stringify(meta[file].blur));
  if (meta[file]?.stickers?.length) hash.update(STICKER_VERSION + JSON.stringify(meta[file].stickers));
  const id = hash.digest('hex').slice(0, 12);
  seen.add(id);
  const m: Meta = meta[file] ?? {};

  const tags = await exifr.parse(original, { tiff: true, exif: true, gps: true }).catch(() => ({}) as Record<string, any>);
  const { input, cleanup } = await decodable(path);

  try {
    // Orientation applied, colour converted to sRGB, and no metadata written (sharp's default).
    let base = sharp(input).rotate();
    if (m.blur?.length) {
      // Pixelate then blur each region so the covered text can't be recovered, before any resizing.
      const oriented = await base.clone().png().toBuffer({ resolveWithObject: true });
      const W = oriented.info.width;
      const H = oriented.info.height;
      const patches = await Promise.all(
        m.blur.map(async ([x, y, w, h]) => {
          const left = Math.max(0, Math.round(x * W));
          const top = Math.max(0, Math.round(y * H));
          const width = Math.min(W - left, Math.round(w * W));
          const height = Math.min(H - top, Math.round(h * H));
          const tiny = await sharp(oriented.data)
            .extract({ left, top, width, height })
            .resize(Math.max(2, Math.round(width / 90)), Math.max(2, Math.round(height / 90)))
            .toBuffer();
          const input = await sharp(tiny).resize(width, height, { kernel: 'nearest' }).blur(Math.max(8, width / 12)).png().toBuffer();
          return { input, left, top };
        }),
      );
      base = sharp(await sharp(oriented.data).composite(patches).png().toBuffer());
    }
    if (m.stickers?.length) {
      const oriented = await base.clone().png().toBuffer({ resolveWithObject: true });
      const W = oriented.info.width;
      const H = oriented.info.height;
      const layers = await Promise.all(
        m.stickers.map(async ([cx, cy, size]) => {
          const px = Math.round(size * W);
          const input = await sharp(Buffer.from(STICKER_SVG), { density: 600 }).resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
          return { input, left: Math.round(cx * W - px / 2), top: Math.round(cy * H - px / 2) };
        }),
      );
      base = sharp(await sharp(oriented.data).composite(layers).png().toBuffer());
    }
    const { width = 0, height = 0 } = await base.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    const widths = [...new Set(WIDTHS.map((w) => Math.min(w, width)))];

    const avif: Variant[] = [];
    const webp: Variant[] = [];
    for (const w of widths) {
      for (const [fmt, opts] of Object.entries(FORMATS) as [keyof typeof FORMATS, any][]) {
        const key = `${id}-${w}.${fmt}`;
        (fmt === 'avif' ? avif : webp).push({ width: w, url: `${publicBase}/${key}` });
        if (await exists(key)) continue;
        const buf = await base.clone().resize({ width: w, withoutEnlargement: true })[fmt](opts).toBuffer();
        await assertNoMetadata(buf, key);
        await put(key, buf, `image/${fmt}`);
        uploaded++;
      }
    }

    const tiny = await base.clone().resize({ width: 20 }).webp({ quality: 40 }).toBuffer();
    const placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;

    const hasGps = typeof tags?.latitude === 'number' && typeof tags?.longitude === 'number';
    const taken: Date | undefined = tags?.DateTimeOriginal ?? tags?.CreateDate;
    const prev = byId.get(id);
    const album = m.album ?? folderAlbum(file);
    // Personal photos (latte art shot at home, the portrait): keep only the month and no camera or location data.
    const personal = album === 'coffee' || album === 'me' || album === 'running';

    byId.set(id, {
      id,
      file,
      width,
      height,
      alt: m.alt ?? prev?.alt ?? null,
      title: m.title ?? null,
      caption: m.caption ?? null,
      album,
      location: m.location ?? null,
      featured: m.featured ?? false,
      date:
        taken instanceof Date && !isNaN(+taken)
          ? personal
            ? `${taken.toISOString().slice(0, 7)}-01T00:00:00.000Z`
            : taken.toISOString()
          : null,
      // latte art is shot at home: never keep its location, even rounded
      coords: hasGps && !m.hide_location && !personal ? { lat: round2(tags.latitude), lon: round2(tags.longitude) } : null,
      exif: personal
        ? {}
        : {
        camera: [tags?.Make, tags?.Model].filter(Boolean).join(' ').trim() || undefined,
        lens: tags?.LensModel,
        focalLength: tags?.FocalLength ? `${Math.round(tags.FocalLength)}mm` : undefined,
        aperture: tags?.FNumber ? `f/${tags.FNumber}` : undefined,
        shutter: formatShutter(tags?.ExposureTime),
        iso: tags?.ISO,
          },
      placeholder,
      avif,
      webp,
    });
    console.log(`✓ ${file} → ${id} (${width}×${height})${m.alt ? '' : '  ⚠ no alt text in meta.yaml'}`);
  } finally {
    await cleanup?.();
  }
}

if (args.prune) {
  for (const id of byId.keys()) if (!seen.has(id)) byId.delete(id);
}

const out = [...byId.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
await writeFile(MANIFEST, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${out.length} photos in ${MANIFEST}; ${uploaded} files ${local ? 'written locally' : 'uploaded to R2'}.`);
if (local) console.log('Local mode: do not commit photos.json until you re-run with R2 configured (CI rejects local URLs).');
