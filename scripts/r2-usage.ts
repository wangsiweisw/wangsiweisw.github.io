// r2:usage — how much of R2's free storage the photo bucket uses.
//
//   pnpm r2:usage
import { existsSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { FREE_BYTES, STOP_BYTES, bucketUsage, gb, pctOfFree } from './lib/r2-usage.ts';

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

const { files, bytes } = await bucketUsage(s3, env.R2_BUCKET);
console.log(`${files} files, ${gb(bytes)} of the free ${gb(FREE_BYTES)} (${pctOfFree(bytes)}).`);
if (bytes > STOP_BYTES) console.warn(`⚠ Over ${gb(STOP_BYTES)}: photos:sync will refuse to upload. Run photos:prune-r2 to clear unused files.`);
else if (bytes > 0.8 * FREE_BYTES) console.warn('⚠ Over 80% of the free tier.');
console.log('Reads and writes are counted by Cloudflare per month (free: 10M reads, 1M writes); see the R2 dashboard for those.');
