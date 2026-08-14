// The frame-step capture engine used by the renderer (renderMedia/renderStill). Drives
// window.__setFrame(f) in chrome-headless-shell and screenshots each frame; captured-frame
// N == composition-frame N by construction. The browser flags mirror Remotion's so
// transformed/curved layers anti-alias identically.

import { renameSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import type { CollectedAsset } from '../core/assets';
import type { VideoConfig } from '../core/frame';
import { must } from '../core/must';

const RENDER_ARGS = [
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
  // On AWS Lambda: run the zygote/GPU in-process (the sandbox can't fork them), and talk
  // to chrome over a pipe (fds) rather than a localhost WebSocket — the WS endpoint is
  // unreliable on Lambda, which is what "Timed out waiting for the WS endpoint" was.
  // (HOME=/tmp, set in the image, gives chrome a writable config dir.)
  const lambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const args = lambda ? [...RENDER_ARGS, '--no-zygote', '--in-process-gpu'] : RENDER_ARGS;
  return puppeteer.launch({ executablePath, headless: 'shell', args, pipe: lambda });
}

export interface CaptureOptions {
  scale?: number | undefined;
  imageFormat?: 'png' | 'jpeg' | undefined;
  jpegQuality?: number | undefined;
  collectAudio?: boolean | undefined;
  /** called once per captured frame — lets renderMedia report smooth per-frame progress. */
  onFrame?: (() => void) | undefined;
}

/** Capture frames [lo, hi) into `dir` as f-NNNNN.{png|jpg} using ONE page of an
 *  already-launched browser; returns the media assets registered at each frame (for the
 *  audio mix) when collectAudio is set. */
async function captureRange(
  browser: Browser,
  stepUrl: string,
  lo: number,
  hi: number,
  dir: string,
  cfg: VideoConfig,
  opts: CaptureOptions = {},
): Promise<Map<number, CollectedAsset[]>> {
  const scale = opts.scale ?? 1;
  const jpeg = opts.imageFormat === 'jpeg';
  const assets = new Map<number, CollectedAsset[]>();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: scale });
    await page.goto(stepUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
    if (opts.collectAudio) await page.evaluate(() => window.remotion_collectAssets?.()); // drain initial-mount registrations
    for (let f = lo; f < hi; f++) {
      await page.evaluate((fr) => must(window.__setFrame)(fr), f);
      // screenshot and asset-collection are independent CDP calls — issue them
      // concurrently (mirrors Remotion's Promise.all(takeFrame, collectAssets)).
      // Write to a .part file then rename, so a concurrent reader (the streaming
      // encoder) only ever sees a complete frame.
      const final = join(dir, `f-${String(f).padStart(5, '0')}.${jpeg ? 'jpg' : 'png'}`);
      const [, a] = await Promise.all([
        page.screenshot({
          path: `${final}.part`,
          clip: { x: 0, y: 0, width: cfg.width, height: cfg.height },
          captureBeyondViewport: true,
          fromSurface: true,
          optimizeForSpeed: true,
          ...(jpeg ? { type: 'jpeg' as const, quality: opts.jpegQuality ?? 80 } : { type: 'png' as const }),
        }),
        opts.collectAudio ? page.evaluate(() => window.remotion_collectAssets?.() ?? []) : Promise.resolve([]),
      ]);
      renameSync(`${final}.part`, final);
      if (a.length) assets.set(f, a);
      opts.onFrame?.();
    }
  } finally {
    await page.close();
  }
  return assets;
}

/** Launch a browser, capture [lo, hi) in one page, close. render-media runs N of these
 *  in parallel (one browser per slice) — NOT one browser with N pages: capture is
 *  CDP-command-heavy and a single browser shares one CDP connection that serializes the
 *  per-frame commands, so N browsers (N parallel CDP connections) measured ~2x faster. */
export async function captureFrames(
  executablePath: string,
  stepUrl: string,
  lo: number,
  hi: number,
  dir: string,
  cfg: VideoConfig,
  opts: CaptureOptions = {},
): Promise<Map<number, CollectedAsset[]>> {
  const browser = await launchBrowser(executablePath);
  try {
    return await captureRange(browser, stepUrl, lo, hi, dir, cfg, opts);
  } finally {
    await browser.close();
  }
}
