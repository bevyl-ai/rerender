// Compat-harness renderer: render a registered composition off the running Vite dev
// server to an mp4, via the shared frame-step capture engine. (The product renderer
// is src/renderer — this thin wrapper is what the compat tools shell out to.)
//
//   tsx render/render.ts [slices] [compId] [out.mp4]   STUDIO=1, TEMPLATE=<name>
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeExecutable } from './browser';
import { captureFrames, readConfig } from '../src/renderer/capture';

const BASE = process.env.RENDER_URL ?? 'http://127.0.0.1:5175';
const SLICES = Math.max(1, Number(process.argv[2] ?? 1));
const COMP = process.argv[3] ?? '';
const OUT = process.argv[4] ?? 'out.mp4';
const STUDIO = process.env.STUDIO === '1';
const TEMPLATE = process.env.TEMPLATE ?? 'helloworld';
const PAGE = STUDIO ? '/render/studio.html' : '/render/';
const STEP_URL = `${BASE}${PAGE}?step=1&template=${TEMPLATE}&comp=${COMP}`;

const ff = (args: string[]): void => {
  execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });
};

async function main(): Promise<void> {
  const exe = await chromeExecutable();
  const cfg = await readConfig(exe, STEP_URL);
  const dir = mkdtempSync(join(tmpdir(), 'remover-render-'));
  const per = Math.ceil(cfg.durationInFrames / SLICES);
  const ranges = Array.from({ length: SLICES }, (_, i) => [i * per, Math.min((i + 1) * per, cfg.durationInFrames)] as const).filter(
    ([a, b]) => a < b,
  );

  console.log(`rendering ${cfg.durationInFrames} frames (${cfg.width}x${cfg.height}@${cfg.fps}) in ${ranges.length} parallel slice(s)…`);
  const t0 = Date.now();
  await Promise.all(ranges.map(([a, b]) => captureFrames(exe, STEP_URL, a, b, dir, cfg)));
  console.log(`captured in ${((Date.now() - t0) / 1000).toFixed(1)}s wall-clock`);

  ff([
    '-framerate',
    String(cfg.fps),
    '-i',
    join(dir, 'f-%05d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-r',
    String(cfg.fps),
    '-movflags',
    '+faststart',
    OUT,
  ]);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error('render failed:', e);
  process.exit(1);
});
