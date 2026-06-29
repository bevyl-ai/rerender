// The primitive vocabulary — real DOM, Remotion-compatible. These are thin wrappers
// over <div>/<img>/<video>/<audio>, so arbitrary CSS in a composition just works.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useCurrentFrame, useIsPlaying, useTimelinePosition, useVideoConfig } from './frame';
import { registerRenderAsset } from './assets';

// During render, register a media asset for the audio mix (one entry per frame the
// element is mounted). No-op in the player.
function useRenderAsset(type: 'audio' | 'video', src: string, startFrom: number, volume: number): void {
  const frame = useCurrentFrame();
  const timeline = useTimelinePosition();
  if (typeof window !== 'undefined' && window.__removerEnv === 'rendering') {
    registerRenderAsset({
      type,
      src: new URL(src, location.href).href,
      id: `${type}-${src}`,
      frame: timeline,
      volume,
      mediaFrame: frame + startFrom,
      playbackRate: 1,
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

export function Img(props: React.ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
  return <img {...props} />;
}

/** A frame-synced <video>: seeks while scrubbing, plays natively while playing,
 *  and corrects drift. `startFrom` is the source-time offset in frames. */
export function Video(props: { src: string; startFrom?: number; volume?: number; style?: CSSProperties }): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLVideoElement>(null);
  useRenderAsset('video', props.src, props.startFrom ?? 0, props.volume ?? 1);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = (frame + (props.startFrom ?? 0)) / fps;
    if (playing) {
      if (v.paused) void v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target; // correct drift
    } else {
      if (!v.paused) v.pause();
      v.currentTime = target;
    }
  }, [frame, playing, fps, props.startFrom]);

  return <video ref={ref} src={props.src} muted playsInline style={props.style} />;
}

export function Audio(props: { src: string; startFrom?: number; volume?: number }): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLAudioElement>(null);
  useRenderAsset('audio', props.src, props.startFrom ?? 0, props.volume ?? 1);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const target = (frame + (props.startFrom ?? 0)) / fps;
    if (playing) {
      if (a.paused) void a.play().catch(() => undefined);
      if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target;
    } else {
      if (!a.paused) a.pause();
      a.currentTime = target;
    }
  }, [frame, playing, fps, props.startFrom]);

  return <audio ref={ref} src={props.src} />;
}

// OffthreadVideo — Remotion renders this frame-accurately off the main thread; in
// remover the frame-synced <Video> already seeks exactly, so it's the same thing.
export const OffthreadVideo = Video;
