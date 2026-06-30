// A single <div> builds itself with CSS, multiplies into a labeled grid of components (a whole
// design language — conic gradients, clip-path, filters, masks, all real DOM), then the hero card
// GROWS INTO THE SCREEN with the footage revealed inside it, and resolves into a full film. The
// point: the polished video is the same DOM + CSS you watched assemble. The footage is the one
// <Video>, kept bottom-layer so the in-browser export composites it — rounded to the card via the
// renderer's border-radius clipping.
import { AbsoluteFill, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from '../src';

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const STR = '#98c379';

const LINES: { f: number; t: string }[] = [
  { f: 4, t: '<div style={{' },
  { f: 12, t: '  width: 200, height: 200,' },
  { f: 16, t: "  border: '3px solid #ff5e8a'," },
  { f: 28, t: '  borderRadius: 28,' },
  { f: 40, t: "  transform: 'rotate(-10deg)'," },
  { f: 52, t: "  boxShadow: '0 30px 80px #ff5e8a66'," },
  { f: 62, t: "  background: 'linear-gradient(#ff5e8a,#ffb24a)'," },
  { f: 74, t: '}} />' },
];

// the design language — one div becomes a whole grid of CSS, each cell a technique
interface Cell {
  dx: number;
  dy: number;
  label: string;
  bg: string;
  r: number | string;
  clip?: string;
  filter?: string;
  border?: boolean;
  mask?: boolean;
}
const G = 182;
const GRID: Cell[] = [
  { dx: -G, dy: -G, label: 'conic-gradient', bg: 'conic-gradient(from 0deg,#ff5e8a,#a64bf4,#2bd2ff,#ff5e8a)', r: 24 },
  { dx: 0, dy: -G, label: 'clip-path', bg: 'linear-gradient(135deg,#ffb24a,#ff5e8a)', r: 8, clip: 'polygon(50% 0,100% 100%,0 100%)' },
  { dx: G, dy: -G, label: 'radial-gradient', bg: 'radial-gradient(circle at 38% 32%,#ffe08a,#ff5e8a 72%)', r: '50%' },
  { dx: -G, dy: 0, label: 'filter: blur', bg: 'linear-gradient(135deg,#a64bf4,#2bd2ff)', r: 24, filter: 'blur(4px)' },
  { dx: G, dy: 0, label: 'mask-image', bg: 'linear-gradient(90deg,#ff5e8a,#2bd2ff)', r: 24, mask: true },
  { dx: -G, dy: G, label: 'border', bg: 'transparent', r: 24, border: true },
  { dx: 0, dy: G, label: 'box-shadow', bg: 'linear-gradient(135deg,#2bd2ff,#36f5a0)', r: 24 },
  { dx: G, dy: G, label: 'linear-gradient', bg: 'linear-gradient(135deg,#ff5e8a,#a64bf4)', r: 24 },
];

const BOKEH = [
  { x: 210, y: 180, hue: 330, op: 0.5 },
  { x: 1080, y: 540, hue: 264, op: 0.42 },
  { x: 660, y: 640, hue: 40, op: 0.46 },
];

function highlight(text: string): JSX.Element[] {
  return text.split(/('[^']*')/g).map((p, i) => (
    <span key={`${p}-${i}`} style={p.startsWith("'") ? { color: STR } : undefined}>
      {p}
    </span>
  ));
}

export function CodeToFilm(): JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const last = durationInFrames - 1;
  const ph = frame / fps;
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const key = (pts: number[], vals: number[]): number => interpolate(frame, pts, vals, clamp);
  const seg = (a: number, b: number, from = 0, to = 1): number => interpolate(frame, [a, b], [from, to], clamp);

  // ── hero card: built (Act 1, center-right) → centers for the grid (Act 2) → grows into the
  //    full-frame screen with the footage revealed inside it (Act 3) ──
  const heroPop = Math.max(0, spring({ frame: frame - 8, fps, config: { damping: 14, stiffness: 120 } }));
  const heroX = key([72, 96], [772, 640]);
  const heroW = key([140, 182], [220, 1280]);
  const heroH = key([140, 182], [220, 720]);
  const heroRadius = key([28, 42, 140, 182], [2, 28, 28, 0]);
  const heroRot = key([40, 56, 104, 122], [0, -10, -10, 0]);
  const heroBorderA = seg(14, 24) * seg(140, 158, 1, 0);
  const heroShadow = seg(52, 66) * seg(140, 162, 1, 0);
  const faceFade = seg(62, 78) * seg(142, 168, 1, 0); // gradient FACE fades to reveal the footage
  const heroScale = heroPop * key([78, 94, 108], [1, 1.1, 1]) * key([182, last], [1, 1.08]);

  const codeOp = seg(6, 16) * seg(74, 90, 1, 0);
  const gridIn = seg(132, 154, 1, 0); // grid recedes as the hero opens
  const glowOp = seg(86, 106) * seg(138, 158, 1, 0);
  const grade = seg(166, 196) * 0.32;
  const gradeHue = key([166, last], [330, 268]);
  const titleIn = seg(198, 218);

  return (
    <AbsoluteFill style={{ fontFamily: SANS, overflow: 'hidden' }}>
      {/* soft center glow behind the grid */}
      <AbsoluteFill
        style={{ opacity: glowOp * 0.6, background: 'radial-gradient(circle at 50% 50%, rgba(166,75,244,0.5), transparent 58%)' }}
      />

      {/* THE DESIGN LANGUAGE — a labeled grid of styled divs around the hero (Act 2) */}
      {GRID.map((c, i) => {
        const order = Math.abs(c.dx) + Math.abs(c.dy); // assemble from the centre outward
        const pop = Math.max(0, spring({ frame: frame - (88 + (order / G) * 6), fps, config: { damping: 15, stiffness: 130 } }));
        const cx = 640 + c.dx;
        const cy = 360 + c.dy + Math.sin(ph * 0.8 + i) * 7;
        const sc = pop * gridIn * (1 - (1 - gridIn) * 0.3);
        return (
          <div
            key={c.label}
            style={{
              position: 'absolute',
              left: cx,
              top: cy,
              width: 138,
              height: 138,
              marginLeft: -69,
              marginTop: -69,
              transform: `scale(${sc})`,
              opacity: gridIn,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: c.r,
                background: c.bg,
                clipPath: c.clip,
                filter: c.filter,
                border: c.border ? '3px solid #ff5e8a' : undefined,
                boxShadow: '0 22px 50px rgba(0,0,0,0.45)',
                WebkitMaskImage: c.mask ? 'linear-gradient(105deg,#000 45%,transparent)' : undefined,
                maskImage: c.mask ? 'linear-gradient(105deg,#000 45%,transparent)' : undefined,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -24,
                left: 0,
                width: '100%',
                textAlign: 'center',
                fontFamily: MONO,
                fontSize: 12.5,
                color: 'rgba(255,255,255,0.82)',
              }}
            >
              {c.label}
            </div>
          </div>
        );
      })}

      {/* THE HERO — a div with a border → +radius +rotate +shadow +gradient → grows into the screen */}
      <div
        style={{
          position: 'absolute',
          left: heroX,
          top: 360,
          width: heroW,
          height: heroH,
          marginLeft: -heroW / 2,
          marginTop: -heroH / 2,
          transform: `rotate(${heroRot}deg) scale(${heroScale})`,
          borderRadius: heroRadius,
          boxShadow: `0 40px 120px rgba(255,94,138,${heroShadow * 0.5})`,
        }}
      >
        {/* the footage — bottom layer, rounded to the card via the renderer's border-radius clip */}
        <Video
          src={staticFile('demo-clip.mp4')}
          trimBefore={-140}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: heroRadius }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: heroRadius,
            background: 'linear-gradient(135deg,#ff5e8a,#ffb24a)',
            opacity: faceFade,
          }}
        />
        <div style={{ position: 'absolute', inset: 0, borderRadius: heroRadius, border: `3px solid rgba(255,94,138,${heroBorderA})` }} />
      </div>

      {/* color grade over the footage */}
      <AbsoluteFill
        style={{
          opacity: grade,
          background: `linear-gradient(120deg, hsla(${gradeHue},85%,55%,0.6) 0%, transparent 55%, hsla(${gradeHue - 70},85%,52%,0.5) 100%)`,
        }}
      />
      {/* drifting bokeh — soft out-of-focus light for cinematic depth (filter:blur renders to mp4) */}
      {BOKEH.map((b, i) => (
        <div
          key={`bokeh-${b.hue}`}
          style={{
            position: 'absolute',
            left: b.x + Math.sin(ph * 0.5 + i * 2) * 60,
            top: b.y + Math.cos(ph * 0.4 + i) * 40,
            width: 300,
            height: 300,
            marginLeft: -150,
            marginTop: -150,
            borderRadius: '50%',
            opacity: grade * 1.7 * b.op,
            background: `radial-gradient(circle, hsla(${b.hue},92%,68%,0.6), transparent 64%)`,
            filter: 'blur(12px)',
          }}
        />
      ))}
      {/* cinematic vignette for depth */}
      <AbsoluteFill
        style={{ opacity: seg(168, 196) * 0.55, background: 'radial-gradient(circle at 50% 46%, transparent 42%, rgba(2,1,8,0.9) 100%)' }}
      />

      {/* THE SOURCE — builds line by line (Act 1) */}
      <div
        style={{
          position: 'absolute',
          left: 66,
          top: 220,
          transform: `translateX(${key([74, 94], [0, -90])}px)`,
          opacity: codeOp,
          background: 'rgba(9,10,17,0.82)',
          borderRadius: 14,
          padding: '20px 24px',
          border: '1px solid #24242f',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        }}
      >
        {LINES.map((ln) => {
          const o = seg(ln.f, ln.f + 8);
          const fresh = frame >= ln.f && frame < ln.f + 18;
          return (
            <div
              key={ln.t}
              style={{
                opacity: o,
                transform: `translateX(${interpolate(o, [0, 1], [10, 0])}px)`,
                background: fresh ? 'rgba(255,94,138,0.14)' : 'transparent',
                borderRadius: 5,
                margin: '0 -6px',
                padding: '0 6px',
                fontFamily: MONO,
                fontSize: 16,
                lineHeight: 1.62,
                color: '#9aa4b2',
                whiteSpace: 'pre',
              }}
            >
              {highlight(ln.t)}
            </div>
          );
        })}
      </div>

      {/* headers that frame each moment */}
      <div
        style={{
          position: 'absolute',
          top: 92,
          left: 0,
          width: '100%',
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: 16,
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        <span style={{ opacity: seg(2, 12) * seg(72, 88, 1, 0) }}>{'// it starts with one <div>'}</span>
        <span style={{ position: 'absolute', left: 0, width: '100%', opacity: seg(96, 110) * seg(132, 146, 1, 0) }}>
          {'// …and it composes — all of it just CSS'}
        </span>
      </div>

      {/* THE PUNCHLINE — solid colours (gradient-clip text doesn't survive the export) */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 84, opacity: titleIn }}>
        <div style={{ transform: `translateY(${interpolate(titleIn, [0, 1], [24, 0])}px)`, textAlign: 'center' }}>
          <div
            style={{
              fontSize: 58,
              fontWeight: 850,
              lineHeight: 1.04,
              letterSpacing: -1.5,
              color: '#fff',
              textShadow: '0 8px 40px rgba(0,0,0,0.75)',
            }}
          >
            This is one React component.
          </div>
          <div
            style={{
              fontSize: 58,
              fontWeight: 850,
              lineHeight: 1.04,
              letterSpacing: -1.5,
              color: '#ff7da1',
              textShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
          >
            It rendered itself to MP4.
          </div>
          <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 16, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.5 }}>
            in your browser · no server · no ffmpeg
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
