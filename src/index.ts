// remover — public API (the drop-in Remotion surface).
export {
  useCurrentFrame,
  useVideoConfig,
  useIsPlaying,
  Sequence,
  Series,
  Freeze,
  Loop,
  FrameContext,
  ConfigContext,
  PlayingContext,
} from './core/frame';
export type { VideoConfig } from './core/frame';

export { interpolate, Easing } from './core/interpolate';
export type { InterpolateOptions, Extrapolate } from './core/interpolate';
export { interpolateColors } from './core/interpolate-colors';

export { spring } from './core/spring';
export type { SpringConfig } from './core/spring';
export { measureSpring } from './core/measure-spring';

export { staticFile, random } from './core/util';
export { delayRender, continueRender } from './core/delay-render';
export { getInputProps, getRemotionEnvironment } from './core/env';
export type { RemotionEnvironment } from './core/env';

export { AbsoluteFill, Img, Video, Audio, OffthreadVideo } from './core/primitives';

export { registerRoot, Composition, Still, Folder, getRoot, getCompositions, getComposition } from './core/registry';
export type { CompositionMeta, CompositionProps } from './core/registry';

export { Player } from './core/player';
export type { PlayerProps } from './core/player';
