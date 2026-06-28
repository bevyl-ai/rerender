// Public types for the @remotion/transitions drop-in. The model mirrors Remotion's:
// a timing owns the transition's duration + 0..1 progress curve; a presentation owns
// how the two scenes are composited per frame.
import type { ComponentType, ReactNode } from 'react';

/** Owns the transition's length and its 0..1 progress curve. */
export interface TransitionTiming {
  getDurationInFrames(args: { fps: number }): number;
  /** 0 at the start of the transition window, 1 at the end. */
  getProgress(args: { frame: number; fps: number }): number;
}

/** Props every presentation component receives for the entering or exiting scene. */
export interface TransitionPresentationComponentProps<TProps> {
  presentationDirection: 'entering' | 'exiting';
  presentationProgress: number;
  presentationDurationInFrames: number;
  passedProps: TProps;
  children: ReactNode;
}

/** A presentation = the component that composites a scene + the props it gets. */
export interface TransitionPresentation<TProps> {
  component: ComponentType<TransitionPresentationComponentProps<TProps>>;
  props: TProps;
}

/** TProps appears in both a covariant (props) and contravariant (component input)
 *  position, so TransitionPresentation is invariant in TProps — a concrete
 *  presentation is not assignable to TransitionPresentation<unknown>. Factories build
 *  their presentation with full type safety, then erase here through the single
 *  widening cast so callers and TransitionSeries can store them uniformly. */
export function makePresentation<TProps>(
  component: ComponentType<TransitionPresentationComponentProps<TProps>>,
  props: TProps,
): TransitionPresentation<unknown> {
  return { component, props } as TransitionPresentation<unknown>;
}
