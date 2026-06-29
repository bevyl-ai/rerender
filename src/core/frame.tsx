// The frame clock + composition config, as React context — Remotion-compatible.
// Because compositions render to real DOM, useCurrentFrame() just drives a normal
// React re-render and the browser paints. That's the whole renderer.
import { Children, createContext, isValidElement, useContext, type ReactNode } from 'react';
import { AbsoluteFill } from './primitives';

export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export const FrameContext = createContext<number>(0);
export const ConfigContext = createContext<VideoConfig>({
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1,
});
/** True while the player is playing (vs scrubbing) — lets <Video>/<Audio> play
 *  natively instead of seeking every frame. */
export const PlayingContext = createContext<boolean>(false);
/** The absolute composition frame — NOT shifted by <Sequence> (unlike FrameContext).
 *  Audio/Video assets use it to place themselves on the render timeline. */
export const TimelineContext = createContext<number>(0);

export const useCurrentFrame = (): number => useContext(FrameContext);
export const useVideoConfig = (): VideoConfig => useContext(ConfigContext);
export const useIsPlaying = (): boolean => useContext(PlayingContext);
export const useTimelinePosition = (): number => useContext(TimelineContext);

export function Sequence({
  from = 0,
  durationInFrames = Number.POSITIVE_INFINITY,
  layout = 'absolute-fill',
  children,
}: {
  from?: number;
  durationInFrames?: number;
  layout?: 'absolute-fill' | 'none';
  children: ReactNode;
}): ReactNode {
  const parent = useCurrentFrame();
  const local = parent - from;
  if (local < 0 || local >= durationInFrames) return null;
  const content = layout === 'absolute-fill' ? <AbsoluteFill>{children}</AbsoluteFill> : children;
  return <FrameContext.Provider value={local}>{content}</FrameContext.Provider>;
}

interface SeriesSequenceProps {
  durationInFrames: number;
  offset?: number;
  layout?: 'absolute-fill' | 'none';
  children: ReactNode;
}

/** <Series> plays its <Series.Sequence> children back-to-back (each auto-offset by
 *  the sum of the previous durations). Remotion-compatible. */
export function Series({ children }: { children: ReactNode }): ReactNode {
  let offset = 0;
  return Children.toArray(children).map((child, i) => {
    if (!isValidElement<SeriesSequenceProps>(child)) return null;
    const { durationInFrames, offset: childOffset = 0, layout, children: seqChildren } = child.props;
    const from = offset + childOffset;
    offset = from + durationInFrames;
    return (
      <Sequence key={i} from={from} durationInFrames={durationInFrames} layout={layout}>
        {seqChildren}
      </Sequence>
    );
  });
}
Series.Sequence = (_props: SeriesSequenceProps): null => null; // marker; <Series> reads its props

/** <Freeze> pins everything inside it to a single frame. Remotion-compatible. */
export function Freeze({ frame, active = true, children }: { frame: number; active?: boolean; children: ReactNode }): JSX.Element {
  const current = useCurrentFrame();
  return <FrameContext.Provider value={active ? frame : current}>{children}</FrameContext.Provider>;
}

/** <Loop> repeats its children every durationInFrames (up to `times`). The frame
 *  seen inside resets to 0 each iteration. Remotion-compatible. */
export function Loop({
  durationInFrames,
  times,
  layout = 'absolute-fill',
  children,
}: {
  durationInFrames: number;
  times?: number;
  layout?: 'absolute-fill' | 'none';
  children: ReactNode;
}): JSX.Element | null {
  const frame = useCurrentFrame();
  if (times !== undefined && frame >= durationInFrames * times) return null;
  const local = ((frame % durationInFrames) + durationInFrames) % durationInFrames;
  const content = layout === 'absolute-fill' ? <AbsoluteFill>{children}</AbsoluteFill> : children;
  return <FrameContext.Provider value={local}>{content}</FrameContext.Provider>;
}
