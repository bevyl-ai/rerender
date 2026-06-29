// renderStill — match @remotion/renderer. Capture a single frame to an image.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeExecutable } from '../../render/browser';
import { captureFrames } from './capture';
import type { VideoConfig } from './types';

export async function renderStill(options: {
  composition: VideoConfig;
  serveUrl: string;
  output: string;
  frame?: number;
  inputProps?: Record<string, unknown>;
  scale?: number;
  imageFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
}): Promise<{ buffer: null }> {
  const { composition: c, serveUrl, output } = options;
  const frame = options.frame ?? c.durationInFrames - 1;
  const imageFormat = options.imageFormat ?? 'png';
  const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
  const props = encodeURIComponent(JSON.stringify(options.inputProps ?? {}));
  const stepUrl = `${serveUrl}/?step=1&comp=${encodeURIComponent(c.id)}&props=${props}`;

  const dir = mkdtempSync(join(tmpdir(), 'remover-still-'));
  try {
    await captureFrames(await chromeExecutable(), stepUrl, frame, frame + 1, dir, c, {
      scale: options.scale,
      imageFormat,
      jpegQuality: options.jpegQuality,
    });
    copyFileSync(join(dir, `f-${String(frame).padStart(5, '0')}.${ext}`), output);
    return { buffer: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
