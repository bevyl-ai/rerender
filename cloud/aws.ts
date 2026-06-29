// AWS invoker — drives the deployed Lambda. For each slice it invokes the function
// (which renders the segment to S3) and downloads the segment locally so the
// coordinator can concat. Swap this for localInvoker (orchestrate.ts) to run the exact
// same orchestration with no cloud.
import { writeFileSync } from 'node:fs';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Invoker } from './orchestrate';

export interface AwsInvokerOptions {
  functionName: string;
  bucket: string;
  /** s3 key prefix for this render's segments, e.g. `renders/<id>` */
  keyPrefix: string;
  region?: string;
}

export function awsInvoker(opts: AwsInvokerOptions): Invoker {
  const lambda = new LambdaClient({ region: opts.region });
  const s3 = new S3Client({ region: opts.region });
  return async (job, localSegmentPath) => {
    const key = `${opts.keyPrefix}/seg-${job.index}.mp4`;
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: opts.functionName,
        Payload: Buffer.from(JSON.stringify({ comp: job.comp, props: job.props, frameRange: job.frameRange, bucket: opts.bucket, key })),
      }),
    );
    if (res.FunctionError) {
      throw new Error(`lambda worker ${job.index} failed: ${res.Payload ? Buffer.from(res.Payload).toString() : res.FunctionError}`);
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
    writeFileSync(localSegmentPath, await obj.Body!.transformToByteArray());
  };
}
