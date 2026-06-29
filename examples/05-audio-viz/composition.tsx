// Tier 5 — an audio waveform visualizer. Uses @remotion/media-utils
// (useAudioData decodes the track; visualizeAudio runs an FFT per frame).
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig, staticFile } from 'remotion';
import { useAudioData, visualizeAudio } from '@remotion/media-utils';

const SAMPLES = 64; // must be a power of two (matches Remotion's visualizeAudio constraint)

export function AudioViz(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile('music.mp3'));
  const bars = audioData ? visualizeAudio({ audioData, frame, fps, numberOfSamples: SAMPLES }) : new Array<number>(SAMPLES).fill(0);

  return (
    <AbsoluteFill style={{ background: '#0e1116', flexDirection: 'row', alignItems: 'center', gap: 6, padding: 80 }}>
      <Audio src={staticFile('music.mp3')} />
      {bars.map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${Math.max(2, v * 900)}px`, background: '#ff2e63', borderRadius: 4 }} />
      ))}
    </AbsoluteFill>
  );
}
