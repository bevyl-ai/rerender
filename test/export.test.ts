// End-to-end QA for the in-browser export. Builds nothing itself — it serves the already-built
// demo (dist/), drives the real "Export this to MP4" flow in the same headless Chrome the
// renderer uses, and asserts the EXPORTED mp4 actually contains the footage.
//
// This is the regression test for the bug I kept re-introducing by hand: the export composites
// each <Video> natively first and paints the DOM overlay (everything else) on top, so an OPAQUE
// composition root paints over the footage and it vanishes from the export — the output goes
// dark instead of showing the forest clip, with no error thrown. A pixel probe is the only thing
// that catches it. Run with `npm test` (which builds dist/ first).
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, computeExecutablePath, install } from '@puppeteer/browsers';
import puppeteer from 'puppeteer-core';

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '../dist');

// The client export decodes the footage with WebCodecs, which chrome-headless-shell (the binary
// the renderer uses) can't do — it stalls. So this test drives FULL Chrome's new headless mode
// (+ SwiftShader for a software GL backend that works headless/in CI). Pinned to the same build
// the renderer uses; override with RERENDER_CHROME_BUILD.
const CHROME_BUILD = process.env.RERENDER_CHROME_BUILD ?? '149.0.7790.0';
const CHROME_CACHE = join(fileURLToPath(new URL('.', import.meta.url)), '../node_modules/.rerender-chrome');

async function launchTestChrome(): ReturnType<typeof puppeteer.launch> {
  await install({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: CHROME_CACHE });
  const executablePath = computeExecutablePath({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: CHROME_CACHE });
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
  });
}
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

// Minimal static server for dist/ (SPA-fallback to index.html). Serves 200 with no range support
// on purpose — the export fetches whole clips via BlobSource, so this mirrors a Workers-assets host.
function serveDist(dir: string): Server {
  return createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = join(dir, rel === '/' ? 'index.html' : rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
}

interface Probe {
  vw: number;
  vh: number;
  grass: [number, number, number];
  whole: [number, number, number];
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ not built — run `npm run build` first (or `npm test`)');

  const server = serveDist(DIST);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}/`;
  const browser = await launchTestChrome();
  const failures: string[] = [];

  try {
    const page = await browser.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto(base, { waitUntil: 'load' });

    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /Export this to MP4/i.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    });
    if (!clicked) throw new Error('could not find the "Export this to MP4" button on the demo');

    // The done state mounts the exported clip as a <video> with a blob: src. Wait for it, then
    // pause + seek to a fixed time so the pixel probe is deterministic (not wherever loop is).
    try {
      await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.src.startsWith('blob:')), {
        timeout: 200_000, // the showcase comp is 210 frames; software-raster CI is slow
        polling: 500,
      });
    } catch {
      const state = await page.evaluate(
        () => document.body.innerText.match(/Exporting…\s*\d+%|Pixel-perfect|error/i)?.[0] ?? '(no export state)',
      );
      throw new Error(`export never produced an output clip — last state: "${state}"; page errors: ${jsErrors.join(' | ') || 'none'}`);
    }
    // NB: no named inner functions inside page.evaluate — tsx/esbuild rewrites them with a
    // `__name` helper that doesn't exist in the page, so everything here is inlined.
    const probe = (await page.evaluate(async () => {
      const v = Array.from(document.querySelectorAll('video')).find((x) => x.src.startsWith('blob:')) as HTMLVideoElement;
      v.pause();
      v.currentTime = 6.9; // the footage fills the frame only in the final act (it grows out of the hero card)
      await new Promise<void>((res) => {
        v.onseeked = () => res(undefined);
      });
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(v, 0, 0, 160, 90);
      // grass band = lower third (forest floor) — the part of the footage that must read through.
      const gd = ctx.getImageData(30, 60, 120, 28).data;
      let gr = 0;
      let gg = 0;
      let gb = 0;
      for (let i = 0; i < gd.length; i += 4) {
        gr += gd[i];
        gg += gd[i + 1];
        gb += gd[i + 2];
      }
      const gn = gd.length / 4;
      const wd = ctx.getImageData(0, 0, 160, 90).data;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      for (let i = 0; i < wd.length; i += 4) {
        wr += wd[i];
        wg += wd[i + 1];
        wb += wd[i + 2];
      }
      const wn = wd.length / 4;
      return {
        vw: v.videoWidth,
        vh: v.videoHeight,
        grass: [Math.round(gr / gn), Math.round(gg / gn), Math.round(gb / gn)] as [number, number, number],
        whole: [Math.round(wr / wn), Math.round(wg / wn), Math.round(wb / wn)] as [number, number, number],
      };
    })) as Probe;

    const sizeText = await page.evaluate(() => document.body.innerText.match(/[\d.]+\s*(KB|MB)/)?.[0] ?? '');

    const check = (name: string, ok: boolean, detail: string): void => {
      console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`);
      if (!ok) failures.push(`${name} (${detail})`);
    };
    const [gr, gg, gb] = probe.grass;
    const [wr, wg, wb] = probe.whole;
    check('output mp4 is 1280×720', probe.vw === 1280 && probe.vh === 720, `got ${probe.vw}×${probe.vh}`);
    check('footage shows in the export (grass reads green)', gg > gb && gg > 45, `grass=[${probe.grass}] — opaque-root regression?`);
    check('export frame is not black/blank', wr + wg + wb > 60, `mean rgb=[${probe.whole}]`);
    check('no uncaught errors during export', jsErrors.length === 0, jsErrors.join(' | '));
    console.log(`  → ${probe.vw}×${probe.vh}, ${sizeText}, grass=[${probe.grass}], whole=[${probe.whole}]`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\n✓ all export checks passed');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
