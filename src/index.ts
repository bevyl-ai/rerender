// rerender — public API (the drop-in Remotion surface).

export { continueRender, delayRender } from './core/delay-render';
export type { RemotionEnvironment } from './core/env';
export { getInputProps, getRemotionEnvironment } from './core/env';
export type { VideoConfig } from './core/frame';
export { Freeze, Loop, Sequence, Series, useCurrentFrame, useIsPlaying, useVideoConfig } from './core/frame';
export type { Extrapolate, InterpolateOptions } from './core/interpolate';
export { Easing, interpolate } from './core/interpolate';
export { interpolateColors } from './core/interpolate-colors';
export { measureSpring } from './core/measure-spring';
export type { CallbackListener, PlayerEventTypes, PlayerProps, PlayerRef } from './core/player';
export { Player } from './core/player';
export type { PrefetchHandle } from './core/prefetch';
export { prefetch } from './core/prefetch';
export { AbsoluteFill, Audio, Img, OffthreadVideo, Video } from './core/primitives';
export type { CompositionMeta, CompositionProps } from './core/registry';

export { Composition, Folder, getComposition, getCompositions, getRoot, registerRoot, Still } from './core/registry';
export type { SpringConfig } from './core/spring';
export { spring } from './core/spring';
export { random, staticFile } from './core/util';
