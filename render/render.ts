// The server renderer: drive remover's own headless browser to each frame and
// screenshot the live preview — "record the preview", deterministically. Frames are
// sliced across N parallel browsers and assembled with ffmpeg. The browser is
// chrome-headless-shell via puppeteer-core (see browser.ts) — NOT Playwright.
//
//   tsx render/render.ts [slices] [compId] [out.mp4]      STUDIO=1 → registered-Root page
//
// Requires the Vite dev server running (RENDER_URL, default http://127.0.0.1:5175).
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeExecutable } from './browser';
import type { StageConfig } from './stage';

const BASE = process.env.RENDER_URL ?? 'http://127.0.0.1:5175';
const SLICES = Math.max(1, Number(process.argv[2] ?? 1));
const COMP = process.argv[3] ?? ''; // composition id (render page picks it from the registry)
const OUT = process.argv[4] ?? 'out.mp4';
const STUDIO = process.env.STUDIO === '1'; // render a registered-Root composition (real Remotion project)
const PAGE = STUDIO ? '/render/studio.html' : '/render/';
const stepUrl = (): string => `${BASE}${PAGE}?step=1&comp=${COMP}`;

const ff = (args: string[]): void => {
  execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });
};

let executablePath = '';
// Match Remotion's deterministic rasterization so curved/rotated edges anti-alias
// identically: swangle (software ANGLE) + no font hinting + sRGB. Without these,
// the same binary rasterizes transformed curves differently.
const ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
];

// Read the composition's config (dims/fps/duration) from the render page itself,
// so the renderer works for any composition — including a registered-Root one.
async function readConfig(): Promise<StageConfig> {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.goto(stepUrl(), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    const cfg = await page.evaluate(() => window.__config);
    if (!cfg) throw new Error('render page did not expose window.__config');
    return cfg;
  } finally {
    await browser.close();
  }
}

/** Drive the page to each frame and screenshot the live preview — recorded-frame N
 *  == composition-frame N by construction. Each browser owns a frame range and
 *  writes globally-numbered PNGs into a shared dir. */
async function captureExact(lo: number, hi: number, dir: string, cfg: StageConfig): Promise<void> {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: 1 });
    await page.goto(stepUrl(), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    for (let f = lo; f < hi; f++) {
      await page.evaluate((fr) => window.__setFrame!(fr), f);
      await page.screenshot({ path: join(dir, `f-${String(f).padStart(5, '0')}.png`), clip: { x: 0, y: 0, width: cfg.width, height: cfg.height } });
    }
    console.log(`  slice ${lo}–${hi} captured`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  executablePath = await chromeExecutable();
  const cfg = await readConfig();
  const dir = mkdtempSync(join(tmpdir(), 'remover-render-'));
  const per = Math.ceil(cfg.durationInFrames / SLICES);
  const ranges = Array.from({ length: SLICES }, (_, i) => [i * per, Math.min((i + 1) * per, cfg.durationInFrames)] as const).filter(([a, b]) => a < b);

  console.log(`rendering ${cfg.durationInFrames} frames (${cfg.width}x${cfg.height}@${cfg.fps}) in ${ranges.length} parallel slice(s)…`);
  const t0 = Date.now();
  await Promise.all(ranges.map(([a, b]) => captureExact(a, b, dir, cfg)));
  console.log(`captured in ${((Date.now() - t0) / 1000).toFixed(1)}s wall-clock`);

  ff(['-framerate', String(cfg.fps), '-i', join(dir, 'f-%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(cfg.fps), '-movflags', '+faststart', OUT]);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error('render failed:', e);
  process.exit(1);
});
