// The flagship composition for the in-browser export showcase: real <Video> footage with a
// Ken Burns push, an animated gradient wash, drifting CSS-gradient "orbs", kinetic type, and
// a live frame-counter HUD — all real DOM/CSS, all captured into the exported mp4. Built from
// only foreignObject-reproducible CSS (no backdrop-filter) so the export matches the preview;
// the <Video> is decoded by mediabunny and composited under the DOM overlay.
import { AbsoluteFill, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from '../src';

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const WORDS = ['real', 'DOM', '→', 'mp4'];
const CHIPS = ['<Video>', 'WebCodecs', 'mediabunny'];

// A glowing circle — just a div with a radial-gradient background. (This is the snippet the
// showcase displays to make the "it's real CSS" point concrete.)
function Orb({ x, y, size, hue }: { x: number; y: number; size: number; hue: number }): JSX.Element {
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
        background: `radial-gradient(circle at 35% 30%, hsla(${hue}, 92%, 68%, 0.85), hsla(${hue}, 92%, 55%, 0) 70%)`,
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

  const ken = interpolate(frame, [0, last], [1.08, 1.24]); // Ken Burns push on the footage
  const washHue = interpolate(frame, [0, last], [270, 320]);
  const pop = (delay: number): number => spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 120 } });
  const subO = interpolate(frame, [22, 38], [0, 1], { extrapolateRight: 'clamp' });

  // Root is transparent behind the <Video>: the export composites the footage UNDER the
  // foreignObject overlay, so an opaque root background here would paint over the video.
  return (
    <AbsoluteFill style={{ fontFamily: FONT, overflow: 'hidden' }}>
      {/* real footage */}
      <Video src={staticFile('demo-clip.mp4')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${ken})` }} />

      {/* gradient wash for legibility + a moving hue accent (over the video) */}
      <AbsoluteFill
        style={{ background: `linear-gradient(105deg, rgba(8,6,16,0.94) 0%, rgba(8,6,16,0.55) 46%, hsla(${washHue},60%,20%,0.25) 100%)` }}
      />
      <Orb x={width * 0.82 + Math.sin(ph * 0.6) * 60} y={height * 0.3 + Math.cos(ph * 0.5) * 44} size={360} hue={332} />
      <Orb x={width * 0.64 + Math.sin(ph * 0.7 + 3) * 50} y={height * 0.74 + Math.cos(ph * 0.5 + 1) * 36} size={300} hue={258} />

      {/* the proof anchor — this number ticks in lockstep in the preview AND the exported mp4 */}
      <div
        style={{
          position: 'absolute',
          top: 28,
          right: 32,
          fontFamily: MONO,
          fontSize: 18,
          color: 'rgba(255,255,255,0.9)',
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.16)',
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
                  textShadow: w === 'mp4' ? '0 10px 60px rgba(255,94,138,0.65)' : '0 4px 30px rgba(0,0,0,0.5)',
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
            color: 'rgba(255,255,255,0.72)',
            opacity: subO,
            transform: `translateY(${interpolate(subO, [0, 1], [18, 0])}px)`,
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
                  color: 'rgba(255,255,255,0.85)',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.18)',
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
          background: 'linear-gradient(90deg,#ff5e8a,#ffa14a)',
        }}
      />
    </AbsoluteFill>
  );
}
