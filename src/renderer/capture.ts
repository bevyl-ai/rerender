// The frame-step capture engine, shared by the compat harness (render/render.ts)
// and the renderer (renderMedia/renderStill). Drives window.__setFrame(f) in
// chrome-headless-shell and screenshots each frame; recorded-frame N ==
// composition-frame N by construction. The browser flags mirror Remotion's so
// transformed/curved layers anti-alias identically.
import puppeteer, { type Browser } from 'puppeteer-core';
import { join } from 'node:path';
import type { StageConfig } from '../../render/stage';
import type { CollectedAsset } from '../core/assets';

export const RENDER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--mute-audio',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--force-gpu-mem-available-mb=4096',
  '--disable-vulkan-surface',
  '--disable-vulkan-fallback-to-gl-for-testing',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required',
];

export function launchBrowser(executablePath: string): Promise<Browser> {
  return puppeteer.launch({ executablePath, headless: 'shell', args: RENDER_ARGS });
}

/** Read the composition's config (dims/fps/duration) from the render page itself. */
export async function readConfig(executablePath: string, stepUrl: string): Promise<StageConfig> {
  const browser = await launchBrowser(executablePath);
  try {
    const page = await browser.newPage();
    await page.goto(stepUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    const cfg = await page.evaluate(() => window.__config);
    if (!cfg) throw new Error('render page did not expose window.__config');
    return cfg;
  } finally {
    await browser.close();
  }
}

export interface CaptureOptions {
  scale?: number;
  imageFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
  collectAudio?: boolean;
}

/** Capture frames [lo, hi) into `dir` as f-NNNNN.{png|jpg}; returns the media assets
 *  registered at each frame (for the audio mix) when collectAudio is set. */
export async function captureFrames(
  executablePath: string,
  stepUrl: string,
  lo: number,
  hi: number,
  dir: string,
  cfg: StageConfig,
  opts: CaptureOptions = {},
): Promise<Map<number, CollectedAsset[]>> {
  const scale = opts.scale ?? 1;
  const jpeg = opts.imageFormat === 'jpeg';
  const assets = new Map<number, CollectedAsset[]>();
  const browser = await launchBrowser(executablePath);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: scale });
    await page.goto(stepUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    if (opts.collectAudio) await page.evaluate(() => window.remotion_collectAssets?.()); // drain initial-mount registrations
    for (let f = lo; f < hi; f++) {
      await page.evaluate((fr) => window.__setFrame!(fr), f);
      await page.screenshot({
        path: join(dir, `f-${String(f).padStart(5, '0')}.${jpeg ? 'jpg' : 'png'}`),
        clip: { x: 0, y: 0, width: cfg.width, height: cfg.height },
        captureBeyondViewport: true,
        fromSurface: true,
        optimizeForSpeed: true,
        ...(jpeg ? { type: 'jpeg' as const, quality: opts.jpegQuality ?? 80 } : { type: 'png' as const }),
      });
      if (opts.collectAudio) {
        const a = await page.evaluate(() => window.remotion_collectAssets?.() ?? []);
        if (a.length) assets.set(f, a);
      }
    }
  } finally {
    await browser.close();
  }
  return assets;
}
