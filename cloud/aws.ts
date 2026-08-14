// AWS invoker: drives the deployed Lambda. For each slice it invokes the function
// (which renders the segment to S3) and downloads the segment locally so the
// coordinator (orchestrateRender) can concat. The Invoker seam keeps this swappable,
// e.g. a firecracker/local backend could implement the same interface.

import { writeFileSync } from 'node:fs';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Invoker } from './orchestrate';

export interface AwsInvokerOptions {
  functionName: string;
  bucket: string;
  /** s3 key prefix for this render's segments, e.g. `renders/<id>` */
  keyPrefix: string;
  region?: string | undefined;
}

export function awsInvoker(opts: AwsInvokerOptions): Invoker {
  const aws = opts.region === undefined ? {} : { region: opts.region };
  const lambda = new LambdaClient(aws);
  const s3 = new S3Client(aws);
  return async (job, localSegmentPath) => {
    const key = `${opts.keyPrefix}/seg-${job.index}.mp4`;
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: opts.functionName,
        Payload: Buffer.from(
          JSON.stringify({
            composition: job.composition,
            props: job.props,
            frameRange: job.frameRange,
            bucket: opts.bucket,
            key,
          }),
        ),
      }),
    );
    if (res.FunctionError) {
      throw new Error(`lambda worker ${job.index} failed: ${res.Payload ? Buffer.from(res.Payload).toString() : res.FunctionError}`);
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
    if (!obj.Body) throw new Error(`s3 object ${key} has no body`);
    writeFileSync(localSegmentPath, await obj.Body.transformToByteArray());
  };
}
