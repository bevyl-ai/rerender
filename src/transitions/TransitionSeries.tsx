// TransitionSeries — drop-in for @remotion/transitions. Lays out its <Sequence>
// children back-to-back, but each <Transition> placed between two sequences pulls the
// next one earlier by the transition's duration, overlapping the two scenes and
// compositing them through a presentation for the length of the transition.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { AbsoluteFill } from '../core/primitives';
import { FrameContext, Sequence, useCurrentFrame, useVideoConfig } from '../core/frame';
import { slide } from './presentations/slide';
import type { TransitionPresentation, TransitionTiming } from './types';

type AnyPresentation = TransitionPresentation<unknown>;

interface SequenceProps {
  durationInFrames: number;
  offset?: number;
  layout?: 'absolute-fill' | 'none';
  children: ReactNode;
}

interface TransitionProps {
  timing: TransitionTiming;
  // Accepts any concrete presentation (slide/fade/wipe). The marker only carries
  // props; TransitionSeries erases the generic to AnyPresentation when it reads them.
  presentation?: AnyPresentation;
}

interface ResolvedEntry {
  actualFrom: number;
  durationInFrames: number;
  layout: 'absolute-fill' | 'none';
  children: ReactNode;
  /** The transition that bridges the previous entry into this one, if any. */
  enteringTransition: { timing: TransitionTiming; presentation: AnyPresentation } | null;
}

function isSequenceElement(child: ReactNode): child is ReactElement<SequenceProps> {
  return isValidElement(child) && child.type === TransitionSeriesSequence;
}

function isTransitionElement(child: ReactNode): child is ReactElement<TransitionProps> {
  return isValidElement(child) && child.type === TransitionSeriesTransition;
}

/** Single pass over the children: resolve each sequence's absolute start frame,
 *  pulling it earlier by any pending transition's duration. */
function resolveEntries(children: ReactNode, fps: number): ResolvedEntry[] {
  const entries: ResolvedEntry[] = [];
  let cursor = 0;
  let pendingTransitionDur = 0;
  let pendingTransition: { timing: TransitionTiming; presentation: AnyPresentation } | null = null;

  for (const child of Children.toArray(children)) {
    if (isSequenceElement(child)) {
      const { durationInFrames, offset = 0, layout = 'absolute-fill', children: seqChildren } = child.props;
      if (pendingTransition && durationInFrames < pendingTransitionDur) {
        throw new Error(
          `TransitionSeries.Sequence durationInFrames (${durationInFrames}) is shorter than the adjacent transition (${pendingTransitionDur}).`,
        );
      }
      const actualFrom = cursor + offset - pendingTransitionDur;
      entries.push({
        actualFrom,
        durationInFrames,
        layout,
        children: seqChildren,
        enteringTransition: pendingTransition,
      });
      cursor = actualFrom + durationInFrames;
      pendingTransitionDur = 0;
      pendingTransition = null;
      continue;
    }

    if (isTransitionElement(child)) {
      const { timing, presentation } = child.props;
      const resolved = presentation ?? slide();
      pendingTransitionDur = timing.getDurationInFrames({ fps });
      pendingTransition = { timing, presentation: resolved };
    }
  }

  return entries;
}

function PresentedScene({
  presentation,
  direction,
  progress,
  durationInFrames,
  localFrame,
  children,
}: {
  presentation: AnyPresentation;
  direction: 'entering' | 'exiting';
  progress: number;
  durationInFrames: number;
  localFrame: number;
  children: ReactNode;
}): JSX.Element {
  const Component = presentation.component;
  return (
    <FrameContext.Provider value={localFrame}>
      <Component
        presentationDirection={direction}
        presentationProgress={progress}
        presentationDurationInFrames={durationInFrames}
        passedProps={presentation.props}
      >
        {children}
      </Component>
    </FrameContext.Provider>
  );
}

export function TransitionSeries({ children }: { children: ReactNode }): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entries = resolveEntries(children, fps);

  return (
    <AbsoluteFill>
      {entries.map((entry, i) => {
        const transition = entry.enteringTransition;
        if (transition) {
          const tDur = transition.timing.getDurationInFrames({ fps });
          const windowStart = entry.actualFrom;
          const windowEnd = entry.actualFrom + tDur;
          if (frame >= windowStart && frame < windowEnd) {
            // This entry is mid-transition: render the entering+exiting pair below.
            const prev = entries[i - 1];
            const progress = transition.timing.getProgress({ frame: frame - entry.actualFrom, fps });
            return (
              <AbsoluteFill key={i}>
                {prev ? (
                  <PresentedScene
                    presentation={transition.presentation}
                    direction="exiting"
                    progress={progress}
                    durationInFrames={tDur}
                    localFrame={frame - prev.actualFrom}
                  >
                    {prev.children}
                  </PresentedScene>
                ) : null}
                <PresentedScene
                  presentation={transition.presentation}
                  direction="entering"
                  progress={progress}
                  durationInFrames={tDur}
                  localFrame={frame - entry.actualFrom}
                >
                  {entry.children}
                </PresentedScene>
              </AbsoluteFill>
            );
          }
        }

        // This entry's exiting window = the NEXT entry's entering-transition window.
        // During it, this entry is already painted as the "exiting" scene of that
        // transition, so suppress the plain Sequence to avoid a double-render.
        const next = entries[i + 1];
        if (next?.enteringTransition) {
          const nextTDur = next.enteringTransition.timing.getDurationInFrames({ fps });
          if (frame >= next.actualFrom && frame < next.actualFrom + nextTDur) {
            return null;
          }
        }

        // Outside every transition window: render the entry as a plain Sequence.
        // (Sequence is null outside [actualFrom, actualFrom+duration), AbsoluteFill inside.)
        return (
          <Sequence key={i} from={entry.actualFrom} durationInFrames={entry.durationInFrames} layout={entry.layout}>
            {entry.children}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

/** Marker — TransitionSeries reads its props directly; it never renders. */
function TransitionSeriesSequence(_props: SequenceProps): null {
  return null;
}

/** Marker — TransitionSeries reads its props directly; it never renders. */
function TransitionSeriesTransition(_props: TransitionProps): null {
  return null;
}

TransitionSeries.Sequence = TransitionSeriesSequence;
TransitionSeries.Transition = TransitionSeriesTransition;
