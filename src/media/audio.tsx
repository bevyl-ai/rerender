// rerender/media — the <Audio> tag from the real @remotion/media. Sound only: mediabunny's
// AudioBufferSink, scheduled on the shared AudioContext (use-scheduled-audio.ts) — the exact
// same mechanism <Video> uses for its own embedded audio track, just without a picture side.
// Falls back to the native <Audio> (core/primitives, @remotion/media's <Html5Audio>
// equivalent) when the source can't be decoded this way. See docs/remotion-media-spec.md.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Loop, Sequence, useCurrentFrame, useIsPlaying, useVideoConfig } from '../core/frame';
import { getRemotionEnvironment } from '../core/env';
import { Audio as NativeAudio, type AudioProps as NativeAudioProps, useRenderAsset } from '../core/primitives';
import { getSharedDurationSeconds } from './shared-input';
import { useScheduledAudio } from './use-scheduled-audio';

export interface MediaAudioProps {
  /** URL of the audio (or video, for its audio track) file. Falls back to the native
   *  <Audio> for anything mediabunny can't decode (container/codec/network). */
  src: string;
  from?: number;
  durationInFrames?: number;
  trimBefore?: number;
  trimAfter?: number;
  volume?: number | ((frame: number) => number);
  playbackRate?: number;
  muted?: boolean;
  /** repeats the (trimmed) clip indefinitely for as long as the tag stays mounted. */
  loop?: boolean;
  /** Accepted for API compat with @remotion/media; both values currently behave like
   *  'repeat' — a volume callback's frame argument resets to 0 every loop iteration. */
  loopVolumeCurveBehavior?: 'repeat' | 'extend';
  /** Studio-timeline display hints; no-ops (no timeline UI in this build). */
  name?: string;
  showInTimeline?: boolean;
  /** Return 'fallback' to render the native <Audio> instead, or 'fail' to let the render fail. */
  onError?: (error: Error) => 'fallback' | 'fail';
  /** Fail instead of ever falling back to the native <Audio>. */
  disallowFallbackToHtml5Audio?: boolean;
  /** Extra props forwarded to the fallback native <Audio>. */
  fallbackHtml5AudioProps?: Partial<NativeAudioProps>;
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** A no-op outside a render (registerRenderAsset checks the env itself) — useScheduledAudio
 *  is what actually produces sound during preview. */
function useAudioRenderAsset(
  src: string,
  offset: number,
  playbackRate: number,
  volume: number | ((frame: number) => number) | undefined,
): void {
  const frame = useCurrentFrame();
  const resolvedVolume = typeof volume === 'function' ? volume(frame) : (volume ?? 1);
  useRenderAsset('audio', src, { offset, playbackRate, volume: resolvedVolume });
}

function AudioInner({
  src,
  trimBefore,
  trimAfter,
  playbackRate,
  volume,
  muted,
  loop,
  onDurationSeconds,
  onExtractError,
}: {
  src: string;
  trimBefore: number;
  trimAfter: number | undefined;
  playbackRate: number;
  volume: number | ((frame: number) => number) | undefined;
  muted: boolean;
  loop: boolean;
  onDurationSeconds: (seconds: number) => void;
  onExtractError: (error: unknown) => void;
}): null {
  const frame = useCurrentFrame();
  const playing = useIsPlaying();
  const { fps } = useVideoConfig();
  const resolvedSrc = useMemo(() => new URL(src, location.href).href, [src]);
  const rawSourceFrame = trimBefore + frame * playbackRate;
  const sourceFrame = trimAfter !== undefined ? Math.min(rawSourceFrame, trimAfter) : rawSourceFrame;
  const sourceFrameRef = useRef(sourceFrame);
  sourceFrameRef.current = sourceFrame;
  const effectiveVolume = muted ? 0 : volume;
  const isRendering = getRemotionEnvironment().isRendering;

  useAudioRenderAsset(src, trimBefore, playbackRate, effectiveVolume);

  const sinkResult = useScheduledAudio({
    src: resolvedSrc,
    enabled: !isRendering,
    playing,
    getCurrentSourceFrame: () => sourceFrameRef.current,
    fps,
    trimBefore,
    trimAfter,
    playbackRate,
    loop,
    muted,
    volume,
  });

  useEffect(() => {
    if (!sinkResult) return;
    if (sinkResult.type !== 'success') {
      onExtractError(new Error(`<Audio>: ${sinkResult.type} for ${resolvedSrc}`));
      return;
    }
    getSharedDurationSeconds(resolvedSrc)?.then(onDurationSeconds);
  }, [sinkResult, resolvedSrc, onDurationSeconds, onExtractError]);

  return null;
}

export function Audio({
  src,
  from = 0,
  durationInFrames = Number.POSITIVE_INFINITY,
  trimBefore = 0,
  trimAfter,
  volume,
  playbackRate = 1,
  muted = false,
  loop = false,
  name: _name,
  showInTimeline: _showInTimeline,
  onError,
  disallowFallbackToHtml5Audio = false,
  fallbackHtml5AudioProps,
}: MediaAudioProps): JSX.Element {
  const [mediaDurationFrames, setMediaDurationFrames] = useState<number | null>(null);
  const [fallback, setFallback] = useState(false);
  const [, throwToErrorBoundary] = useState<(() => void) | undefined>();
  const { fps } = useVideoConfig();

  const handleDurationSeconds = useCallback((seconds: number) => setMediaDurationFrames(Math.round(seconds * fps)), [fps]);

  const handleExtractError = useCallback(
    (rawError: unknown) => {
      const error = asError(rawError);
      const action = disallowFallbackToHtml5Audio ? 'fail' : (onError?.(error) ?? 'fallback');
      if (action === 'fail') {
        throwToErrorBoundary(() => {
          throw error;
        });
        return;
      }
      setFallback(true);
    },
    [onError, disallowFallbackToHtml5Audio],
  );

  if (fallback) {
    return (
      <Sequence from={from} durationInFrames={durationInFrames} layout="none">
        <NativeAudio
          src={src}
          trimBefore={trimBefore}
          trimAfter={trimAfter}
          playbackRate={playbackRate}
          volume={muted ? 0 : volume}
          {...fallbackHtml5AudioProps}
        />
      </Sequence>
    );
  }

  const loopSpan = trimAfter !== undefined ? trimAfter - trimBefore : (mediaDurationFrames ?? 0) - trimBefore;
  const content = (
    <AudioInner
      src={src}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      playbackRate={playbackRate}
      volume={volume}
      muted={muted}
      loop={loop}
      onDurationSeconds={handleDurationSeconds}
      onExtractError={handleExtractError}
    />
  );

  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      {loop && loopSpan > 0 ? (
        <Loop durationInFrames={loopSpan} layout="none">
          {content}
        </Loop>
      ) : (
        content
      )}
    </Sequence>
  );
}
