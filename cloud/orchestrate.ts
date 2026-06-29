// remover cloud — fan a render out across N workers, collect the segments, concat.
// The invoker is pluggable: the same orchestration drives AWS Lambda invocations in
// production and local subprocesses in dev/test. Each worker renders ONE frame-range
// segment (keyframe-started, silent); concatSegments stitches them with no re-encode.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { concatSegments } from '../src/renderer/encode';
import { bundle } from '../src/renderer/bundle';
import { selectComposition } from '../src/renderer/select-composition';
import type { VideoCodec } from '../src/renderer/types';

export interface SegmentJob {
  comp: string;
  props: Record<string, unknown>;
  frameRange: [number, number]; // inclusive [lo, hi]
  index: number;
}

/** Produce the segment for `job` at `localSegmentPath` (download it locally if remote). */
export type Invoker = (job: SegmentJob, localSegmentPath: string) => Promise<void>;

export interface OrchestrateOptions {
  entry: string;
  comp: string;
  props?: Record<string, unknown>;
  /** number of workers / segments to split the render into */
  workers: number;
  output: string;
  invoke: Invoker;
  codec?: VideoCodec;
  onProgress?: (done: number, total: number) => void;
}

/** Split [0, durationInFrames) into `workers` contiguous inclusive ranges. */
export function planSlices(durationInFrames: number, workers: number): [number, number][] {
  const per = Math.ceil(durationInFrames / workers);
  return Array.from({ length: workers }, (_, i) => [i * per, Math.min((i + 1) * per, durationInFrames) - 1] as [number, number]).filter(([a, b]) => a <= b);
}

export async function orchestrateRender(opts: OrchestrateOptions): Promise<{ slices: number; durationInFrames: number; fps: number }> {
  // Resolve composition metadata locally (duration/fps) to plan the slices.
  const b = await bundle(opts.entry);
  const composition = await selectComposition({ serveUrl: b.serveUrl, id: opts.comp, inputProps: opts.props ?? {} });
  await b.close();

  const slices = planSlices(composition.durationInFrames, opts.workers);
  const dir = mkdtempSync(join(tmpdir(), 'remover-cloud-'));
  try {
    const segmentPaths = slices.map((_, i) => join(dir, `seg-${i}.mp4`));
    let done = 0;
    await Promise.all(
      slices.map(async (frameRange, index) => {
        await opts.invoke({ comp: opts.comp, props: opts.props ?? {}, frameRange, index }, segmentPaths[index]!);
        opts.onProgress?.(++done, slices.length);
      }),
    );
    await concatSegments(segmentPaths, opts.codec ?? 'avc', composition.fps, opts.output);
    return { slices: slices.length, durationInFrames: composition.durationInFrames, fps: composition.fps };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Dev/test invoker: run the worker as a local subprocess (`remover render --frames …`).
 *  Stands in for a firecracker VM / Lambda without any cloud. */
export function localInvoker(entry: string): Invoker {
  return async (job, localSegmentPath) => {
    const { spawn } = await import('node:child_process');
    const binUrl = new URL('../bin/remover.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const bin = fileURLToPath(binUrl);
    const args = [bin, 'render', entry, job.comp, '--frames', `${job.frameRange[0]}-${job.frameRange[1]}`, '--muted', '--output', localSegmentPath];
    if (Object.keys(job.props).length) args.push('--props', JSON.stringify(job.props));
    await new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, args, { stdio: 'ignore' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${job.index} exited ${code}`))));
      p.on('error', reject);
    });
  };
}
