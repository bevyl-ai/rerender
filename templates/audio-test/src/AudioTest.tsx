// A composition with audio — a beep on a timed Sequence, used to exercise remover's
// audio render pipeline (asset collection → mix → mux).
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

function Pulse(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 8 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: '#ff2e63',
          transform: `scale(${interpolate(s, [0, 1], [0.4, 1])})`,
          opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      />
    </AbsoluteFill>
  );
}

export function AudioTest(): JSX.Element {
  return (
    <AbsoluteFill style={{ background: '#0a0d12' }}>
      {/* the audio is the test: a 1s beep starting at frame 15 */}
      <Sequence from={15} durationInFrames={30}>
        <Audio src={staticFile('beep.mp3')} volume={0.8} />
        <Pulse />
      </Sequence>
    </AbsoluteFill>
  );
}
