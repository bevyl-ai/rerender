// A composition written exactly like a real Remotion one — `from 'remotion'`,
// props, arbitrary CSS. It runs on remover (aliased) and on real Remotion (its
// bundler) from the same file.
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export interface MyVideoProps {
  titleText: string;
  titleColor: string;
}

function Subtitle(): JSX.Element {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 18], [-60, 0], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        marginTop: 240,
        transform: `translateX(${x}px)`,
        opacity,
        color: 'rgba(255,255,255,0.72)',
        fontSize: 46,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      a drop-in Remotion — recorded, not screenshotted
    </div>
  );
}

export function MyVideo({ titleText, titleColor }: MyVideoProps): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleSpring = spring({ frame, fps, config: { damping: 14 } });
  const ringScale = interpolate(frame, [0, durationInFrames - 1], [0.85, 1.3]);
  const ringRot = interpolate(frame, [0, durationInFrames - 1], [0, 200]);

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(135deg, #0b1020, #1a2340)', justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          width: 540,
          height: 540,
          borderRadius: '50%',
          border: '14px solid rgba(91,140,255,0.45)',
          borderTopColor: '#ff2e63',
          transform: `scale(${ringScale}) rotate(${ringRot}deg)`,
        }}
      />
      <div
        style={{
          transform: `translateY(${interpolate(titleSpring, [0, 1], [44, 0])}px)`,
          opacity: titleSpring,
          color: titleColor,
          fontSize: 140,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {titleText}
      </div>
      <Sequence from={20}>
        <Subtitle />
      </Sequence>
    </AbsoluteFill>
  );
}
