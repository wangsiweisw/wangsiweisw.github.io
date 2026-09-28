// photos:prune-r2 — find files in the R2 bucket that src/data/photos.json no longer references.
//
//   pnpm photos:prune-r2            list them (dry run, nothing is deleted)
//   pnpm photos:prune-r2 --delete   delete them
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const { values: args } = parseArgs({ options: { delete: { type: 'boolean' } } });

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
  throw new Error('R2 is not configured in .env');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

interface Variant { url: string }
const photos: { avif: Variant[]; webp: Variant[] }[] = JSON.parse(await readFile('src/data/photos.json', 'utf8'));
const referenced = new Set(photos.flatMap((p) => [...p.avif, ...p.webp]).map((v) => new URL(v.url).pathname.slice(1)));

const all: { Key: string; Size: number }[] = [];
let token: string | undefined;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET, ContinuationToken: token }));
  for (const o of page.Contents ?? []) all.push({ Key: o.Key!, Size: o.Size ?? 0 });
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

const orphans = all.filter((o) => !referenced.has(o.Key));
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
console.log(`${all.length} files in R2, ${referenced.size} referenced by photos.json, ${orphans.length} unreferenced (${mb(orphans.reduce((a, o) => a + o.Size, 0))} MB).`);
const missing = [...referenced].filter((k) => !all.some((o) => o.Key === k));
if (missing.length) console.warn(`⚠ ${missing.length} referenced files are missing from R2 — run photos:sync.`);

if (!args.delete) {
  for (const o of orphans.slice(0, 10)) console.log(`  ${o.Key}`);
  if (orphans.length > 10) console.log(`  … and ${orphans.length - 10} more`);
  console.log(orphans.length ? 'Dry run: nothing deleted. Re-run with --delete to remove them.' : 'Nothing to clean up.');
} else {
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({ Bucket: env.R2_BUCKET, Delete: { Objects: batch.map((o) => ({ Key: o.Key })) } }));
  }
  console.log(`Deleted ${orphans.length} unreferenced files.`);
}
