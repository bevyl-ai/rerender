// Web Audio preview scheduler for rerender.
//
// html5 <audio>-per-clip has an inherent .play() pipeline latency and cold-seek cost, and the
// player's frame clock free-runs over it — so a dense silence-removal edit gets startup silence
// plus a gap at every cut. This schedules audio the way a real player does: decode each source
// once, then place each clip's slice at a precise AudioContext time relative to a play-anchor.
// Web Audio's start(when, offset, duration) is sample-accurate, so handoffs are gapless with no
// per-clip play() latency. Preview-only; the render path still muxes from useRenderAsset.

let ctx: AudioContext | null = null;
export function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return ctx;
}
export function resumeCtx(): void {
  const c = getCtx();
  if (c.state === 'suspended') void c.resume();
}

// Decode each URL exactly once; clips of the same source share the AudioBuffer.
const decodeCache = new Map<string, Promise<AudioBuffer>>();
export function decode(url: string): Promise<AudioBuffer> {
  let p = decodeCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => getCtx().decodeAudioData(b));
    decodeCache.set(url, p);
  }
  return p;
}

// One registered <Audio> instance. `volume` may be a per-frame function (fades), called with the
// clip-local frame — the same value the render path bakes into its per-frame volume envelope.
export interface ClipReg {
  buffer: AudioBuffer;
  fromFrame: number; // absolute timeline start frame
  trimBefore: number; // source in-point, frames
  durFrames: number; // clip length on the timeline, frames
  playbackRate: number;
  volume: number | ((frame: number) => number);
  fps: number;
}

const registry = new Map<symbol, ClipReg>();
const live = new Map<symbol, { node: AudioBufferSourceNode; gain: GainNode }>();

// Anchor: AudioContext time + player frame at the instant playback began. Every clip and the
// player's frame clock read from this, so audio and video share one clock (no wall-vs-audio drift).
let anchor: { ctxTime: number; frame: number } | null = null;

export function isAnchored(): boolean {
  return anchor !== null;
}
/** The play anchor, for the player's audio-as-master-clock. */
export function getAnchor(): { ctxTime: number; frame: number } | null {
  return anchor;
}

/** Register (or update) a clip. If playback is anchored, (re)schedule it immediately — this is how
 *  a clip that mounts mid-playback (its premount window) gets scheduled ahead of its cut. */
export function register(id: symbol, reg: ClipReg): void {
  registry.set(id, reg);
  if (anchor) scheduleOne(id, reg);
}
export function unregister(id: symbol): void {
  registry.delete(id);
  stopOne(id);
}

/** (Re)anchor and schedule every registered clip. Called on play, loop, and seek-while-playing. */
export function beginPlayback(frame: number, _fps: number): void {
  stopAllLive();
  anchor = { ctxTime: getCtx().currentTime, frame };
  for (const [id, reg] of registry) scheduleOne(id, reg);
}
export function stopPlayback(): void {
  anchor = null;
  stopAllLive();
}

function stopOne(id: symbol): void {
  const l = live.get(id);
  if (!l) return;
  try { l.node.onended = null; l.node.stop(); l.node.disconnect(); l.gain.disconnect(); } catch { /* already stopped */ }
  live.delete(id);
}
function stopAllLive(): void {
  for (const id of [...live.keys()]) stopOne(id);
}

function scheduleOne(id: symbol, reg: ClipReg): void {
  if (!anchor) return;
  stopOne(id); // replace any prior scheduling for this clip
  const c = getCtx();
  const { fps } = reg;
  const rate = reg.playbackRate || 1;
  // No trimAfter → play from the in-point to the end of the source; the Sequence unmounting the
  // clip (which unregisters it) clamps it to the actual timeline window.
  const effDur = Number.isFinite(reg.durFrames)
    ? reg.durFrames
    : Math.max(0, (reg.buffer.duration * fps - reg.trimBefore) / rate);
  const startCtx = anchor.ctxTime + (reg.fromFrame - anchor.frame) / fps;
  const endCtx = startCtx + effDur / fps;
  const now = c.currentTime;
  if (endCtx <= now + 0.02) return; // already finished

  // If the clip already began (we're mid-slice, e.g. after a seek), jump in at the right offset.
  const when = startCtx >= now ? startCtx : now;
  const framesElapsed = startCtx >= now ? 0 : (now - startCtx) * fps;
  const intoSec = (reg.trimBefore + framesElapsed * rate) / fps; // source seconds to start at
  const remainingTimelineFrames = effDur - framesElapsed;
  const srcDurSec = (remainingTimelineFrames * rate) / fps; // source seconds to consume

  const gain = c.createGain();
  applyVolume(gain, reg.volume, fps, when, framesElapsed, effDur);
  const node = c.createBufferSource();
  node.buffer = reg.buffer;
  node.playbackRate.value = rate;
  node.connect(gain);
  gain.connect(c.destination);
  try {
    node.start(when, Math.max(0, intoSec), Math.max(0, srcDurSec));
  } catch {
    try { gain.disconnect(); } catch { /* noop */ }
    return;
  }
  const rec = { node, gain };
  node.onended = () => {
    try { node.disconnect(); gain.disconnect(); } catch { /* noop */ }
    if (live.get(id) === rec) live.delete(id);
  };
  live.set(id, rec);
}

// Constant → set the gain. Per-frame function → automate the gain along the clip so fades play
// exactly as they render (sampled per frame, capped so a long clip doesn't create endless points).
function applyVolume(
  gain: GainNode,
  volume: number | ((frame: number) => number),
  fps: number,
  whenCtx: number,
  startFrame: number,
  endFrame: number,
): void {
  const p = gain.gain;
  if (typeof volume !== 'function') {
    p.value = Math.max(0, volume ?? 1);
    return;
  }
  const span = Math.max(1, endFrame - startFrame);
  const step = Math.max(1, Math.floor(span / 240));
  p.setValueAtTime(Math.max(0, volume(startFrame)), whenCtx);
  for (let f = startFrame + step; f <= endFrame; f += step) {
    p.linearRampToValueAtTime(Math.max(0, volume(f)), whenCtx + (f - startFrame) / fps);
  }
}
