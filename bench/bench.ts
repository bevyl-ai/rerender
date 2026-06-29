// remover vs Remotion — head-to-head render speed.
//
// Same composition, same entry (templates/<t>/src/index.ts — `import 'remotion'`
// resolves to remover under remover's bundler, to real Remotion under Remotion's),
// same output knobs (h264 · crf 18 · jpeg q80), same concurrency. Both engines
// expose the identical bundle → selectComposition → renderMedia pipeline.
//
// Primary metric: WARM render (pre-bundled serveUrl, render only), median of N
// trials after a warmup run. Reported separately: COLD bundle time, and frames/sec.
// Every output is ffprobe-verified to the expected frame count so we never time a
// silently-truncated render.
//
//   TEMPLATE=helloworld COMP=HelloWorld CONC=1,2,4,8 TRIALS=3 npx tsx bench/bench.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { bundle as removerBundle, renderMedia as removerRender, selectComposition as removerSelect } from '../src/renderer/index';
import { bundle as remotionBundle } from '@remotion/bundler';
import { renderMedia as remotionRender, selectComposition as remotionSelect } from '@remotion/renderer';

const TEMPLATE = process.env.TEMPLATE ?? 'helloworld';
const COMP = process.env.COMP ?? 'HelloWorld';
const ENTRY = resolve(process.cwd(), `templates/${TEMPLATE}/src/index.ts`);
const PUBLIC = resolve(process.cwd(), `templates/${TEMPLATE}/public`);
const CONCS = (process.env.CONC ?? '1,2,4,8').split(',').map(Number);
const TRIALS = Number(process.env.TRIALS ?? 3);
const CRF = 18;
const JPEG_Q = 80;
const CODEC = 'h264' as const;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const frameCount = (file: string): number => {
  const probe = (entry: string, count: boolean): number => {
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      `stream=${entry}`,
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      file,
    ];
    if (count) args.unshift('-count_frames');
    const n = Number(execFileSync('ffprobe', args, { encoding: 'utf8' }).trim());
    return Number.isFinite(n) ? n : 0;
  };
  return probe('nb_read_frames', true) || probe('nb_frames', false);
};

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return (performance.now() - t0) / 1000;
}

interface ConcResult {
  conc: number;
  median: number;
  min: number;
  trials: number[];
  frames: number;
  expected: number;
}
interface EngineResult {
  engine: string;
  bundleS: number;
  durationInFrames: number;
  results: ConcResult[];
}

async function benchRemover(dir: string): Promise<EngineResult> {
  const t0 = performance.now();
  const b = await removerBundle(ENTRY);
  const bundleS = (performance.now() - t0) / 1000;
  const comp = await removerSelect({ serveUrl: b.serveUrl, id: COMP, inputProps: {} });
  const results: ConcResult[] = [];
  for (const conc of CONCS) {
    const opts = {
      composition: comp,
      serveUrl: b.serveUrl,
      concurrency: conc,
      crf: CRF,
      codec: CODEC,
      imageFormat: 'jpeg' as const,
      jpegQuality: JPEG_Q,
    };
    await removerRender({ ...opts, outputLocation: join(dir, `rmv-warm-${conc}.mp4`) }); // warmup
    const ts: number[] = [];
    let last = '';
    for (let t = 0; t < TRIALS; t++) {
      last = join(dir, `rmv-${conc}-${t}.mp4`);
      ts.push(await timed(() => removerRender({ ...opts, outputLocation: last })));
    }
    results.push({ conc, median: median(ts), min: Math.min(...ts), trials: ts, frames: frameCount(last), expected: comp.durationInFrames });
  }
  await b.close();
  return { engine: 'remover', bundleS, durationInFrames: comp.durationInFrames, results };
}

async function benchRemotion(dir: string): Promise<EngineResult> {
  const t0 = performance.now();
  const serveUrl = await remotionBundle({ entryPoint: ENTRY, publicDir: PUBLIC });
  const bundleS = (performance.now() - t0) / 1000;
  const comp = await remotionSelect({ serveUrl, id: COMP, inputProps: {} });
  const results: ConcResult[] = [];
  for (const conc of CONCS) {
    const opts = {
      composition: comp,
      serveUrl,
      codec: CODEC,
      concurrency: conc,
      crf: CRF,
      imageFormat: 'jpeg' as const,
      jpegQuality: JPEG_Q,
      inputProps: {},
    };
    await remotionRender({ ...opts, outputLocation: join(dir, `rmt-warm-${conc}.mp4`) }); // warmup
    const ts: number[] = [];
    let last = '';
    for (let t = 0; t < TRIALS; t++) {
      last = join(dir, `rmt-${conc}-${t}.mp4`);
      ts.push(await timed(() => remotionRender({ ...opts, outputLocation: last })));
    }
    results.push({ conc, median: median(ts), min: Math.min(...ts), trials: ts, frames: frameCount(last), expected: comp.durationInFrames });
  }
  return { engine: 'remotion', bundleS, durationInFrames: comp.durationInFrames, results };
}

function report(rmv: EngineResult, rmt: EngineResult): void {
  const N = rmv.durationInFrames;
  console.log(`\n  remover vs Remotion · ${TEMPLATE}/${COMP} · ${N} frames · h264 crf${CRF} jpeg${JPEG_Q} · median of ${TRIALS}`);
  console.log('  ' + '─'.repeat(72));
  console.log(`  bundle (cold):  remover ${rmv.bundleS.toFixed(2)}s   remotion ${rmt.bundleS.toFixed(2)}s`);
  console.log('  ' + '─'.repeat(72));
  console.log('  conc │ remover (s)      fps   │ remotion (s)     fps   │ speedup (rmt/rmv)');
  console.log('  ' + '─'.repeat(72));
  for (const conc of CONCS) {
    const a = rmv.results.find((r) => r.conc === conc)!;
    const b = rmt.results.find((r) => r.conc === conc)!;
    const aok = a.frames === a.expected ? '' : `!${a.frames}`;
    const bok = b.frames === b.expected ? '' : `!${b.frames}`;
    const speed = b.median / a.median;
    const aFps = (N / a.median).toFixed(1);
    const bFps = (N / b.median).toFixed(1);
    console.log(
      `  ${String(conc).padStart(4)} │ ${a.median.toFixed(2).padStart(6)}${aok.padEnd(5)} ${aFps.padStart(7)}   │ ${b.median.toFixed(2).padStart(6)}${bok.padEnd(5)} ${bFps.padStart(7)}   │ ${speed.toFixed(2)}× ${speed >= 1 ? '(remover faster)' : '(remotion faster)'}`,
    );
  }
  console.log('  ' + '─'.repeat(72) + '\n');
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'remover-bench-'));
  try {
    console.log(`\n  benchmarking ${TEMPLATE}/${COMP} — conc=[${CONCS.join(',')}] trials=${TRIALS}`);
    console.log('  (remover first, then Remotion — sequential, no overlap)');
    const rmv = await benchRemover(dir);
    const rmt = await benchRemotion(dir);
    report(rmv, rmt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main();
