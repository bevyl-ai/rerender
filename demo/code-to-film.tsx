// "It was <div>s the whole time." The showcase composition that makes the point people miss:
// this is plain HTML/CSS/React — and it renders to a full video. The arc: bare inline-styled
// <div>s appear WITH their literal CSS shown as code → they spring into motion → the <Video>
// bursts in as the base layer → grade/orbs/type compound into a cinematic frame → a title lands
// the thesis. Every visual is real DOM; the footage is the only <Video>, kept as the bottom
// layer so the in-browser export composites it correctly (the lib de-overlays it so it's smooth).
import { AbsoluteFill, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from '../src';

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
// one-color-per-token, like an editor
const C = { plain: '#9aa4b2', str: '#98c379', tag: '#e06c75', prop: '#d19a66', punc: '#5c6370' };

/** A line of code with single-quoted strings highlighted — so the captions read like real source. */
function CodeLine({ text, size = 13 }: { text: string; size?: number }): JSX.Element {
  const parts = text.split(/('[^']*')/g);
  return (
    <div style={{ fontFamily: MONO, fontSize: size, lineHeight: 1.5, color: C.plain, whiteSpace: 'pre' }}>
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} style={p.startsWith("'") ? { color: C.str } : undefined}>
          {p}
        </span>
      ))}
    </div>
  );
}

export function CodeToFilm(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const last = durationInFrames - 1;
  const ph = frame / fps;
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const key = (pts: number[], vals: number[]): number => interpolate(frame, pts, vals, clamp);
  const seg = (a: number, b: number, from = 0, to = 1): number => interpolate(frame, [a, b], [from, to], clamp);
  const pop = (d: number): number => spring({ frame: frame - d, fps, config: { damping: 13, stiffness: 110 } });

  // ── the footage: the only <Video>. Bursts in (scale 0→1) at the "video comes in" beat, then a
  //    slow Ken Burns push. Wrapper carries the scale; it's the FIRST child = bottom layer. ──
  const vIn = Math.max(0, spring({ frame: frame - 104, fps, config: { damping: 16, stiffness: 85 } }));
  const ken = key([150, last], [1, 1.12]);
  const vScale = vIn * ken;

  const gradeHue = key([120, last], [330, 270]);

  // ── the three primitive cards: home (P1) → drift+grow (P2) → integrate as accents (P3/P4) ──
  // SQUARE → translucent corner accent
  const sq = {
    x: key([6, 55, 150], [400, 320, 168]),
    y: key([6, 55, 150], [252, 210, 150]),
    s: pop(6) * key([55, 150], [1, 0.8]),
    r: key([55, 130, last], [0, 16, 30]),
    a: key([100, 150], [1, 0.22]),
  };
  // ORB → grows into the corner glow
  const orb = {
    x: key([14, 55, 150], [640, 770, 1060]) + Math.sin(ph * 0.7) * 14,
    y: key([14, 55, 150], [252, 200, 150]) + Math.cos(ph * 0.6) * 12,
    s: pop(14) * key([55, 160], [1, 3.1]),
  };
  // BAR → slides down + stretches into the bottom progress streak
  const bar = {
    x: key([22, 55, 150], [880, 820, 640]),
    y: key([22, 55, 158], [284, 360, 690]),
    w: key([55, 158], [220, 1280]),
    h: key([110, 158], [64, 6]),
    r: key([55, 82, 110], [0, -5, 0]),
    a: key([120, 150], [1, 0.9]),
  };

  // the source panel: fades in once the three cards have popped, gone once they start moving
  const codeOp = seg(30, 44) * seg(96, 114, 1, 0);

  const head1 = seg(0, 14) * seg(92, 106, 1, 0); // "// just divs"
  const head2 = seg(58, 72) * seg(98, 112, 1, 0); // "// now they move"
  const vidCap = seg(112, 126) * seg(146, 158, 1, 0); // <Video> caption pulse
  const titleIn = seg(172, 192);

  return (
    <AbsoluteFill style={{ fontFamily: SANS, overflow: 'hidden' }}>
      {/* FOOTAGE — bottom layer. trimBefore offsets the SOURCE so the clip starts at 0 right when
          it bursts in (~f104); before that the negative source clamps to frame 0 (and it's scaled
          to nothing anyway). Keeps the seeked source ≤3.5s, inside the 4s clip — otherwise the
          7s comp would seek the <Video> past its end and stall the export's decoder. */}
      <AbsoluteFill style={{ transform: `scale(${vScale})`, overflow: 'hidden' }}>
        <Video src={staticFile('demo-clip.mp4')} trimBefore={-104} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>

      {/* hue-shifting color grade over the footage (fades in with the film) */}
      <AbsoluteFill
        style={{
          opacity: seg(118, 175) * 0.34,
          background: `linear-gradient(120deg, hsla(${gradeHue},85%,55%,0.6) 0%, transparent 55%, hsla(${gradeHue - 70},85%,52%,0.5) 100%)`,
        }}
      />

      {/* ORB (the radial-gradient div from card #2, grown into a corner glow) */}
      <div
        style={{
          position: 'absolute',
          left: orb.x,
          top: orb.y,
          width: 120,
          height: 120,
          transform: `translate(-50%,-50%) scale(${orb.s})`,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 32%, #ffe08a, #ff5e8a 58%, rgba(255,94,138,0) 74%)',
        }}
      />
      {/* a second glow joins as it gets complicated */}
      <div
        style={{
          position: 'absolute',
          left: 120 + Math.sin(ph * 0.5) * 40,
          top: 640,
          width: 520,
          height: 520,
          transform: 'translate(-50%,-50%)',
          opacity: seg(128, 168) * 0.7,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 35%, hsla(262,95%,66%,0.9), transparent 68%)',
        }}
      />

      {/* SQUARE (card #1) */}
      <div
        style={{
          position: 'absolute',
          left: sq.x,
          top: sq.y,
          width: 120,
          height: 120,
          marginLeft: -60,
          marginTop: -60,
          transform: `scale(${sq.s}) rotate(${sq.r}deg)`,
          transformOrigin: 'center',
          borderRadius: 28,
          background: `rgba(255,94,138,${sq.a})`,
          boxShadow: `0 18px 60px rgba(255,94,138,${sq.a * 0.6})`,
        }}
      />

      {/* BAR (card #3 → bottom streak) */}
      <div
        style={{
          position: 'absolute',
          left: bar.x,
          top: bar.y,
          width: bar.w,
          height: bar.h,
          marginLeft: -bar.w / 2,
          marginTop: -bar.h / 2,
          transform: `rotate(${bar.r}deg)`,
          opacity: bar.a,
          borderRadius: bar.h > 20 ? 14 : 3,
          background: 'linear-gradient(90deg,#a64bf4,#2bd2ff)',
        }}
      />

      {/* THE LITERAL SOURCE of the three cards above — one tidy panel, no overlap. */}
      <div
        style={{
          position: 'absolute',
          left: 640,
          top: 432,
          transform: `translateX(-50%) translateY(${interpolate(codeOp, [0, 1], [10, 0])}px)`,
          opacity: codeOp,
          background: 'rgba(9,10,17,0.82)',
          borderRadius: 14,
          padding: '18px 24px',
          border: '1px solid #24242f',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
        }}
      >
        <CodeLine text="<div style={{ borderRadius: 28, background: '#ff5e8a' }} />" />
        <CodeLine text="<div style={{ borderRadius: '50%', background:" />
        <CodeLine text="  'radial-gradient(circle, #ffd36e, #ff5e8a)' }} />" />
        <CodeLine text="<div style={{ borderRadius: 14, background:" />
        <CodeLine text="  'linear-gradient(90deg, #a64bf4, #2bd2ff)' }} />" />
      </div>

      {/* the <Video> tag, revealed as the footage bursts in */}
      <div
        style={{
          position: 'absolute',
          left: 640,
          top: 360,
          transform: `translate(-50%,-50%) scale(${interpolate(vidCap, [0, 1], [0.9, 1])})`,
          opacity: vidCap,
          background: 'rgba(6,6,12,0.7)',
          borderRadius: 12,
          padding: '14px 20px',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
      >
        <CodeLine text="<Video src={staticFile('demo-clip.mp4')} />" size={20} />
      </div>

      {/* header comment (top), crossfading P1 → P2 */}
      <div style={{ position: 'absolute', top: 86, left: 0, width: '100%', textAlign: 'center' }}>
        <div style={{ opacity: head1 }}>
          <CodeLine text="// three inline-styled <div>s. that's the whole frame." size={16} />
        </div>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', opacity: head2 }}>
          <CodeLine text="// + useCurrentFrame() — now they move" size={16} />
        </div>
      </div>

      {/* THE PUNCHLINE */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 96, opacity: titleIn }}>
        <div style={{ transform: `translateY(${interpolate(titleIn, [0, 1], [26, 0])}px)`, textAlign: 'center' }}>
          <div style={{ fontFamily: MONO, fontSize: 15, color: 'rgba(255,255,255,0.55)', letterSpacing: 1, marginBottom: 12 }}>
            {'// it was <div>s the whole time'}
          </div>
          <div
            style={{
              fontSize: 60,
              fontWeight: 850,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              color: '#fff',
              textShadow: '0 8px 40px rgba(0,0,0,0.7)',
            }}
          >
            It&rsquo;s just HTML &amp; CSS.
          </div>
          <div
            style={{
              fontSize: 60,
              fontWeight: 850,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              background: 'linear-gradient(90deg,#ff5e8a,#ffa14a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            And it&rsquo;s a full video.
          </div>
        </div>
      </AbsoluteFill>

      {/* frame HUD — ticks identically in the preview AND the exported mp4 */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          right: 28,
          fontFamily: MONO,
          fontSize: 16,
          color: 'rgba(255,255,255,0.9)',
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 9,
          padding: '6px 12px',
          letterSpacing: 1,
        }}
      >
        frame {String(Math.floor(frame)).padStart(3, '0')} / {last}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 4,
          width: `${(frame / last) * 100}%`,
          background: 'linear-gradient(90deg,#ff5e8a,#a64bf4,#2bd2ff)',
        }}
      />
    </AbsoluteFill>
  );
}
