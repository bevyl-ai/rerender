// @remotion/lambda-client drop-in. Runs in the CALLER's server (Next.js), so it must stay
// light: only the AWS SDK + node:crypto, never chrome/vite/mediabunny. It kicks off an
// async render (invoke the function in `launch` mode, fire-and-forget) and polls progress
// from S3 — the same renderMediaOnLambda → getRenderProgress contract Bevyl is built on.
// The deployed function (cloud/handler.ts) does the actual work.
import { randomBytes } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  estimateCosts,
  type LaunchEvent,
  outputKey,
  progressKey,
  type RenderProgress,
  s3PublicUrl,
  signWebhookBody,
  type StillEvent,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookConfig,
  type WebhookPayload,
} from './progress';

const renderId = (): string => randomBytes(8).toString('hex');

// Remotion encodes the memory in the function name (…-mem4096mb-…); read it for the cost
// estimate, default to a typical 4096MB when the name doesn't carry it.
const memoryFromFunctionName = (name: string): number => Number(/mem(\d+)mb/.exec(name)?.[1]) || 4096;

const isNoSuchKey = (e: unknown): boolean =>
  !!e && typeof e === 'object' && ('name' in e ? e.name === 'NoSuchKey' || e.name === 'NotFound' : false);

/** Pickable preset fields — Bevyl types ExportRenderPreset = Pick<RenderMediaOnLambdaInput, …>. */
export interface RenderMediaOnLambdaInput {
  region: string;
  functionName: string;
  composition: string;
  serveUrl?: string; // accepted for API-compat; the project is baked into the worker image
  forceBucketName?: string;
  codec?: string;
  audioCodec?: string;
  inputProps?: Record<string, unknown>;
  imageFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
  scale?: number;
  colorSpace?: string;
  logLevel?: string;
  timeoutInMilliseconds?: number;
  webhook?: WebhookConfig | null;
  // codec/encoder tuning Bevyl Picks into its preset (accepted; forwarded where supported)
  audioBitrate?: string | null;
  videoBitrate?: string | null;
  encodingBufferSize?: string | null;
  encodingMaxRate?: string | null;
  pixelFormat?: string;
  x264Preset?: string | null;
}

export interface RenderMediaOnLambdaOutput {
  renderId: string;
  bucketName: string;
  folderInS3Console: string;
  cloudWatchLogs: string;
  lambdaInsightsLogs: string;
}

export async function renderMediaOnLambda(input: RenderMediaOnLambdaInput): Promise<RenderMediaOnLambdaOutput> {
  const region = input.region;
  const id = renderId();
  const bucketName = input.forceBucketName;
  if (!bucketName) throw new Error('renderMediaOnLambda: forceBucketName is required (rerender does not auto-create buckets)');
  const memorySize = memoryFromFunctionName(input.functionName);
  const s3 = new S3Client({ region });
  const lambda = new LambdaClient({ region });

  // Seed an initial progress object so getRenderProgress is consistent before the worker
  // (which may cold-start) writes its first update.
  const initial: RenderProgress = {
    renderId: id,
    bucketName,
    overallProgress: 0,
    done: false,
    fatalErrorEncountered: false,
    errors: [],
    framesRendered: 0,
    bytesUploaded: 0,
    timeToFinish: null,
    estimatedBillingDurationInMilliseconds: null,
    costs: estimateCosts(0, memorySize),
    outBucket: null,
    outKey: null,
    outputFile: null,
  };
  await s3.send(
    new PutObjectCommand({ Bucket: bucketName, Key: progressKey(id), Body: JSON.stringify(initial), ContentType: 'application/json' }),
  );

  const event: LaunchEvent = {
    type: 'launch',
    renderId: id,
    bucket: bucketName,
    composition: input.composition,
    inputProps: input.inputProps,
    codec: input.codec,
    muted: false,
    scale: input.scale,
    imageFormat: input.imageFormat,
    jpegQuality: input.jpegQuality,
    memorySize,
    region,
    webhook: input.webhook ?? null,
  };
  // InvocationType 'Event' = fire-and-forget: the function orchestrates the whole render
  // asynchronously and writes progress to S3; we return immediately.
  await lambda.send(
    new InvokeCommand({ FunctionName: input.functionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(event)) }),
  );

  return {
    renderId: id,
    bucketName,
    folderInS3Console: `https://s3.console.aws.amazon.com/s3/buckets/${bucketName}?prefix=renders/${id}/`,
    cloudWatchLogs: '',
    lambdaInsightsLogs: '',
  };
}

export async function getRenderProgress(params: {
  region: string;
  functionName: string;
  bucketName: string;
  renderId: string;
}): Promise<RenderProgress> {
  const s3 = new S3Client({ region: params.region });
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: params.bucketName, Key: progressKey(params.renderId) }));
    return JSON.parse(await obj.Body!.transformToString()) as RenderProgress;
  } catch (e) {
    if (isNoSuchKey(e)) {
      // Worker hasn't written progress yet — report in-progress, not failed.
      return {
        renderId: params.renderId,
        bucketName: params.bucketName,
        overallProgress: 0,
        done: false,
        fatalErrorEncountered: false,
        errors: [],
        framesRendered: 0,
        bytesUploaded: 0,
        timeToFinish: null,
        estimatedBillingDurationInMilliseconds: null,
        costs: estimateCosts(0, 4096),
        outBucket: null,
        outKey: null,
        outputFile: null,
      };
    }
    throw e;
  }
}

export interface RenderStillOnLambdaInput {
  region: string;
  functionName: string;
  composition: string;
  serveUrl?: string;
  forceBucketName?: string;
  frame?: number;
  outName?: string;
  privacy?: 'public' | 'private';
  imageFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
  scale?: number;
  inputProps?: Record<string, unknown>;
  logLevel?: string;
  timeoutInMilliseconds?: number;
}

export interface RenderStillOnLambdaOutput {
  renderId: string;
  bucketName: string;
  url: string;
  outKey: string;
  sizeInBytes: number;
}

export async function renderStillOnLambda(input: RenderStillOnLambdaInput): Promise<RenderStillOnLambdaOutput> {
  const region = input.region;
  const id = renderId();
  const bucket = input.forceBucketName;
  if (!bucket) throw new Error('renderStillOnLambda: forceBucketName is required');
  const ext = input.imageFormat === 'png' ? 'png' : 'jpeg';
  const outName = input.outName ?? `renders/${id}/still.${ext}`;
  const lambda = new LambdaClient({ region });
  const event: StillEvent = {
    type: 'still',
    renderId: id,
    bucket,
    composition: input.composition,
    frame: input.frame ?? 0,
    outName,
    inputProps: input.inputProps,
    imageFormat: input.imageFormat,
    jpegQuality: input.jpegQuality,
    scale: input.scale,
    region,
  };
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: input.functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(event)) }),
  );
  if (res.FunctionError) {
    throw new Error(`renderStillOnLambda failed: ${res.Payload ? Buffer.from(res.Payload).toString() : res.FunctionError}`);
  }
  const out = JSON.parse(Buffer.from(res.Payload!).toString()) as { sizeInBytes: number };
  return { renderId: id, bucketName: bucket, url: s3PublicUrl(bucket, region, outName), outKey: outName, sizeInBytes: out.sizeInBytes };
}

// ── appRouterWebhook — the Next.js App Router POST handler Bevyl mounts to receive the
// completion callback. Verifies our HMAC signature (we sign the POST in the worker), then
// dispatches to onSuccess / onTimeout / onError with the payload fields Bevyl reads. ──

export interface AppRouterWebhookOptions {
  secret: string | null;
  testing?: boolean;
  onSuccess?: (payload: {
    renderId: string;
    outputUrl: string | null;
    customData: Record<string, unknown> | null;
    timeToFinish: number | null;
    costs: WebhookPayload['costs'];
  }) => void | Promise<void>;
  onTimeout?: (payload: { customData: Record<string, unknown> | null }) => void | Promise<void>;
  onError?: (payload: { customData: Record<string, unknown> | null; errors: WebhookPayload['errors'] }) => void | Promise<void>;
}

export function appRouterWebhook(options: AppRouterWebhookOptions): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const body = await request.text();
    if (!options.testing && options.secret) {
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      if (signature !== signWebhookBody(body, options.secret)) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid signature' }), { status: 401 });
      }
    }
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400 });
    }
    try {
      if (payload.type === 'success') {
        await options.onSuccess?.({
          renderId: payload.renderId,
          outputUrl: payload.outputUrl,
          customData: payload.customData,
          timeToFinish: payload.timeToFinish,
          costs: payload.costs,
        });
      } else if (payload.type === 'timeout') {
        await options.onTimeout?.({ customData: payload.customData });
      } else {
        await options.onError?.({ customData: payload.customData, errors: payload.errors });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500 });
    }
  };
}
