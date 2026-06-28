// The server renderer: record the composition playing in a real (headless) browser
// — "record the preview", server-side, no permission prompt. Splits the timeline
// into N slices, records each in PARALLEL, trims each to its exact frames, and
// stitches with ffmpeg concat.
//
//   tsx render/render.ts [slices]
//
// Requires the Vite dev server running (RENDER_URL, default http://127.0.0.1:5175).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.RENDER_URL ?? 'http://127.0.0.1:5175';
const config = { w: 1080, h: 1920, fps: 30, dur: 90 };
const SLICES = Math.max(1, Number(process.argv[2] ?? 1));

interface Slice {
  from: number;
  to: number;
  webm: string;
  idx: number;
}

async function recordSlice(from: number, to: number, dir: string, idx: number): Promise<Slice> {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
  const context = await browser.newContext({
    viewport: { width: config.w, height: config.h },
    recordVideo: { dir, size: { width: config.w, height: config.h } },
  });
  const page = await context.newPage();
  const url = `${BASE}/render/?w=${config.w}&h=${config.h}&fps=${config.fps}&dur=${config.dur}&from=${from}&to=${to}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__renderDone === true, undefined, { timeout: 120_000 });
  const video = page.video();
  await context.close(); // finalizes the recording (close ASAP after done = minimal trailing)
  await browser.close();
  if (!video) throw new Error('no video recorded');
  const webm = join(dir, `seg-${String(idx).padStart(3, '0')}.webm`);
  renameSync(await video.path(), webm);
  console.log(`  slice ${idx}: frames ${from}–${to} recorded`);
  return { from, to, webm, idx };
}

const ff = (args: string[]): void => execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });

/** Convert a slice recording to CFR mp4 and keep exactly its played frames
 *  (the play happens at the END of the recording, after the page-load lead-in). */
function trimToFrames(s: Slice, dir: string): string {
  const frames = s.to - s.from;
  const cfr = join(dir, `cfr-${s.idx}.mp4`);
  ff(['-i', s.webm, '-fps_mode', 'cfr', '-r', String(config.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', cfr]);
  const total = Number(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nk=1:nw=1', cfr]).toString().trim(),
  );
  const start = Math.max(0, total - frames);
  const out = join(dir, `trim-${String(s.idx).padStart(3, '0')}.mp4`);
  ff(['-i', cfr, '-vf', `select='gte(n\\,${start})',setpts=PTS-STARTPTS`, '-frames:v', String(frames), '-r', String(config.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out]);
  return out;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'remover-render-'));
  const per = Math.ceil(config.dur / SLICES);
  const ranges = Array.from({ length: SLICES }, (_, i) => [i * per, Math.min((i + 1) * per, config.dur)] as const).filter(([a, b]) => a < b);

  console.log(`rendering ${config.dur} frames in ${ranges.length} parallel slice(s) (record-the-preview, headless)…`);
  const t0 = Date.now();
  const slices = await Promise.all(ranges.map(([a, b], i) => recordSlice(a, b, dir, i)));
  console.log(`recorded ${slices.length} slice(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s wall-clock`);

  const trimmed = slices.sort((a, b) => a.from - b.from).map((s) => trimToFrames(s, dir));

  const list = join(dir, 'list.txt');
  writeFileSync(list, trimmed.map((m) => `file '${m}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
  console.log('wrote out.mp4');
}

main().catch((e) => {
  console.error('render failed:', e);
  process.exit(1);
});
