// @remotion/media-utils drop-in. Re-exports the public audio API so existing
// compositions importing from '@remotion/media-utils' run on rerender unchanged.
export { getAudioData } from './get-audio-data';
export type { AudioData, OptimizeFor, VisualizeAudioOptions } from './types';
export { useAudioData } from './use-audio-data';
export { visualizeAudio } from './visualize-audio';
