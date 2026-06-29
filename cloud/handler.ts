// AWS Lambda worker — renders ONE frame-range segment and uploads it to S3. The project
// is baked into the container image at REMOVER_ENTRY; each invocation bundles it,
// renders [lo,hi] silent (audio is mixed once on the coordinator), and writes the
// keyframe-started segment to s3://bucket/key. This is the per-VM unit, fanned out by
// the orchestrator (cloud/aws.ts → orchestrate.ts).
import { readFileSync } from 'node:fs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { bundle } from '../src/renderer/bundle';
import { renderMedia } from '../src/renderer/render-media';
import { selectComposition } from '../src/renderer/select-composition';

const ENTRY = process.env.REMOVER_ENTRY ?? '/var/task/project/src/index.ts';
const s3 = new S3Client({});

export interface SegmentEvent {
  comp: string;
  props?: Record<string, unknown>;
  frameRange: [number, number]; // inclusive [lo, hi]
  bucket: string;
  key: string;
}

export async function handler(event: SegmentEvent): Promise<{ bucket: string; key: string; frames: number }> {
  const b = await bundle(ENTRY);
  try {
    const composition = await selectComposition({ serveUrl: b.serveUrl, id: event.comp, inputProps: event.props ?? {} });
    const out = `/tmp/seg-${event.frameRange[0]}-${event.frameRange[1]}.mp4`;
    await renderMedia({
      composition,
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
