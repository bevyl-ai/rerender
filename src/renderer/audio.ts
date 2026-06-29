// Audio assembly — turn per-frame collected assets into timeline positions, then mix
// + mux into the silent video. POC: scalar volume, playbackRate 1. Mirrors
// @remotion/renderer's calculateAssetPositions + the atrim/adelay/volume → amix pass.
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import type { CollectedAsset } from '../core/assets';

export interface AssetPosition {
  type: 'audio' | 'video';
  src: string;
  id: string;
  startInVideo: number; // first composition frame the asset appears
  duration: number; // frame count
  trimLeft: number; // source-media frame at startInVideo
  volume: number;
  playbackRate: number;
}

/** Walk per-frame assets, tracking each id's contiguous spans → AssetPositions. */
export function calculateAssetPositions(frames: Map<number, CollectedAsset[]>): AssetPosition[] {
  const byId = new Map<string, Map<number, CollectedAsset>>();
  for (const [f, list] of frames) {
    for (const a of list) {
      if (!byId.has(a.id)) byId.set(a.id, new Map());
      byId.get(a.id)!.set(f, a);
    }
  }

  const positions: AssetPosition[] = [];
  for (const perFrame of byId.values()) {
    const sorted = [...perFrame.keys()].sort((x, y) => x - y);
    let runStart = sorted[0]!;
    let prev = sorted[0]!;
    const flush = (start: number, end: number): void => {
      const a = perFrame.get(start)!;
      positions.push({ type: a.type, src: a.src, id: a.id, startInVideo: start, duration: end - start + 1, trimLeft: a.mediaFrame, volume: a.volume, playbackRate: a.playbackRate });
    };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== prev + 1) {
        flush(runStart, prev);
        runStart = sorted[i]!;
      }
      prev = sorted[i]!;
    }
    flush(runStart, prev);
  }
  return positions;
}

/** Mix the asset audio and mux it into the silent video → output. */
export function muxAudio(silentVideo: string, output: string, positions: AssetPosition[], fps: number, sampleRate = 44100): void {
  if (positions.length === 0) {
    copyFileSync(silentVideo, output);
    return;
  }

  const inputs = ['-i', silentVideo];
  positions.forEach((p) => inputs.push('-i', p.src));

  const filters = positions.map((p, i) => {
    const trimStart = p.trimLeft / fps;
    const trimDur = p.duration / fps;
    const delayMs = Math.round((p.startInVideo / fps) * 1000);
    return `[${i + 1}:a]atrim=start=${trimStart.toFixed(6)}:duration=${trimDur.toFixed(6)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=${p.volume}[a${i}]`;
  });
  const mixInputs = positions.map((_, i) => `[a${i}]`).join('');
  filters.push(`${mixInputs}amix=inputs=${positions.length}:normalize=0[aout]`);

  // -shortest would clip the video to the audio length; keep the full video and let
  // the audio stream end naturally (silence after).
  execFileSync(
    'ffmpeg',
    ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-ar', String(sampleRate), '-movflags', '+faststart', output],
    { stdio: 'ignore' },
  );
}
