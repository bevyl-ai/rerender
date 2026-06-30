// Flagship composition for the in-browser export showcase: real <Video> footage stays the
// clear hero, with a dynamic-but-cohesive overlay on top — a hue-shifting color grade, a
// drifting light-leak, glowing edge orbs, and a left-side legibility wash for the type. Every
// layer is translucent and the footage is the base, because the export composites the <Video>
// first and paints the foreignObject overlay (everything else) over it — so total overlay
// opacity is kept low enough that the footage clearly shows through in the exported mp4.
import { AbsoluteFill, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from '../src';

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const WORDS = ['real', 'DOM', '→', 'mp4'];
const CHIPS = ['<Video>', 'WebCodecs', 'mediabunny'];

function Orb({ x, y, size, hue, op = 0.7 }: { x: number; y: number; size: number; hue: number; op?: number }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        opacity: op,
        background: `radial-gradient(circle at 35% 30%, hsla(${hue}, 95%, 66%, 0.85), hsla(${hue}, 95%, 55%, 0) 70%)`,
      }}
    />
  );
}

export function HeroReel(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const last = durationInFrames - 1;
  const t = frame / last;
  const ph = frame / fps;

  const ken = interpolate(frame, [0, last], [1.08, 1.22]); // Ken Burns push on the footage
  const pop = (delay: number): number => spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 120 } });
  const subO = interpolate(frame, [22, 38], [0, 1], { extrapolateRight: 'clamp' });
  const gradeHue = interpolate(frame, [0, last], [330, 268]); // slow hue drift on the color grade
  const leakX = interpolate(frame, [0, last], [12, 92]); // light-leak sweeps across
  const leakO = 0.32 + 0.1 * Math.sin(ph * 2);

  // Root is transparent: the export composites the footage UNDER this overlay, so an opaque
  // root background would paint over the video (the bug that hid the footage before).
  return (
    <AbsoluteFill style={{ fontFamily: FONT, overflow: 'hidden' }}>
      {/* real footage — the clear hero */}
      <Video src={staticFile('demo-clip.mp4')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${ken})` }} />

      {/* hue-shifting color grade — subtle mood, footage still reads through */}
      <AbsoluteFill
        style={{
          opacity: 0.2,
          background: `linear-gradient(120deg, hsla(${gradeHue}, 85%, 55%, 0.6) 0%, transparent 55%, hsla(${gradeHue - 70}, 85%, 52%, 0.55) 100%)`,
        }}
      />
      {/* drifting light-leak */}
      <AbsoluteFill
        style={{ opacity: leakO, background: `radial-gradient(ellipse 38% 90% at ${leakX}% 28%, hsla(335,100%,70%,0.6), transparent 60%)` }}
      />

      {/* glowing edge orbs — frame the footage without covering the center */}
      <Orb x={width * 0.92 + Math.sin(ph * 0.6) * 40} y={height * 0.24 + Math.cos(ph * 0.5) * 30} size={360} hue={330} />
      <Orb x={width * 0.08 + Math.sin(ph * 0.5 + 2) * 36} y={height * 0.82 + Math.cos(ph * 0.6) * 28} size={320} hue={262} />
      <Orb x={width * 0.72 + Math.sin(ph * 0.8 + 3) * 44} y={height * 0.88 + Math.cos(ph * 0.5 + 1) * 24} size={240} hue={196} op={0.55} />

      {/* legibility wash — only the left, where the type sits */}
      <AbsoluteFill style={{ background: 'linear-gradient(100deg, rgba(4,2,12,0.86) 0%, rgba(4,2,12,0.32) 46%, transparent 78%)' }} />

      {/* the proof anchor — ticks in lockstep in the preview AND the exported mp4 */}
      <div
        style={{
          position: 'absolute',
          top: 28,
          right: 32,
          fontFamily: MONO,
          fontSize: 18,
          color: 'rgba(255,255,255,0.92)',
          background: 'rgba(0,0,0,0.42)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 10,
          padding: '8px 14px',
          letterSpacing: 1,
        }}
      >
        frame {String(Math.floor(frame)).padStart(3, '0')} / {last}
      </div>

      <AbsoluteFill style={{ alignItems: 'flex-start', justifyContent: 'center', padding: '0 86px' }}>
        <div style={{ display: 'flex', gap: 26, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {WORDS.map((w, i) => {
            const s = pop(i * 6);
            return (
              <span
                key={w}
                style={{
                  display: 'inline-block',
                  transform: `translateY(${interpolate(s, [0, 1], [70, 0])}px) scale(${interpolate(s, [0, 1], [0.8, 1])})`,
                  opacity: interpolate(s, [0, 1], [0, 1]),
                  fontSize: w === '→' ? 82 : 110,
                  fontWeight: 850,
                  lineHeight: 1,
                  color: w === 'mp4' ? '#ff6f9d' : '#fff',
                  textShadow: w === 'mp4' ? '0 10px 60px rgba(255,94,138,0.7)' : '0 6px 34px rgba(0,0,0,0.7)',
                }}
              >
                {w}
              </span>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 26,
            fontSize: 27,
            color: 'rgba(255,255,255,0.8)',
            opacity: subO,
            transform: `translateY(${interpolate(subO, [0, 1], [18, 0])}px)`,
            textShadow: '0 2px 20px rgba(0,0,0,0.85)',
          }}
        >
          real footage + real CSS — encoded in your browser
        </div>

        <div style={{ marginTop: 34, display: 'flex', gap: 12 }}>
          {CHIPS.map((c, i) => {
            const o = interpolate(frame, [38 + i * 5, 50 + i * 5], [0, 1], { extrapolateRight: 'clamp' });
            return (
              <span
                key={c}
                style={{
                  opacity: o,
                  transform: `translateY(${interpolate(o, [0, 1], [14, 0])}px)`,
                  fontFamily: MONO,
                  fontSize: 15,
                  color: 'rgba(255,255,255,0.9)',
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 999,
                  padding: '7px 16px',
                }}
              >
                {c}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 6,
          width: `${t * 100}%`,
          background: 'linear-gradient(90deg,#ff5e8a,#a64bf4,#2bd2ff)',
        }}
      />
    </AbsoluteFill>
  );
}
