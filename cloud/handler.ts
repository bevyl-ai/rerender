// AWS Lambda worker — one container, three modes (discriminated on event.type):
//   • launch  — the async coordinator: bundle the baked project, render the whole
//     composition (with audio), stream progress to S3, upload the result, fire the webhook.
//     Invoked fire-and-forget by renderMediaOnLambda; getRenderProgress reads its progress.
//   • still   — render a single frame to S3 and return its size (renderStillOnLambda).
//   • segment — the original per-range silent worker, fanned out by the synchronous
//     `rerender cloud render` CLI (cloud/aws.ts → orchestrate.ts).
// The project is baked into the image at RERENDER_ENTRY; cold-start seeds Vite's cache.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { bundle } from '../src/renderer/bundle';
import { renderMedia } from '../src/renderer/render-media';
import { renderStill } from '../src/renderer/render-still';
import { selectComposition } from '../src/renderer/select-composition';
import type { VideoCodec } from '../src/renderer/types';
import {
  estimateCosts,
  type LaunchEvent,
  outputKey,
  progressKey,
  type RenderProgress,
  s3PublicUrl,
  type StillEvent,
  signWebhookBody,
  timeToFinish,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookConfig,
  type WebhookPayload,
} from './progress';

const ENTRY = process.env.RERENDER_ENTRY ?? '/var/task/project/src/index.ts';
const s3 = new S3Client({});

const BAKED_VITE_CACHE = '/var/task/.vite-cache-baked';
if (existsSync(BAKED_VITE_CACHE) && !existsSync('/tmp/.vite-cache')) {
  try {
    cpSync(BAKED_VITE_CACHE, '/tmp/.vite-cache', { recursive: true });
  } catch {
    /* best-effort — worst case Vite re-optimizes */
  }
}

/** The original per-range silent worker (synchronous `rerender cloud render`). */
export interface SegmentEvent {
  composition: import('../src/renderer/types').CompositionConfig;
  props?: Record<string, unknown>;
  frameRange: [number, number];
  bucket: string;
  key: string;
}

type Event = LaunchEvent | StillEvent | SegmentEvent;

export async function handler(event: Event): Promise<unknown> {
  if ('type' in event && event.type === 'launch') return launch(event);
  if ('type' in event && event.type === 'still') return still(event);
  return renderSegment(event as SegmentEvent);
}

function errorList(err: unknown): { message: string; stack?: string }[] {
  const e = err as { message?: string; stack?: string };
  return [{ message: e?.message ?? String(err), stack: e?.stack }];
}

// Bevyl passes Remotion's codec names (h264/h265); rerender's WebCodecs encoder speaks the
// mediabunny names (avc/hevc/…). Translate at the boundary; unsupported codecs fall back to avc.
const REMOTION_TO_VIDEO_CODEC: Record<string, VideoCodec> = {
  h264: 'avc',
  avc: 'avc',
  h265: 'hevc',
  hevc: 'hevc',
  vp9: 'vp9',
  av1: 'av1',
};
const toVideoCodec = (codec: string | undefined): VideoCodec | undefined =>
  codec === undefined ? undefined : (REMOTION_TO_VIDEO_CODEC[codec] ?? 'avc');

async function postWebhook(cfg: WebhookConfig, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  try {
    await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(body, cfg.secret) },
      body,
    });
  } catch {
    /* a webhook delivery failure must not crash the render; progress.json still records done. */
  }
}

async function launch(event: LaunchEvent): Promise<void> {
  const t0 = Date.now();
  const writeProgress = (p: RenderProgress): Promise<unknown> =>
    s3.send(
      new PutObjectCommand({
        Bucket: event.bucket,
        Key: progressKey(event.renderId),
        Body: JSON.stringify(p),
        ContentType: 'application/json',
      }),
    );
  const base: RenderProgress = {
    renderId: event.renderId,
    bucketName: event.bucket,
    overallProgress: 0,
    done: false,
    fatalErrorEncountered: false,
    errors: [],
    framesRendered: 0,
    bytesUploaded: 0,
    timeToFinish: null,
    estimatedBillingDurationInMilliseconds: null,
    costs: estimateCosts(0, event.memorySize),
    outBucket: null,
    outKey: null,
    outputFile: null,
  };

  try {
    const b = await bundle(ENTRY);
    const composition = await selectComposition({ serveUrl: b.serveUrl, id: event.composition, inputProps: event.inputProps ?? {} });
    const out = `/tmp/${event.renderId}.mp4`;
    try {
      await renderMedia({
        composition,
        serveUrl: b.serveUrl,
        outputLocation: out,
        inputProps: event.inputProps ?? {},
        videoCodec: toVideoCodec(event.codec),
        muted: event.muted,
        scale: event.scale,
        imageFormat: event.imageFormat,
        jpegQuality: event.jpegQuality,
        onProgress: ({ renderedFrames, progress }) => {
          const elapsed = Date.now() - t0;
          void writeProgress({
            ...base,
            overallProgress: progress,
            framesRendered: renderedFrames,
            estimatedBillingDurationInMilliseconds: elapsed,
            timeToFinish: timeToFinish(elapsed, progress),
            costs: estimateCosts(elapsed, event.memorySize),
          });
        },
      });
    } finally {
      await b.close();
    }

    const body = readFileSync(out);
    const key = outputKey(event.renderId);
    await s3.send(new PutObjectCommand({ Bucket: event.bucket, Key: key, Body: body, ContentType: 'video/mp4' }));
    const elapsed = Date.now() - t0;
    const url = s3PublicUrl(event.bucket, event.region, key);
    const costs = estimateCosts(elapsed, event.memorySize);
    await writeProgress({
      ...base,
      overallProgress: 1,
      done: true,
      framesRendered: composition.durationInFrames,
      bytesUploaded: body.length,
      estimatedBillingDurationInMilliseconds: elapsed,
      timeToFinish: 0,
      costs,
      outBucket: event.bucket,
      outKey: key,
      outputFile: url,
    });
    if (event.webhook) {
      await postWebhook(event.webhook, {
        type: 'success',
        renderId: event.renderId,
        bucketName: event.bucket,
        expectedBucketOwner: null,
        customData: event.webhook.customData ?? null,
        outputUrl: url,
        outputFile: url,
        timeToFinish: 0,
        costs,
        errors: [],
        lambdaErrors: [],
      });
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    const errors = errorList(err);
    await writeProgress({
      ...base,
      done: true,
      fatalErrorEncountered: true,
      errors,
      estimatedBillingDurationInMilliseconds: elapsed,
      costs: estimateCosts(elapsed, event.memorySize),
    });
    if (event.webhook) {
      await postWebhook(event.webhook, {
        type: 'error',
        renderId: event.renderId,
        bucketName: event.bucket,
        expectedBucketOwner: null,
        customData: event.webhook.customData ?? null,
        outputUrl: null,
        outputFile: null,
        timeToFinish: null,
        costs: null,
        errors,
        lambdaErrors: errors,
      });
    }
    // Event invocations have no caller to surface the throw to — progress.json carries the failure.
  }
}

async function still(event: StillEvent): Promise<{ sizeInBytes: number; url: string; outKey: string }> {
  const b = await bundle(ENTRY);
  try {
    const composition = await selectComposition({ serveUrl: b.serveUrl, id: event.composition, inputProps: event.inputProps ?? {} });
    const ext = event.imageFormat === 'png' ? 'png' : 'jpg';
    const out = `/tmp/still-${event.renderId}.${ext}`;
    await renderStill({
      composition,
      serveUrl: b.serveUrl,
      output: out,
      inputProps: event.inputProps ?? {},
      frame: event.frame,
      scale: event.scale,
      imageFormat: event.imageFormat,
      jpegQuality: event.jpegQuality,
    });
    const body = readFileSync(out);
    await s3.send(
      new PutObjectCommand({
        Bucket: event.bucket,
        Key: event.outName,
        Body: body,
        ContentType: event.imageFormat === 'png' ? 'image/png' : 'image/jpeg',
      }),
    );
    return { sizeInBytes: body.length, url: s3PublicUrl(event.bucket, event.region, event.outName), outKey: event.outName };
  } finally {
    await b.close();
  }
}

async function renderSegment(event: SegmentEvent): Promise<{ bucket: string; key: string; frames: number }> {
  const b = await bundle(ENTRY);
  try {
    const out = `/tmp/seg-${event.frameRange[0]}-${event.frameRange[1]}.mp4`;
    await renderMedia({
      composition: event.composition,
      serveUrl: b.serveUrl,
      outputLocation: out,
      inputProps: event.props ?? {},
      frameRange: event.frameRange,
      muted: true, // coordinator mixes audio across the whole timeline
    });
    await s3.send(new PutObjectCommand({ Bucket: event.bucket, Key: event.key, Body: readFileSync(out), ContentType: 'video/mp4' }));
    return { bucket: event.bucket, key: event.key, frames: event.frameRange[1] - event.frameRange[0] + 1 };
  } finally {
    await b.close();
  }
}
