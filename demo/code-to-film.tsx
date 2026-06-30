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

// ─── TIMELINE ─────────────────────────────────────────────────────────────────
// Every frame number in this film is derived from here. Each beat says how many frames it
// lasts; the starts accumulate into T.<beat>, so to make a phase breathe you just bump its
// duration and everything after it slides to match — no chasing magic numbers through the JSX.
const BEATS = [
  { k: 'lead', d: 4 }, //      a still moment before anything appears
  { k: 'pop', d: 60 }, //      a bordered square springs in — the spring settles well inside this,
  //                            so it's a brief hold to read, not a dead wait
  { k: 'round', d: 64 }, //    its corners round off
  { k: 'tilt', d: 64 }, //     it rotates
  { k: 'lift', d: 70 }, //     a shadow lifts it off the page
  { k: 'fill', d: 60 }, //     a gradient fills the face — the card is complete. The first color in
  //                            the whole film now lands well inside 10s, not at 11.2s.
  { k: 'compose', d: 110 }, // it glides to centre, multiplies into a grid of pure CSS, and HOLDS so
  //                            you can read each technique — conic-gradient, clip-path, mask-image…
  { k: 'grow', d: 76 }, //     the card grows into a full-frame screen, the footage inside it
  { k: 'film', d: 100 }, //    the finished film plays, the punchline lands, holds, then fades to
  //                            black — this composition LOOPS with a bare jump back to frame 0
  //                            (no crossfade), so the tail must already be black or the loop reads
  //                            as a jarring cut from the brightest frame straight to a dark one.
] as const;
// how long each CSS property takes to MORPH in (frames). Wide = the change glides slowly into
// place instead of snapping then sitting on a dead hold — the build reads as luxurious, not static.
const MORPH = 56;
// how long the card takes to grow into the screen AND the grid to explode outward. Kept close to
// MORPH so the reveal lands at the SAME deliberate pace as the build — no jarring fast "explode".
const GROW_SPAN = 60;
type BeatKey = (typeof BEATS)[number]['k'];
const T = {} as Record<BeatKey, number>;
let acc = 0;
for (const b of BEATS) {
  T[b.k] = acc;
  acc += b.d;
}
export const CODE_TO_FILM_DURATION = acc;

// the source builds line by line — each property typed a few frames BEFORE its visual lands,
// then held so you can read it. Anchored to the build beats, so it moves with the timeline.
const LINES: { f: number; t: string }[] = [
  { f: T.pop - 4, t: '<div style={{' },
  { f: T.pop + 4, t: '  width: 200, height: 200,' },
  { f: T.pop + 10, t: "  border: '3px solid #ff5e8a'," },
  { f: T.round - 8, t: '  borderRadius: 28,' },
  { f: T.tilt - 8, t: "  transform: 'rotate(-10deg)'," },
  { f: T.lift - 8, t: "  boxShadow: '0 30px 80px #ff5e8a66'," },
  { f: T.fill - 8, t: "  background: 'linear-gradient(#ff5e8a,#ffb24a)'," },
  { f: T.fill + 6, t: '}} />' },
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
  const heroPop = Math.max(0, spring({ frame: frame - T.pop, fps, config: { damping: 11, stiffness: 130 } }));
  const heroX = key([T.compose, T.compose + 24], [772, 640]);
  const heroW = key([T.grow, T.grow + GROW_SPAN], [244, 1280]);
  const heroH = key([T.grow, T.grow + GROW_SPAN], [244, 720]);
  const heroRadius = key([T.round, T.round + MORPH, T.grow, T.grow + GROW_SPAN], [2, 28, 28, 0]);
  const heroRot = key([T.tilt, T.tilt + MORPH, T.grow - 44, T.grow - 24], [0, -10, -10, 0]);
  const heroBorderA = seg(T.pop + 8, T.pop + 28) * seg(T.grow - 2, T.grow + 22, 1, 0);
  const heroShadow = seg(T.lift, T.lift + MORPH) * seg(T.grow - 2, T.grow + 26, 1, 0);
  const faceFade = seg(T.fill, T.fill + MORPH) * seg(T.grow + 4, T.grow + 52, 1, 0); // gradient FACE fades to reveal the footage
  // only deliberate scale moves remain: a soft settle as it reaches centre, and a slow push on the film
  const heroScale =
    heroPop * key([T.compose + 6, T.compose + 22, T.compose + 36], [1, 1.1, 1]) * key([T.grow + GROW_SPAN, last], [1, 1.08]);

  const codeOp = seg(T.pop - 4, T.pop + 6) * seg(T.compose, T.compose + 16, 1, 0);
  const codeCursor = LINES.reduce((a, l, i) => (frame >= l.f ? i : a), -1); // line currently "typing"
  const gridIn = seg(T.grow - 12, T.grow + 44, 1, 0); // grid EXPLODES outward as the hero opens — slow, to match the build pace
  const glowOp = seg(T.compose + 14, T.compose + 34) * seg(T.grow - 6, T.grow + 30, 1, 0);
  const grade = seg(T.grow + 44, T.grow + 74) * 0.32;
  const gradeHue = key([T.grow + 44, last], [330, 268]);
  // the punchline — softer/less snappy than the build's springs (damping17 vs 11-13 elsewhere) and
  // starting only 6 frames after the grade finishes (was 12) so it reads as a continuation of the
  // reveal's motion rather than "everything stops, then the title suddenly snaps in"
  const tSpring = (d: number): number => Math.max(0, spring({ frame: frame - d, fps, config: { damping: 17, stiffness: 110 } }));
  const t1 = tSpring(T.film + 6);
  const t3 = seg(T.film + 30, T.film + 46);
  const flash = seg(T.grow + 14, T.grow + 24, 0, 0.92) * seg(T.grow + 24, T.grow + 56, 1, 0); // bloom-burst as the card opens into the film
  // the title holds fully settled, then the whole scene fades to black over the final 24 frames —
  // so the loop's jump back to frame 0 (also near-black) reads as a clean cut, not a jarring one
  const endFade = seg(last - 24, last);
  // a FIXED overscan — deliberately NOT animated. An ancestor scale that changes every frame forces
  // every glyph beneath it to re-rasterize and snap to the pixel grid each frame, which reads as Y
  // jitter on the type. The drift that needed a moving zoom is gone, so this stays constant.
  const camZoom = 1.025;

  return (
    <AbsoluteFill style={{ fontFamily: SANS, overflow: 'hidden' }}>
      {/* CAMERA — a gentle drift + push over the whole scene (HUD/progress stay pinned outside) */}
      <AbsoluteFill style={{ transform: `scale(${camZoom})`, transformOrigin: '50% 50%' }}>
        {/* atmospheric backdrop for the build/grid (deep indigo, not flat black) — fades out before
          the footage reveals, since the export composites any non-video layer ON TOP of the video */}
        <AbsoluteFill
          style={{
            opacity: seg(0, 18) * seg(T.grow - 24, T.grow - 2, 1, 0),
            background: 'radial-gradient(125% 85% at 50% 36%, #17121f 0%, #0a0712 52%, #040209 100%)',
          }}
        />

        {/* a soft ambient glow, slowly drifting, present from frame 0 — keeps the build's mostly-empty
          frame alive without adding a second "object" (which would contradict the one-div story).
          Fades out as the grid's own glow (below) takes over once it arrives. */}
        <AbsoluteFill
          style={{
            opacity: seg(0, 26) * 0.16 * seg(T.compose - 16, T.compose + 14, 1, 0),
            background: `radial-gradient(560px 560px at ${30 + Math.sin(ph * 0.2) * 6}% ${52 + Math.cos(ph * 0.16) * 6}%, rgba(166,75,244,0.55), transparent 62%)`,
          }}
        />

        {/* soft center glow behind the grid */}
        <AbsoluteFill
          style={{ opacity: glowOp * 0.6, background: 'radial-gradient(circle at 50% 50%, rgba(166,75,244,0.5), transparent 58%)' }}
        />

        {/* THE DESIGN LANGUAGE — a labeled grid of styled divs that fly out of the hero with 3D depth */}
        {GRID.map((c) => {
          const order = Math.abs(c.dx) + Math.abs(c.dy); // assemble from the centre outward
          const pop = Math.max(0, spring({ frame: frame - (T.compose + 16 + (order / G) * 6), fps, config: { damping: 13, stiffness: 130 } }));
          const spread = pop * (1 + (1 - gridIn) * 2.2); // fly OUT of the hero, then explode outward as it opens
          const cx = 640 + c.dx * spread;
          const cy = 360 + c.dy * spread;
          const ry = (c.dx / G) * -7; // a little perspective depth — but flat enough that labels stay readable
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
                transform: `perspective(820px) rotateY(${ry}deg) scale(${pop})`,
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
                  bottom: -32,
                  left: 0,
                  width: '100%',
                  textAlign: 'center',
                  fontFamily: MONO,
                  fontSize: 15,
                }}
              >
                <span
                  style={{
                    background: 'rgba(8,6,16,0.7)',
                    color: '#fff',
                    borderRadius: 7,
                    padding: '3px 9px',
                    fontWeight: 600,
                    letterSpacing: 0.2,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.55)',
                  }}
                >
                  {c.label}
                </span>
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
          {/* the footage — bottom layer, rounded to the card via the renderer's border-radius clip.
            Held on its first frame until the reveal (T.grow) so it never plays — and never jitters —
            behind the still-transparent square during the slow build; it comes alive as the card opens. */}
          <Video
            src={staticFile('demo-clip.mp4')}
            trimBefore={-T.grow}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: heroRadius }}
          />
          {/* opaque panel that hides the footage through the whole build so it never shimmers behind
            the still-transparent square — the card reads as a clean dark surface, then peels away at
            the reveal (with the gradient face) to show the live video underneath */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: heroRadius,
              background: 'linear-gradient(135deg,#15111f,#0b0910)',
              opacity: seg(T.grow + 4, T.grow + 52, 1, 0),
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: heroRadius,
              // glossy top-left highlight over the gradient — reads as a premium, lit surface
              background:
                'radial-gradient(120% 90% at 26% 18%, rgba(255,255,255,0.45), rgba(255,255,255,0) 46%), linear-gradient(135deg,#ff5e8a,#ffb24a)',
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
        {/* warm directional key light from above + a teal floor — golden-hour dimension on the footage */}
        <AbsoluteFill
          style={{
            opacity: seg(T.grow + 44, T.grow + 74) * 0.9,
            background:
              'radial-gradient(95% 62% at 50% -10%, rgba(255,198,120,0.42), transparent 52%), radial-gradient(120% 70% at 50% 120%, rgba(30,120,150,0.32), transparent 55%)',
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
          style={{ opacity: seg(T.grow + 44, T.grow + 74) * 0.55, background: 'radial-gradient(circle at 50% 46%, transparent 42%, rgba(2,1,8,0.9) 100%)' }}
        />
        {/* light bloom-burst as the card opens into the film */}
        <AbsoluteFill
          style={{
            opacity: flash,
            background: 'radial-gradient(circle at 50% 48%, rgba(255,253,250,1), rgba(255,196,156,0.45) 28%, transparent 56%)',
          }}
        />

        {/* THE SOURCE — builds line by line (Act 1) */}
        <div
          style={{
            position: 'absolute',
            left: 66,
            top: 220,
            transform: `translateX(${key([T.compose, T.compose + 20], [0, -90])}px)`,
            opacity: codeOp,
            background: 'rgba(9,10,17,0.82)',
            borderRadius: 14,
            padding: '20px 24px',
            border: '1px solid #24242f',
            boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
          }}
        >
          {LINES.map((ln, i) => {
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
                {i === codeCursor && frame < T.compose && (
                  <span style={{ color: '#ff6f9d', opacity: Math.floor(frame / 8) % 2 === 0 ? 1 : 0.2 }}>▋</span>
                )}
              </div>
            );
          })}
        </div>

        {/* headers that frame each moment */}
        <div
          style={{
            position: 'absolute',
            top: 88,
            left: 0,
            width: '100%',
            textAlign: 'center',
            fontFamily: MONO,
            fontSize: 21,
            fontWeight: 500,
            letterSpacing: 0.3,
            color: 'rgba(255,255,255,0.82)',
            textShadow: '0 2px 16px rgba(0,0,0,0.85)',
          }}
        >
          <span style={{ opacity: seg(2, 12) * seg(T.compose, T.compose + 16, 1, 0) }}>{'// it starts with one <div>'}</span>
          <span
            style={{ position: 'absolute', left: 0, width: '100%', opacity: seg(T.compose + 16, T.compose + 30) * seg(T.grow - 8, T.grow + 6, 1, 0) }}
          >
            {'// …and it composes, all of it just CSS'}
          </span>
        </div>

        {/* THE PUNCHLINE — staggered kinetic reveal, solid colours (gradient-clip text doesn't export) */}
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 78 }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 72,
                fontWeight: 850,
                lineHeight: 1.0,
                letterSpacing: -2,
                color: '#ff6f9d',
                opacity: t1,
                transform: `translateY(${interpolate(t1, [0, 1], [30, 0])}px) scale(${interpolate(t1, [0, 1], [0.94, 1])})`,
                textShadow: '0 10px 50px rgba(255,94,138,0.45), 0 4px 20px rgba(0,0,0,0.6)',
              }}
            >
              This is a React component.
            </div>
            <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 15, color: 'rgba(255,255,255,0.66)', letterSpacing: 1, opacity: t3 }}>
              in your browser · no server · no ffmpeg
            </div>
          </div>
        </AbsoluteFill>

        {/* fade to black for the loop point — see endFade above */}
        <AbsoluteFill style={{ opacity: endFade, background: '#000' }} />
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
