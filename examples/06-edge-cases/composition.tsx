// Tier 6 — the "annoying reasons" battle-test: viewport units (vw/vh),
// position:fixed, and overflow:hidden clipping. These resolve to the *viewport* —
// and in a render the viewport IS the composition, so they must land identically to
// Remotion. This composition is how remover earns that guarantee instead of
// inheriting Remotion's off-screen-portal structure.
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export function EdgeCases(): JSX.Element {
  const frame = useCurrentFrame();
  const shift = interpolate(frame, [0, 90], [0, 100]);

  return (
    <AbsoluteFill style={{ background: '#101418' }}>
      {/* viewport units: a 50vw × 20vh box must size to the composition, not the window */}
      <div
        style={{ position: 'absolute', top: '10vh', left: '25vw', width: '50vw', height: '20vh', background: '#5b8cff', borderRadius: 12 }}
      />

      {/* overflow:hidden clipping a moving stripe field */}
      <div
        style={{
          position: 'absolute',
          top: '40vh',
          left: '10vw',
          width: '80vw',
          height: '22vh',
          overflow: 'hidden',
          borderRadius: 16,
          background: '#1b2230',
        }}
      >
        <div
          style={{
            width: 3000,
            height: 800,
            transform: `translateX(${-shift * 4}px)`,
            background: 'repeating-linear-gradient(90deg, #ff2e63 0 40px, transparent 40px 80px)',
          }}
        />
      </div>

      {/* position:fixed banner must pin to the composition edge (viewport === composition) */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100vw',
          height: '12vh',
          background: 'rgba(255,46,99,0.92)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 52,
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        position: fixed · 100vw
      </div>
    </AbsoluteFill>
  );
}
