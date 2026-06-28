// The primitive vocabulary — real DOM, Remotion-compatible. These are thin wrappers
// over <div>/<img>/<video>/<audio>, so arbitrary CSS in a composition just works.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useCurrentFrame, useIsPlaying, useVideoConfig } from './frame';

export function AbsoluteFill(props: {
  style?: CSSProperties;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
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
export function Video(props: {
  src: string;
  startFrom?: number;
  style?: CSSProperties;
}): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLVideoElement>(null);

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

export function Audio(props: { src: string; startFrom?: number }): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();
  const ref = useRef<HTMLAudioElement>(null);

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
