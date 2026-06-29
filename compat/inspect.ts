// remover compatibility — INSPECT. A repeatable parity debugger: render a
// composition on remover AND real Remotion at one frame, diff them, localize where
// they diverge, and (optionally) measure a keyed element's geometry in each + dump
// remover's DOM ancestor chain. This is the workflow that found the box-sizing bug:
// a size delta ⇒ a layout bug (box-sizing etc.); a center delta ⇒ positioning;
// near-zero geometry delta with a thin diff ⇒ irreducible sub-pixel AA.
//
//   npm run compat:inspect -- <compId> [frame] [r,g,b key] [domSelector]
//
// Needs the Vite dev server running. Renders the studio (registered-Root) page;
// Remotion renders the same template/src project.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromeExecutable } from '../render/browser';

const ID = process.argv[2] ?? 'MyVideo';
const FRAME = Number(process.argv[3] ?? 60);
const KEY = process.argv[4]; // optional "r,g,b" — measure this element's bbox in each render
const DOM = process.argv[5]; // optional CSS selector — dump remover's DOM ancestor chain
const BASE = process.env.RENDER_URL ?? 'http://127.0.0.1:5175';
// numeric-prefixed ids are examples (remotion/index.ts entry); else a studio template.
const IS_EXAMPLE = /^\d/.test(ID);
const TEMPLATE = process.env.TEMPLATE ?? 'helloworld';
const REMOTION_ENTRY = IS_EXAMPLE ? 'remotion/index.ts' : `templates/${TEMPLATE}/src/index.ts`;
const REMOVER_PAGE = IS_EXAMPLE ? `render/?step=1&comp=${ID}` : `render/studio.html?step=1&template=${TEMPLATE}&comp=${ID}`;
const OUTDIR = join(process.cwd(), 'compat', 'out');
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

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  count: number;
}
function bbox(png: PNG, pred: (r: number, g: number, b: number) => boolean): Box | null {
  const { width, height, data } = png;
  let minX = 1e9,
    minY = 1e9,
    maxX = -1,
    maxY = -1,
    count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pred(data[i]!, data[i + 1]!, data[i + 2]!)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, count };
}

async function dumpRemoverDom(selector: string): Promise<void> {
  const browser = await puppeteer.launch({ executablePath: await chromeExecutable(), headless: 'shell' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/${REMOVER_PAGE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    await page.evaluate((f) => window.__setFrame!(f), FRAME);
    const chain = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const out: unknown[] = [];
      let n: Element | null = el;
      while (n && n !== document.documentElement) {
        const s = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        out.push({
          tag: n.tagName,
          pos: s.position,
          transform: s.transform,
          boxSizing: s.boxSizing,
          overflow: s.overflow,
          rect: [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)],
        });
        n = n.parentElement;
      }
      return out;
    }, selector);
    console.log(`  remover DOM ancestor chain for "${selector}":`);
    for (const node of chain) console.log('    ' + JSON.stringify(node));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });
  const removerPng = join(OUTDIR, `inspect-${ID}-remover.png`);
  const remotionPng = join(OUTDIR, `inspect-${ID}-remotion.png`);

  // render the SAME project on both engines at the frame
  const mp4 = join(OUTDIR, `inspect-${ID}.mp4`);
  const env = IS_EXAMPLE ? { ...process.env } : { ...process.env, STUDIO: '1', TEMPLATE };
  execFileSync('npx', ['tsx', 'render/render.ts', '1', ID, mp4], { stdio: 'ignore', env });
  execFileSync('ffmpeg', ['-y', '-i', mp4, '-vf', `select='eq(n\\,${FRAME})'`, '-frames:v', '1', removerPng], { stdio: 'ignore' });
  execFileSync('npx', ['remotion', 'still', REMOTION_ENTRY, ID, remotionPng, `--frame=${FRAME}`], { stdio: 'ignore' });

  const a = readPng(removerPng);
  const b = readPng(remotionPng);
  const { width: W, height: H } = a;
  const diff = new PNG({ width: W, height: H });
  const differing = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.1 });
  writeFileSync(join(OUTDIR, `inspect-${ID}-diff.png`), PNG.sync.write(diff));

  console.log(`\n  compat:inspect — ${ID} @ frame ${FRAME}  (${W}x${H})`);
  console.log('  ' + '─'.repeat(64));
  console.log(`  diff: ${differing} px  (${(100 * (1 - differing / (W * H))).toFixed(3)}% match)`);

  // where are the differences? pixelmatch paints diffs red/yellow.
  const region = bbox(diff, (r, g, bl) => r > 180 && bl < 130);
  if (region) {
    console.log(`  diff concentrated in: x ${region.x}–${region.x + region.w}, y ${region.y}–${region.y + region.h}  (${region.count} px)`);
    const cx = Math.max(0, region.x - 12),
      cy = Math.max(0, region.y - 12);
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        join(OUTDIR, `inspect-${ID}-diff.png`),
        '-vf',
        `crop=${Math.min(W - cx, region.w + 24)}:${Math.min(H - cy, region.h + 24)}:${cx}:${cy}`,
        join(OUTDIR, `inspect-${ID}-diff-crop.png`),
      ],
      { stdio: 'ignore' },
    );
  } else {
    console.log('  diff concentrated in: (none — pixel-identical)');
  }

  if (KEY) {
    const [kr, kg, kb] = KEY.split(',').map(Number) as [number, number, number];
    const maxc = Math.max(kr, kg, kb);
    // match by the key's DOMINANT channel — robust to a semi-transparent element
    // blended over whatever background (an exact-rgb match misses the blend).
    const near = (r: number, g: number, bl: number): boolean =>
      maxc === kb
        ? bl > r + 15 && bl > g + 10 && bl > 70
        : maxc === kr
          ? r > g + 15 && r > bl + 10 && r > 70
          : g > r + 10 && g > bl + 10 && g > 70;
    const ra = bbox(a, near);
    const rb = bbox(b, near);
    console.log(`  element ~rgb(${KEY}) geometry:`);
    console.log(`    remover : center (${ra?.cx.toFixed(1)}, ${ra?.cy.toFixed(1)})  size ${ra?.w}x${ra?.h}`);
    console.log(`    remotion: center (${rb?.cx.toFixed(1)}, ${rb?.cy.toFixed(1)})  size ${rb?.w}x${rb?.h}`);
    if (ra && rb) {
      console.log(
        `    Δ center (${(ra.cx - rb.cx).toFixed(2)}, ${(ra.cy - rb.cy).toFixed(2)})  ·  Δ size (${ra.w - rb.w}, ${ra.h - rb.h})`,
      );
      console.log(`    → size Δ ⇒ layout bug (box-sizing/units); center Δ ⇒ positioning; ~0 both ⇒ sub-pixel AA only`);
    }
  }

  if (DOM) await dumpRemoverDom(DOM);

  console.log(`  artifacts: compat/out/inspect-${ID}-{remover,remotion,diff,diff-crop}.png\n`);
}

main().catch((e) => {
  console.error('inspect failed:', e);
  process.exit(1);
});
