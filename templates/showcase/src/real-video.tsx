// Real-footage editing patterns — the actual short-form playbook: full-bleed clips
// with animated captions, a sliding lower-third, and a CTA end card. Same primitives
// (OffthreadVideo + Sequence + spring + interpolate) drive preview and render.
import { type ReactNode } from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const SANS = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

function Clip({ src }: { src: string }): JSX.Element {
  return <OffthreadVideo src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

// A TikTok-style caption that pops in, holds, and pops out.
function Caption({ children, accent }: { children: ReactNode; accent?: string }): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 11, mass: 0.6 } });
  const exit = spring({ frame: frame - (durationInFrames - 8), fps, config: { damping: 200 } });
  const scale = interpolate(enter, [0, 1], [0.7, 1]) - exit * 0.1;
  const opacity = enter - exit;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 340 }}>
      <div
        style={{
          transform: `scale(${scale}) rotate(-2deg)`,
          opacity,
          background: accent ?? '#fff',
          color: accent ? '#fff' : '#111',
          fontSize: 58,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          padding: '18px 34px',
          borderRadius: 20,
          fontFamily: SANS,
          maxWidth: 880,
          textAlign: 'center',
          boxShadow: '0 12px 50px rgba(0,0,0,0.45)',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

export function CaptionedClip(): JSX.Element {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Clip src="noodles.mp4" />
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 72 }}>
        <div style={{ color: '#fff', fontSize: 40, fontWeight: 800, fontFamily: SANS, textShadow: '0 2px 14px rgba(0,0,0,0.7)' }}>@bevyl</div>
      </AbsoluteFill>
      <Sequence from={6} durationInFrames={66}>
        <Caption>POV: the best sichuan noodles 🍜</Caption>
      </Sequence>
      <Sequence from={74} durationInFrames={70}>
        <Caption accent="#ff2e63">numbing in the BEST way 🌶️</Caption>
      </Sequence>
      <Sequence from={146} durationInFrames={78}>
        <Caption>save this spot 📍</Caption>
      </Sequence>
    </AbsoluteFill>
  );
}

export function LowerThird(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 8, fps, config: { damping: 16, mass: 0.8 } });
  const x = interpolate(s, [0, 1], [-700, 0]);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Clip src="strut.mp4" />
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent 38%)' }} />
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: 80, paddingBottom: 210 }}>
        <div style={{ transform: `translateX(${x}px)`, opacity: s }}>
          <div style={{ display: 'inline-block', background: '#ff2e63', color: '#fff', fontSize: 30, fontWeight: 800, padding: '6px 18px', borderRadius: 8, fontFamily: SANS, marginBottom: 12, letterSpacing: '0.04em' }}>
            RETROFÊTE
          </div>
          <div style={{ color: '#fff', fontSize: 76, fontWeight: 800, fontFamily: SANS, lineHeight: 1, letterSpacing: '-0.03em' }}>dress strut</div>
          <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 36, fontFamily: SANS, marginTop: 10 }}>spring drop · in stores now</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function CtaClip(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const start = durationInFrames - 40;
  const s = spring({ frame: frame - start, fps, config: { damping: 13, mass: 0.7 } });
  if (frame < start) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <Clip src="goodfood.mp4" />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Clip src="goodfood.mp4" />
      <AbsoluteFill style={{ background: `rgba(0,0,0,${interpolate(s, [0, 1], [0, 0.58])})` }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.82, 1])})`, opacity: s, textAlign: 'center', fontFamily: SANS }}>
          <div style={{ color: '#fff', fontSize: 78, fontWeight: 800, letterSpacing: '-0.03em' }}>good food, good mood</div>
          <div style={{ marginTop: 28, display: 'inline-block', background: '#ff2e63', color: '#fff', fontSize: 46, fontWeight: 700, padding: '18px 44px', borderRadius: 999 }}>
            Follow @bevyl →
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
