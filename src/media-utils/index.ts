// @remotion/media-utils drop-in. Re-exports the public audio API so existing
// compositions importing from '@remotion/media-utils' run on remover unchanged.
export { getAudioData } from './get-audio-data';
export { useAudioData } from './use-audio-data';
export { visualizeAudio } from './visualize-audio';
export type { AudioData, VisualizeAudioOptions, OptimizeFor } from './types';
