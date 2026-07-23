// The primitive vocabulary — real DOM, Remotion-compatible. These are thin wrappers
// over <div>/<img>/<video>/<audio>, so arbitrary CSS in a composition just works.
import { memo, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { SequenceFromContext, useCurrentFrame, useIsPlaying, useTimelinePosition, useVideoConfig } from './frame';
import { decode, register, unregister } from './audio-engine';
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

interface MediaVolumeProps {
  mediaRef: RefObject<HTMLMediaElement | null>;
  volume: number | ((frame: number) => number) | undefined;
}

const ConstantMediaVolume = memo(function ConstantMediaVolume({ mediaRef, volume }: MediaVolumeProps): null {
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = (volume as number | undefined) ?? 1;
  }, [mediaRef, volume]);
  return null;
});

const FrameMediaVolume = memo(function FrameMediaVolume({ mediaRef, volume }: MediaVolumeProps): null {
  const frame = useCurrentFrame();
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = (volume as (frame: number) => number)(frame);
  }, [frame, mediaRef, volume]);
  return null;
});

function MediaVolume({ mediaRef, volume }: MediaVolumeProps): JSX.Element {
  return typeof volume === 'function' ? (
    <FrameMediaVolume mediaRef={mediaRef} volume={volume} />
  ) : (
    <ConstantMediaVolume mediaRef={mediaRef} volume={volume} />
  );
}

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
      const dur = v.duration;
      // A composition may want a clip on screen LONGER than the source footage itself (e.g. a 4s
      // b-roll loop behind a longer scene). Once `target` runs past the video's own native duration,
      // stop touching the element entirely — repeatedly calling play()/reseeking toward an
      // ever-growing target past `duration` is what produces a visible stutter right at the clip's
      // natural end. Left alone, the browser's normal end-of-playback behavior holds the last frame.
      if (Number.isFinite(dur) && dur > 0 && target >= dur) return;
      v.playbackRate = playbackRate;
      if (v.paused) void v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target; // correct drift
    } else {
      if (!v.paused) v.pause();
      v.currentTime = target;
    }
  }, [frame, playing, fps, offset, playbackRate, trimAfter]);

  return (
    <>
      <video
        ref={ref}
        src={src}
        muted={muted}
        playsInline
        crossOrigin={crossOrigin}
        className={className}
        // Force the playing <video> OFF Chrome's hardware video-overlay plane with an imperceptible
        // rotation. A hardware overlay must be an axis-aligned rectangle, so ANY rotation (0.04deg
        // here) demotes the video to a regular composited texture — which then flattens into the
        // Player container's filtered raster and gets bilinearly sub-pixel down-scaled, instead of
        // the overlay being presented snapped to whole device pixels (the per-frame shake). The
        // rotation is sub-0.1px / clipped, and the export ignores it (composites videos by bounding
        // box, and runs paused). Only applied while playing. (A composition's own style wins below.)
        style={playing ? { ...style, transform: `${style?.transform ? `${style.transform} ` : ''}rotate(0.04deg)` } : style}
        onCanPlay={onCanPlay}
        onError={onError}
        onSeeking={onSeeking}
        onSeeked={onSeeked}
      />
      <MediaVolume mediaRef={ref} volume={volume} />
    </>
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

// Preview playback goes through the Web Audio scheduler (audio-engine): decode each source
// once, place each clip's slice at a precise AudioContext time. That is sample-accurate and
// warms during premount, so a dense edit has no startup silence and no per-cut gap — the html5
// <audio>-per-clip path had both (inherent .play() latency under a free-running frame clock).
// Renders are unaffected: they mux from useRenderAsset below, not from playback.
export function Audio({
  src,
  trimBefore,
  startFrom,
  trimAfter,
  playbackRate = 1,
  volume,
  crossOrigin: _crossOrigin,
  pauseWhenBuffering: _pauseWhenBuffering,
  useWebAudioApi: _useWebAudioApi,
}: AudioProps): JSX.Element | null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const from = useContext(SequenceFromContext); // absolute timeline start frame (stable during premount)
  const offset = trimBefore ?? startFrom ?? 0;
  useRenderAsset('audio', src, { offset, playbackRate, volume: resolveVolume(volume, frame) });

  const rendering = typeof window !== 'undefined' && (window as unknown as { __rerenderEnv?: string }).__rerenderEnv === 'rendering';
  const durFrames = trimAfter !== undefined ? Math.max(0, trimAfter - offset) : Number.POSITIVE_INFINITY;

  // volume may be a fresh inline fade function each render; keep it in a ref so its identity
  // doesn't re-trigger the schedule effect (which would restart the source every frame).
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const idRef = useRef<symbol>();
  if (!idRef.current) idRef.current = Symbol('rerender-audio-clip');

  // Warm: decode the source the moment this clip mounts (including its premount window).
  useEffect(() => {
    if (!rendering) void decode(src).catch(() => undefined);
  }, [src, rendering]);

  // Register with the scheduler while playback is active; it schedules (and reschedules on
  // play/loop/seek). Unregister on unmount.
  useEffect(() => {
    if (rendering || !playing) return undefined;
    const id = idRef.current as symbol;
    let cancelled = false;
    void decode(src).then((buffer) => {
      if (cancelled) return;
      register(id, { buffer, fromFrame: from, trimBefore: offset, durFrames, playbackRate, volume: volumeRef.current ?? 1, fps });
    });
    return () => {
      cancelled = true;
      unregister(id);
    };
  }, [playing, src, from, offset, durFrames, playbackRate, fps, rendering]);

  return null;
}
