// @remotion/transitions drop-in. Public surface.

export { fade } from './presentations/fade';
export { slide } from './presentations/slide';
export { wipe } from './presentations/wipe';
export { TransitionSeries } from './TransitionSeries';
export { linearTiming } from './timings/linear-timing';
export { springTiming } from './timings/spring-timing';
export type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
  TransitionTiming,
} from './types';
