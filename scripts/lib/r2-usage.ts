// How much of R2's free tier the photo bucket uses. Free each month: 10 GB stored, 1M writes (Class A), 10M reads
// (Class B); egress is free. Listing costs one Class A operation per 1,000 files, so checking is effectively free.
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';

export const FREE_BYTES = 10 * 1024 ** 3;
/** photos:sync stops before an upload would take the bucket past this, leaving headroom under the free 10 GB. */
export const STOP_BYTES = 9 * 1024 ** 3;

export async function bucketUsage(s3: S3Client, bucket: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of page.Contents ?? []) (files++, (bytes += o.Size ?? 0));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { files, bytes };
}

export const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
export const pctOfFree = (n: number) => `${((100 * n) / FREE_BYTES).toFixed(1)}%`;
