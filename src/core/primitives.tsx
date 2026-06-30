// The primitive vocabulary — real DOM, Remotion-compatible. These are thin wrappers
// over <div>/<img>/<video>/<audio>, so arbitrary CSS in a composition just works.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCurrentFrame, useIsPlaying, useTimelinePosition, useVideoConfig } from './frame';
import { registerRenderAsset } from './assets';
import { continueRender, delayRender } from './delay-render';

/** Shared media props for <Video>/<OffthreadVideo>/<Audio>. trimBefore/trimAfter are
 *  Remotion's source-frame trim (trimBefore supersedes the older startFrom); playbackRate
 *  scales how fast source time advances; volume may be a per-frame function (for fades). */
interface MediaProps {
  src: string;
  /** source-frame offset to start at (Remotion's newer name for startFrom). */
  trimBefore?: number;
  /** legacy alias for trimBefore. */
  startFrom?: number;
  /** source frame to stop at (clamps the seek). */
  trimAfter?: number;
  playbackRate?: number;
  volume?: number | ((frame: number) => number);
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  /** player-only: don't advance while the media is buffering (no-op during render). */
  pauseWhenBuffering?: boolean;
}

const resolveVolume = (volume: number | ((f: number) => number) | undefined, frame: number): number =>
  typeof volume === 'function' ? volume(frame) : (volume ?? 1);

/** The source frame the media should show at composition frame `frame`. */
const sourceFrameAt = (frame: number, offset: number, playbackRate: number, trimAfter: number | undefined): number => {
  const f = offset + frame * playbackRate;
  return trimAfter === undefined ? f : Math.min(f, trimAfter);
};

// During render, register a media asset for the audio mix (one entry per frame the element
// is mounted), carrying the resolved per-frame volume + the source position. No-op in the
// player. The id keys on (type, src, offset) so distinct clips of the same source stay separate.
function useRenderAsset(type: 'audio' | 'video', src: string, opts: { offset: number; playbackRate: number; volume: number }): void {
  const frame = useCurrentFrame();
  const timeline = useTimelinePosition();
  if (typeof window !== 'undefined' && window.__rerenderEnv === 'rendering') {
    registerRenderAsset({
      type,
      src: new URL(src, location.href).href,
      id: `${type}-${src}-${opts.offset}`,
      frame: timeline,
      volume: opts.volume,
      mediaFrame: Math.round(opts.offset + frame * opts.playbackRate),
      playbackRate: opts.playbackRate,
    });
  }
}

export function AbsoluteFill(props: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        // exact Remotion AbsoluteFill defaults — an abs-positioned child's static
        // position depends on these, so they must match for pixel parity.
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

/** An <img> that holds the render until it has loaded — without this the renderer can
 *  screenshot a frame before the image decodes, producing blank image overlays. */
export function Img({ onLoad, onError, ...props }: React.ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
  const ref = useRef<HTMLImageElement>(null);
  const [handle] = useState(() => delayRender(`<Img>: loading ${String(props.src)}`));
  const done = useRef(false);
  const release = useCallback(() => {
    if (done.current) return;
    done.current = true;
    continueRender(handle);
  }, [handle]);
  // A cached image can already be complete before onLoad attaches; and always release on
  // unmount so a never-loaded image can't stall the render forever.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) release();
    return release;
  }, [release]);
  return (
    <img
      ref={ref}
      {...props}
      onLoad={(e) => {
        release();
        onLoad?.(e);
      }}
      onError={(e) => {
        release();
        onError?.(e);
      }}
    />
  );
}

interface VideoProps extends MediaProps {
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
  onCanPlay?: React.ReactEventHandler<HTMLVideoElement>;
  onError?: React.ReactEventHandler<HTMLVideoElement>;
  onSeeking?: React.ReactEventHandler<HTMLVideoElement>;
  onSeeked?: React.ReactEventHandler<HTMLVideoElement>;
}

/** A frame-synced <video>: seeks while scrubbing, plays natively while playing, corrects
 *  drift. Source time = (trimBefore + frame·playbackRate)/fps, clamped to trimAfter. */
export function Video({
  src,
  trimBefore,
  startFrom,
  trimAfter,
  playbackRate = 1,
  volume,
  muted = true,
  crossOrigin,
  className,
  style,
  pauseWhenBuffering: _pauseWhenBuffering,
  onCanPlay,
  onError,
  onSeeking,
  onSeeked,
}: VideoProps): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLVideoElement>(null);
  const offset = trimBefore ?? startFrom ?? 0;
  useRenderAsset('video', src, { offset, playbackRate, volume: resolveVolume(volume, frame) });

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = sourceFrameAt(frame, offset, playbackRate, trimAfter) / fps;
    if (playing) {
      v.playbackRate = playbackRate;
      if (v.paused) void v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target; // correct drift
    } else {
      if (!v.paused) v.pause();
      v.currentTime = target;
    }
  }, [frame, playing, fps, offset, playbackRate, trimAfter]);

  return (
    <video
      ref={ref}
      src={src}
      muted={muted}
      playsInline
      crossOrigin={crossOrigin}
      className={className}
      // No hint on the <video> itself — a filter HERE keeps it a separate (now texture) layer,
      // which still gets position-snapped to whole device pixels when scaled. The fix is on the
      // Player's scaled container, whose filter flattens this video INTO the down-scaled layer so
      // it's sub-pixel sampled. (A composition's own style wins via ...style.)
      style={style}
      onCanPlay={onCanPlay}
      onError={onError}
      onSeeking={onSeeking}
      onSeeked={onSeeked}
    />
  );
}

// OffthreadVideo — Remotion extracts frames off the main thread for the render; rerender
// captures the real <video> element instead, so the frame-synced <Video> is the same thing.
export const OffthreadVideo = Video;

interface AudioProps extends MediaProps {
  /** player-only: route through the Web Audio API. rerender renders audio via the muxer, so
   *  this is a no-op during render. */
  useWebAudioApi?: boolean;
}

export function Audio({
  src,
  trimBefore,
  startFrom,
  trimAfter,
  playbackRate = 1,
  volume,
  crossOrigin,
  pauseWhenBuffering: _pauseWhenBuffering,
  useWebAudioApi: _useWebAudioApi,
}: AudioProps): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLAudioElement>(null);
  const offset = trimBefore ?? startFrom ?? 0;
  useRenderAsset('audio', src, { offset, playbackRate, volume: resolveVolume(volume, frame) });

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const target = sourceFrameAt(frame, offset, playbackRate, trimAfter) / fps;
    if (playing) {
      a.playbackRate = playbackRate;
      if (a.paused) void a.play().catch(() => undefined);
      if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target;
    } else {
      if (!a.paused) a.pause();
      a.currentTime = target;
    }
  }, [frame, playing, fps, offset, playbackRate, trimAfter]);

  return <audio ref={ref} src={src} crossOrigin={crossOrigin} />;
}
