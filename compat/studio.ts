// remover compatibility — STUDIO parity over a GALLERY of real Remotion templates.
//
// Renders each real project under templates/<name>/ (registerRoot + <Composition>)
// on remover AND on real Remotion, then pixel-diffs a frame. Proves whole
// off-the-shelf templates drop in unchanged.
//
//   npm run compat:studio                       (whole gallery)
//   TEMPLATE=overlay COMP=Overlay npm run compat:studio   (just one)
//
// Needs the Vite dev server running.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const FRAME = Number(process.env.FRAME ?? 60);
const W = 1920;
const H = 1080;
const OUTDIR = join(process.cwd(), 'compat', 'out');

const GALLERY = process.env.COMP
  ? [{ template: process.env.TEMPLATE ?? 'helloworld', comp: process.env.COMP }]
  : [
      { template: 'helloworld', comp: 'HelloWorld' },
      { template: 'helloworld', comp: 'OnlyLogo' },
      { template: 'overlay', comp: 'Overlay' },
    ];

// Flatten onto black: remover screenshots opaque (black page bg) while Remotion's
// PNG still keeps transparency — both engines' VIDEO output is opaque black for a
// transparent composition, so compare on that basis.
function readPng(p: string): PNG {
  const png = PNG.sync.read(readFileSync(p));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    d[i] = Math.round(d[i]! * a);
    d[i + 1] = Math.round(d[i + 1]! * a);
    d[i + 2] = Math.round(d[i + 2]! * a);
    d[i + 3] = 255;
  }
  return png;
}

function renderPair(template: string, comp: string): number {
  const mp4 = join(OUTDIR, `studio-${comp}-remover.mp4`);
  execFileSync('npx', ['tsx', 'render/render.ts', '1', comp, mp4], {
    stdio: 'ignore',
    env: { ...process.env, STUDIO: '1', TEMPLATE: template },
  });
  const removerPng = join(OUTDIR, `studio-${comp}-remover.png`);
  execFileSync('ffmpeg', ['-y', '-i', mp4, '-vf', `select='eq(n\\,${FRAME})'`, '-frames:v', '1', removerPng], { stdio: 'ignore' });

  const remotionPng = join(OUTDIR, `studio-${comp}-remotion.png`);
  execFileSync('npx', ['remotion', 'still', `templates/${template}/src/index.ts`, comp, remotionPng, `--frame=${FRAME}`], {
    stdio: 'ignore',
  });

  const a = readPng(removerPng);
  const b = readPng(remotionPng);
  const diff = new PNG({ width: W, height: H });
  const differing = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.1 });
  writeFileSync(join(OUTDIR, `studio-${comp}-diff.png`), PNG.sync.write(diff));
  return differing;
}

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  console.log('\n  remover · studio parity — REAL Remotion templates, dropped in unchanged');
  console.log('  ' + '─'.repeat(66));
  const total = W * H;
  for (const { template, comp } of GALLERY) {
    try {
      const differing = renderPair(template, comp);
      console.log(
        `  ${`${template}/${comp}`.padEnd(26)} ${String(differing).padStart(8)} / ${total} px  →  ${(100 * (1 - differing / total)).toFixed(3)}% match`,
      );
    } catch (e) {
      console.log(`  ${`${template}/${comp}`.padEnd(26)} render failed: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  console.log('  ' + '─'.repeat(66) + '\n');
}

main();
