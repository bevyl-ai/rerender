// Tier 4 — a slide transition between two scenes. Uses @remotion/transitions
// (TransitionSeries + slide + linearTiming). With 60f scenes overlapping a 30f
// transition, frame 45 lands mid-slide — a real test of the transition compositing.
import { AbsoluteFill } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';

function Scene({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <AbsoluteFill
      style={{ background: color, justifyContent: 'center', alignItems: 'center', color: '#fff', fontSize: 140, fontWeight: 700, fontFamily: 'system-ui, sans-serif' }}
    >
      {label}
    </AbsoluteFill>
  );
}

export function Transitions(): JSX.Element {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={60}>
        <Scene color="#ff2e63" label="one" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={linearTiming({ durationInFrames: 30 })} />
      <TransitionSeries.Sequence durationInFrames={60}>
        <Scene color="#5b8cff" label="two" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}
