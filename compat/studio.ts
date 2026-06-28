// remover compatibility — STUDIO parity.
//
// Renders a REAL Remotion project (template/src: registerRoot + <Composition> +
// defaultProps) on remover's registry path AND on real Remotion, then pixel-diffs
// a frame. Proves a whole Remotion project — not just a bare composition — drops in.
//
//   npm run compat:studio             (needs the Vite dev server running)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ID = 'MyVideo';
const FRAME = Number(process.env.FRAME ?? 60);
const W = 1920;
const H = 1080;
const OUTDIR = join(process.cwd(), 'compat', 'out');

const readPng = (p: string): PNG => PNG.sync.read(readFileSync(p));

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  console.log('\n  remover · studio parity — a REAL Remotion project (registerRoot + <Composition>)');
  console.log('  ' + '─'.repeat(66));

  // remover: render the registered composition, frame-exact, via the studio page.
  const mp4 = join(OUTDIR, `studio-${ID}-remover.mp4`);
  execFileSync('npx', ['tsx', 'render/render.ts', '1', ID, mp4], { stdio: 'ignore', env: { ...process.env, EXACT: '1', STUDIO: '1' } });
  const removerPng = join(OUTDIR, `studio-${ID}-remover.png`);
  execFileSync('ffmpeg', ['-y', '-i', mp4, '-vf', `select='eq(n\\,${FRAME})'`, '-frames:v', '1', removerPng], { stdio: 'ignore' });

  // real Remotion: a still from the SAME project files.
  const remotionPng = join(OUTDIR, `studio-${ID}-remotion.png`);
  execFileSync('npx', ['remotion', 'still', 'template/src/index.ts', ID, remotionPng, `--frame=${FRAME}`], { stdio: 'ignore' });

  const a = readPng(removerPng);
  const b = readPng(remotionPng);
  const diff = new PNG({ width: W, height: H });
  const differing = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.1 });
  writeFileSync(join(OUTDIR, `studio-${ID}-diff.png`), PNG.sync.write(diff));
  const total = W * H;
  console.log(`  ${ID.padEnd(22)} ${String(differing).padStart(8)} / ${total} px differ  →  ${(100 * (1 - differing / total)).toFixed(3)}% match`);
  console.log('  ' + '─'.repeat(66));
  console.log('  (the same template/src project, rendered on remover and on real Remotion)\n');
}

main();
