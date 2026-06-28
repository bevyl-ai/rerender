// @remotion/transitions drop-in. Public surface.
export { TransitionSeries } from './TransitionSeries';
export { linearTiming } from './timings/linear-timing';
export { springTiming } from './timings/spring-timing';
export { slide } from './presentations/slide';
export { fade } from './presentations/fade';
export { wipe } from './presentations/wipe';
export type {
  TransitionTiming,
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from './types';
