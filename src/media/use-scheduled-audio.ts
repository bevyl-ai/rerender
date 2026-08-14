// Preview-only audio for <Video>/<Audio>: acquires the src's shared AudioBufferSink once
// (cheap to hold across prop changes — it's the same cached, refcounted sink every mounted
// clip on this src shares) and (re)starts Web Audio scheduling whenever playback state or
// the clip's time-mapping actually changes. Volume/muted are read live via a ref instead of
// being restart triggers, so a per-frame volume envelope doesn't glitch playback every frame.
import { useEffect, useRef, useState } from 'react';
import { startAudioPlayback } from './audio-playback';
import { type AudioSinkResult, acquireAudioSink, releaseAudioSink } from './audio-sink-cache';
import { getSharedDurationSeconds } from './shared-input';

export interface UseScheduledAudioOptions {
  src: string;
  /** false outside the Player (e.g. rendering) — this hook never runs a scheduler then. */
  enabled: boolean;
  playing: boolean;
  /** current source frame (already offset by trimBefore/playbackRate), read fresh whenever
   *  scheduling (re)starts — not a dependency, so scrubbing while paused doesn't restart it. */
  getCurrentSourceFrame: () => number;
  fps: number;
  trimBefore: number;
  trimAfter: number | undefined;
  playbackRate: number;
  loop: boolean;
  muted: boolean;
  volume: number | ((frame: number) => number) | undefined;
}

export function useScheduledAudio(opts: UseScheduledAudioOptions): AudioSinkResult | null {
  const { src, enabled } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  const [sinkResult, setSinkResult] = useState<AudioSinkResult | null>(null);

  // Acquire/release the shared sink — only when src or enabled changes, never on a
  // volume/rate/trim tweak, so those don't re-parse or re-decode anything.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSinkResult(null);
    acquireAudioSink(src).then((result) => {
      if (!cancelled) setSinkResult(result);
    });
    return () => {
      cancelled = true;
      releaseAudioSink(src);
    };
  }, [src, enabled]);

  // Start/stop scheduling — every dependency here is something that changes the clip's
  // time-mapping (or play state), each of which needs a clean restart from the current frame.
  const { playing, fps, trimBefore, trimAfter, playbackRate, loop } = opts;
  useEffect(() => {
    if (!enabled || !playing || sinkResult?.type !== 'success') return;

    const durationSeconds = getSharedDurationSeconds(src);
    if (!durationSeconds) return;

    let handle: ReturnType<typeof startAudioPlayback> | null = null;
    let cancelled = false;

    durationSeconds.then((mediaDurationSeconds) => {
      if (cancelled) return;
      const endSeconds = trimAfter !== undefined ? Math.min(trimAfter / fps, mediaDurationSeconds) : mediaDurationSeconds;
      const startSeconds = latest.current.getCurrentSourceFrame() / fps;

      handle = startAudioPlayback({
        sink: sinkResult.sink,
        startSeconds,
        endSeconds,
        loopStartSeconds: trimBefore / fps,
        loop,
        playbackRate,
        getVolume: (mediaSeconds) => {
          const { muted, volume } = latest.current;
          if (muted) return 0;
          if (typeof volume !== 'function') return volume ?? 1;
          // Invert sourceFrame = trimBefore + localFrame*playbackRate back to the local
          // (sequence-relative) frame the volume callback expects.
          const localFrame = (mediaSeconds * fps - trimBefore) / playbackRate;
          return volume(localFrame);
        },
      });
    });

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [enabled, playing, sinkResult, src, fps, trimBefore, trimAfter, playbackRate, loop]);

  return sinkResult;
}
