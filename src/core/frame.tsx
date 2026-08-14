// The frame clock + composition config, as React context — Remotion-compatible.
// Because compositions render to real DOM, useCurrentFrame() just drives a normal
// React re-render and the browser paints. That's the whole renderer.
import {
  Children,
  type ComponentType,
  type CSSProperties,
  createContext,
  isValidElement,
  type JSX,
  type ReactNode,
  useContext,
} from 'react';
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
/** Absolute timeline start frame of the enclosing <Sequence> chain. Media uses it to schedule
 *  itself on the player timeline even while premounting, when the shifted frame is clamped to 0. */
export const SequenceFromContext = createContext<number>(0);

export const useCurrentFrame = (): number => useContext(FrameContext);
export const useVideoConfig = (): VideoConfig => useContext(ConfigContext);
export const useIsPlaying = (): boolean => useContext(PlayingContext);
export const useTimelinePosition = (): number => useContext(TimelineContext);

/** Render a composition at a single frame, inside the contexts that drive it — the shared
 *  unit behind the headless Stage (render/stage) and the client-side exporter (client/export). */
export function CompositionFrame({
  Component,
  props,
  config,
  frame,
  playing,
}: {
  Component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  config: VideoConfig;
  frame: number;
  playing: boolean;
}): JSX.Element {
  return (
    <div style={{ width: config.width, height: config.height, position: 'relative', overflow: 'hidden' }}>
      <ConfigContext.Provider value={config}>
        <PlayingContext.Provider value={playing}>
          <TimelineContext.Provider value={frame}>
            <FrameContext.Provider value={frame}>
              <Component {...props} />
            </FrameContext.Provider>
          </TimelineContext.Provider>
        </PlayingContext.Provider>
      </ConfigContext.Provider>
    </div>
  );
}

export function Sequence({
  from = 0,
  durationInFrames = Number.POSITIVE_INFINITY,
  premountFor = 0,
  layout = 'absolute-fill',
  style,
  // showInTimeline is a studio-timeline display hint; the renderer ignores it.
  showInTimeline: _showInTimeline,
  children,
}: {
  from?: number | undefined;
  durationInFrames?: number | undefined;
  /** mount the children this many frames before `from` (invisible) so media preloads. */
  premountFor?: number | undefined;
  layout?: 'absolute-fill' | 'none' | undefined;
  style?: CSSProperties | undefined;
  showInTimeline?: boolean | undefined;
  children: ReactNode;
}): ReactNode {
  const parent = useCurrentFrame();
  const parentFrom = useContext(SequenceFromContext);
  const absFrom = parentFrom + from;
  const local = parent - from;
  if (local >= durationInFrames || local < -premountFor) return null;
  // Premount window [from - premountFor, from): render the children (so <Video>/<Img> begin
  // loading) at their first frame, but invisible, until the sequence actually starts.
  if (local < 0) {
    return (
      <SequenceFromContext.Provider value={absFrom}>
        <FrameContext.Provider value={0}>
          <div style={{ opacity: 0, pointerEvents: 'none' }}>{children}</div>
        </FrameContext.Provider>
      </SequenceFromContext.Provider>
    );
  }
  const content = layout === 'absolute-fill' ? <AbsoluteFill style={style}>{children}</AbsoluteFill> : children;
  return (
    <SequenceFromContext.Provider value={absFrom}>
      <FrameContext.Provider value={local}>{content}</FrameContext.Provider>
    </SequenceFromContext.Provider>
  );
}

interface SeriesSequenceProps {
  durationInFrames: number;
  offset?: number | undefined;
  layout?: 'absolute-fill' | 'none' | undefined;
  children: ReactNode;
}

/** <Series> plays its <Series.Sequence> children back-to-back (each auto-offset by
 *  the sum of the previous durations). Remotion-compatible. */
export function Series({ children }: { children: ReactNode }): ReactNode {
  let offset = 0;
  return Children.toArray(children).map((child) => {
    if (!isValidElement<SeriesSequenceProps>(child)) return null;
    const { durationInFrames, offset: childOffset = 0, layout, children: seqChildren } = child.props;
    const from = offset + childOffset;
    offset = from + durationInFrames;
    return (
      <Sequence key={`seq-${from}-${durationInFrames}`} from={from} durationInFrames={durationInFrames} layout={layout}>
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
  times?: number | undefined;
  layout?: 'absolute-fill' | 'none' | undefined;
  children: ReactNode;
}): JSX.Element | null {
  const frame = useCurrentFrame();
  if (times !== undefined && frame >= durationInFrames * times) return null;
  const local = ((frame % durationInFrames) + durationInFrames) % durationInFrames;
  const content = layout === 'absolute-fill' ? <AbsoluteFill>{children}</AbsoluteFill> : children;
  return <FrameContext.Provider value={local}>{content}</FrameContext.Provider>;
}
