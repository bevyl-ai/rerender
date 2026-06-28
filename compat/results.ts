// remover compatibility — RESULTS layer.
//
// For each drop-in example, render the SAME composition file on real Remotion AND
// on remover, then pixel-diff a frame. Answers "does remover produce the same
// video Remotion would?" — and doubly-proves drop-in (one file, two renderers).
// Writes the rendered frames + a diff image to compat/out/ for inspection.
//
//   npm run compat:results            (needs the Vite dev server running)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// node-safe id list (importing the registry would pull in `remotion`, unresolved here).
const EXAMPLES = ['01-title', '02-sequence-spring', '03-video', '04-transitions', '05-audio-viz'];
const FRAME = 45;
const W = 1080;
const H = 1920;
const OUTDIR = join(process.cwd(), 'compat', 'out');

const sh = (cmd: string, args: string[]): void => {
  execFileSync(cmd, args, { stdio: 'ignore' });
};
const readPng = (path: string): PNG => PNG.sync.read(readFileSync(path));

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  console.log(`\n  remover · results parity vs real Remotion  (frame ${FRAME}, same composition file)`);
  console.log('  ' + '─'.repeat(64));

  for (const id of EXAMPLES) {
    try {
      // remover: render the example, extract the frame.
      const mp4 = join(OUTDIR, `${id}-remover.mp4`);
      execFileSync('npx', ['tsx', 'render/render.ts', '1', id, mp4], { stdio: 'ignore' });
      const removerPng = join(OUTDIR, `${id}-remover.png`);
      sh('ffmpeg', ['-y', '-i', mp4, '-vf', `select='eq(n\\,${FRAME})'`, '-frames:v', '1', removerPng]);

      // real Remotion: still at the same frame.
      const remotionPng = join(OUTDIR, `${id}-remotion.png`);
      sh('npx', ['remotion', 'still', 'remotion/index.ts', id, remotionPng, `--frame=${FRAME}`]);

      // diff
      const a = readPng(removerPng);
      const b = readPng(remotionPng);
      const diff = new PNG({ width: W, height: H });
      const differing = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.1 });
      writeFileSync(join(OUTDIR, `${id}-diff.png`), PNG.sync.write(diff));
      const total = W * H;
      const matchPct = (100 * (1 - differing / total)).toFixed(3);
      console.log(`  ${id.padEnd(22)} ${String(differing).padStart(8)} / ${total} px differ  →  ${matchPct}% match`);
    } catch (e) {
      console.log(`  ${id.padEnd(22)} render failed: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  console.log('  ' + '─'.repeat(64));
  console.log(`  frames + diffs written to compat/out/\n`);
}

main();
