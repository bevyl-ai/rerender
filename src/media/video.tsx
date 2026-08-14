// rerender/media — the <Video> tag from the real @remotion/media. Picture: mediabunny's
// CanvasSink (random-access frame-exact decode, shared per src) drawn onto a <canvas>.
// Sound: mediabunny's AudioBufferSink, scheduled on the shared AudioContext (see
// use-scheduled-audio.ts) — the same shared decode a plain <Video> also uses for its own
// audio track, no second element, no second fetch. Falls back to <OffthreadVideo> when the
// source can't be decoded this way (unsupported codec/container, no WebCodecs, network
// failure). See docs/remotion-media-spec.md for how this maps to the real implementation.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Loop, Sequence, useCurrentFrame, useIsPlaying, useVideoConfig } from '../core/frame';
import { continueRender, delayRender } from '../core/delay-render';
import { getRemotionEnvironment } from '../core/env';
import { Video as OffthreadVideo, type VideoProps as OffthreadVideoProps, useRenderAsset } from '../core/primitives';
import { getSharedDurationSeconds } from './shared-input';
import { useScheduledAudio } from './use-scheduled-audio';
import { acquireVideoSink, releaseVideoSink, type VideoSinkResult } from './video-sink-cache';

export interface MediaVideoProps {
  /** URL of the video file — a remote URL or a local file via staticFile(). Falls back to
   *  <OffthreadVideo> for anything mediabunny can't decode (container/codec/network). */
  src: string;
  /** frame this clip starts at, relative to the parent timeline. Default 0. */
  from?: number;
  /** frames this clip stays mounted. Default Infinity. */
  durationInFrames?: number;
  /** source frame to start at. Default 0. */
  trimBefore?: number;
  /** source frame to stop at. */
  trimAfter?: number;
  volume?: number | ((frame: number) => number);
  playbackRate?: number;
  muted?: boolean;
  /** repeats the (trimmed) clip indefinitely for as long as the tag stays mounted. */
  loop?: boolean;
  /** Accepted for API compat with @remotion/media; both values currently behave like
   *  'repeat' — a volume callback's frame argument resets to 0 every loop iteration. */
  loopVolumeCurveBehavior?: 'repeat' | 'extend';
  style?: CSSProperties;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /** Studio-timeline display hints; no-ops (no timeline UI in this build). */
  name?: string;
  showInTimeline?: boolean;
  /** Return 'fallback' to render <OffthreadVideo> instead, or 'fail' to let the render fail.
   *  Not called for a failure that occurs *within* the OffthreadVideo fallback itself. */
  onError?: (error: Error) => 'fallback' | 'fail';
  /** Fail instead of ever falling back to <OffthreadVideo>. */
  disallowFallbackToOffthreadVideo?: boolean;
  /** Extra props forwarded to the fallback <OffthreadVideo>. */
  fallbackOffthreadVideoProps?: Partial<OffthreadVideoProps>;
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Registers this clip's audio for the render's mix — a no-op outside a render
 *  (registerRenderAsset checks the env itself), so calling it unconditionally is free
 *  during preview, where useScheduledAudio is the thing actually producing sound instead. */
function useVideoRenderAsset(
  src: string,
  offset: number,
  playbackRate: number,
  volume: number | ((frame: number) => number) | undefined,
): void {
  const frame = useCurrentFrame();
  const resolvedVolume = typeof volume === 'function' ? volume(frame) : (volume ?? 1);
  useRenderAsset('video', src, { offset, playbackRate, volume: resolvedVolume });
}

/** The picture: acquires the src's shared CanvasSink once, then draws the frame nearest
 *  `targetSeconds` on every change. Blocks the render (delayRender/continueRender) until
 *  that frame is painted. */
function VideoCanvas({
  src,
  targetSeconds,
  objectFit,
  onDurationSeconds,
  onExtractError,
}: {
  src: string;
  targetSeconds: number;
  objectFit: NonNullable<MediaVideoProps['objectFit']>;
  onDurationSeconds: (seconds: number) => void;
  onExtractError: (error: unknown) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sinkResult, setSinkResult] = useState<VideoSinkResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    acquireVideoSink(src).then(
      (result) => {
        if (cancelled) return;
        if (result.type !== 'success') {
          onExtractError(new Error(`<Video>: ${result.type} for ${src}`));
          return;
        }
        setSinkResult(result);
      },
      (error) => {
        if (!cancelled) onExtractError(error);
      },
    );
    return () => {
      cancelled = true;
      setSinkResult(null);
      releaseVideoSink(src);
    };
  }, [src, onExtractError]);

  useEffect(() => {
    if (sinkResult?.type !== 'success') return;
    const durationSeconds = getSharedDurationSeconds(src);
    durationSeconds?.then(onDurationSeconds);
  }, [sinkResult, src, onDurationSeconds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sinkResult?.type !== 'success') return;
    let cancelled = false;
    const handle = delayRender(`<Video>: extracting frame of ${src} at ${targetSeconds}s`);

    sinkResult.sink
      .getCanvas(targetSeconds)
      .then((wrapped) => {
        if (cancelled || !wrapped) return;
        if (canvas.width !== wrapped.canvas.width || canvas.height !== wrapped.canvas.height) {
          canvas.width = wrapped.canvas.width;
          canvas.height = wrapped.canvas.height;
        }
        canvas.getContext('2d')?.drawImage(wrapped.canvas, 0, 0);
      })
      .catch((error) => {
        if (!cancelled) onExtractError(error);
      })
      .finally(() => continueRender(handle));

    return () => {
      cancelled = true;
      continueRender(handle);
    };
  }, [sinkResult, targetSeconds, src, onExtractError]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit }} />;
}

function VideoInner({
  src,
  trimBefore,
  trimAfter,
  playbackRate,
  volume,
  muted,
  loop,
  objectFit,
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
  objectFit: NonNullable<MediaVideoProps['objectFit']>;
  onDurationSeconds: (seconds: number) => void;
  onExtractError: (error: unknown) => void;
}): JSX.Element {
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

  useVideoRenderAsset(src, trimBefore, playbackRate, effectiveVolume);

  useScheduledAudio({
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

  return (
    <VideoCanvas
      src={resolvedSrc}
      targetSeconds={sourceFrame / fps}
      objectFit={objectFit}
      onDurationSeconds={onDurationSeconds}
      onExtractError={onExtractError}
    />
  );
}

export function Video({
  src,
  from = 0,
  durationInFrames = Number.POSITIVE_INFINITY,
  trimBefore = 0,
  trimAfter,
  volume,
  playbackRate = 1,
  muted = false,
  loop = false,
  style,
  className,
  objectFit = 'contain',
  name: _name,
  showInTimeline: _showInTimeline,
  onError,
  disallowFallbackToOffthreadVideo = false,
  fallbackOffthreadVideoProps,
}: MediaVideoProps): JSX.Element {
  const [mediaDurationFrames, setMediaDurationFrames] = useState<number | null>(null);
  const [fallback, setFallback] = useState(false);
  const [, throwToErrorBoundary] = useState<(() => void) | undefined>();
  const { fps } = useVideoConfig();

  const handleDurationSeconds = useCallback((seconds: number) => setMediaDurationFrames(Math.round(seconds * fps)), [fps]);

  const handleExtractError = useCallback(
    (rawError: unknown) => {
      const error = asError(rawError);
      const action = disallowFallbackToOffthreadVideo ? 'fail' : (onError?.(error) ?? 'fallback');
      if (action === 'fail') {
        throwToErrorBoundary(() => {
          throw error;
        });
        return;
      }
      setFallback(true);
    },
    [onError, disallowFallbackToOffthreadVideo],
  );

  if (fallback) {
    return (
      <Sequence from={from} durationInFrames={durationInFrames} layout="none">
        <OffthreadVideo
          src={src}
          trimBefore={trimBefore}
          trimAfter={trimAfter}
          playbackRate={playbackRate}
          volume={volume}
          muted={muted}
          style={style}
          className={className}
          {...fallbackOffthreadVideoProps}
        />
      </Sequence>
    );
  }

  const loopSpan = trimAfter !== undefined ? trimAfter - trimBefore : (mediaDurationFrames ?? 0) - trimBefore;
  const content = (
    <VideoInner
      src={src}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      playbackRate={playbackRate}
      volume={volume}
      muted={muted}
      loop={loop}
      objectFit={objectFit}
      onDurationSeconds={handleDurationSeconds}
      onExtractError={handleExtractError}
    />
  );

  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }} className={className}>
        {loop && loopSpan > 0 ? (
          <Loop durationInFrames={loopSpan} layout="none">
            {content}
          </Loop>
        ) : (
          content
        )}
      </div>
    </Sequence>
  );
}
