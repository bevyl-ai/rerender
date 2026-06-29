// <Player> — the preview, and a drop-in for @remotion/player. Mounts the composition at
// native resolution, scales it to fit, drives the frame clock, and exposes the imperative
// PlayerRef (seekTo / play / pause / getCurrentFrame / addEventListener…) that an editor's
// playback transport drives. What plays here is exactly what the recorder records.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { ConfigContext, FrameContext, PlayingContext, TimelineContext, type VideoConfig } from './frame';
import { injectRemoverCSS } from './default-css';

injectRemoverCSS(); // match Remotion's global reset so preview == render == Remotion

export type PlayerEventTypes =
  | 'frameupdate'
  | 'play'
  | 'pause'
  | 'ended'
  | 'seeked'
  | 'ratechange'
  | 'volumechange'
  | 'fullscreenchange'
  | 'scalechange'
  | 'waiting'
  | 'resume'
  | 'error';

/** Matches @remotion/player's CallbackListener — the event carries its payload on `detail`. */
export type CallbackListener<T = undefined> = (event: { detail: T }) => void;

export interface PlayerRef {
  seekTo: (frame: number) => void;
  getCurrentFrame: () => number;
  play: (e?: unknown) => void;
  pause: () => void;
  pauseAndReturnToPlayStart: () => void;
  toggle: (e?: unknown) => void;
  isPlaying: () => boolean;
  getContainerNode: () => HTMLDivElement | null;
  getScale: () => number;
  mute: () => void;
  unmute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  requestFullscreen: () => void;
  exitFullscreen: () => void;
  isFullscreen: () => boolean;
  addEventListener: <T = undefined>(name: PlayerEventTypes, callback: CallbackListener<T>) => void;
  removeEventListener: <T = undefined>(name: PlayerEventTypes, callback: CallbackListener<T>) => void;
}

export interface PlayerProps {
  /** the composition component (Remotion's `component`; `composition` is the remover alias). */
  component?: ComponentType<Record<string, unknown>>;
  composition?: ComponentType<Record<string, unknown>>;
  compositionWidth?: number;
  compositionHeight?: number;
  /** remover aliases for compositionWidth/Height. */
  width?: number;
  height?: number;
  fps: number;
  durationInFrames: number;
  inputProps?: Record<string, unknown>;
  controls?: boolean;
  loop?: boolean;
  playbackRate?: number;
  initialFrame?: number;
  moveToBeginningWhenEnded?: boolean;
  /** display height in px; the composition is scaled to fit (remover-specific). */
  displayHeight?: number;
  style?: CSSProperties;
  // Accepted for @remotion/player API compatibility; not all affect remover's preview.
  clickToPlay?: boolean;
  doubleClickToFullscreen?: boolean;
  showVolumeControls?: boolean;
  allowFullscreen?: boolean;
  alwaysShowControls?: boolean;
  overflowVisible?: boolean;
  numberOfSharedAudioTags?: number;
  acknowledgeRemotionLicense?: boolean;
}

const clampFrame = (f: number, durationInFrames: number): number => Math.max(0, Math.min(durationInFrames - 1, Math.round(f)));

export const Player = forwardRef<PlayerRef, PlayerProps>(function Player(props, ref): JSX.Element {
  const {
    component,
    composition,
    compositionWidth,
    compositionHeight,
    width,
    height,
    fps,
    durationInFrames,
    inputProps = {},
    controls = true,
    loop = true,
    playbackRate = 1,
    initialFrame = 0,
    moveToBeginningWhenEnded = false,
    displayHeight = 600,
    clickToPlay = true,
    style,
  } = props;

  const Composition = (component ?? composition)!;
  const compWidth = compositionWidth ?? width ?? 1920;
  const compHeight = compositionHeight ?? height ?? 1080;
  const config: VideoConfig = { width: compWidth, height: compHeight, fps, durationInFrames };

  const [frame, setFrameState] = useState(initialFrame);
  const [playing, setPlayingState] = useState(false);
  const frameRef = useRef(initialFrame);
  const playingRef = useRef(false);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  const rafRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listeners = useRef(new Map<PlayerEventTypes, Set<CallbackListener<unknown>>>());

  const scale = displayHeight / compHeight;
  const displayWidth = compWidth * scale;

  const emit = useCallback(<T,>(name: PlayerEventTypes, detail: T): void => {
    for (const cb of listeners.current.get(name) ?? []) (cb as CallbackListener<T>)({ detail });
  }, []);

  const commitFrame = useCallback(
    (f: number, seeked = false): void => {
      const clamped = clampFrame(f, durationInFrames);
      frameRef.current = clamped;
      setFrameState(clamped);
      emit('frameupdate', { frame: clamped });
      if (seeked) emit('seeked', { frame: clamped });
    },
    [durationInFrames, emit],
  );

  const setPlaying = useCallback(
    (value: boolean): void => {
      if (playingRef.current === value) return;
      playingRef.current = value;
      setPlayingState(value);
      emit(value ? 'play' : 'pause', undefined);
    },
    [emit],
  );

  // The rAF clock: advance the frame at fps·playbackRate while playing; loop or fire `ended`.
  useEffect(() => {
    if (!playing) return;
    let anchor = { t: performance.now(), f: frameRef.current >= durationInFrames - 1 ? 0 : frameRef.current };
    const tick = (): void => {
      const elapsed = (performance.now() - anchor.t) / 1000;
      let f = anchor.f + Math.floor(elapsed * fps * playbackRate);
      if (f >= durationInFrames) {
        if (loop) {
          f = 0;
          anchor = { t: performance.now(), f: 0 };
        } else {
          commitFrame(durationInFrames - 1);
          setPlaying(false);
          emit('ended', undefined);
          if (moveToBeginningWhenEnded) commitFrame(0);
          return;
        }
      }
      commitFrame(f);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, fps, durationInFrames, playbackRate, loop, moveToBeginningWhenEnded, commitFrame, setPlaying, emit]);

  useImperativeHandle(
    ref,
    (): PlayerRef => ({
      seekTo: (f) => {
        setPlaying(false);
        commitFrame(f, true);
      },
      getCurrentFrame: () => frameRef.current,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      pauseAndReturnToPlayStart: () => {
        setPlaying(false);
        commitFrame(0, true);
      },
      toggle: () => setPlaying(!playingRef.current),
      isPlaying: () => playingRef.current,
      getContainerNode: () => containerRef.current,
      getScale: () => scale,
      mute: () => {
        mutedRef.current = true;
        emit('volumechange', undefined);
      },
      unmute: () => {
        mutedRef.current = false;
        emit('volumechange', undefined);
      },
      isMuted: () => mutedRef.current,
      setVolume: (v) => {
        volumeRef.current = Math.max(0, Math.min(1, v));
        emit('volumechange', undefined);
      },
      getVolume: () => volumeRef.current,
      requestFullscreen: () => void containerRef.current?.requestFullscreen?.(),
      exitFullscreen: () => void document.exitFullscreen?.(),
      isFullscreen: () => typeof document !== 'undefined' && document.fullscreenElement === containerRef.current,
      addEventListener: (name, cb) => {
        if (!listeners.current.has(name)) listeners.current.set(name, new Set());
        listeners.current.get(name)!.add(cb as CallbackListener<unknown>);
      },
      removeEventListener: (name, cb) => {
        listeners.current.get(name)?.delete(cb as CallbackListener<unknown>);
      },
    }),
    [scale, commitFrame, setPlaying, emit],
  );

  return (
    <div style={{ width: displayWidth, ...style }}>
      <div
        ref={containerRef}
        onClick={clickToPlay ? () => setPlaying(!playingRef.current) : undefined}
        style={{
          width: displayWidth,
          height: displayHeight,
          overflow: 'hidden',
          background: '#000',
          borderRadius: 12,
          position: 'relative',
          cursor: clickToPlay ? 'pointer' : 'default',
        }}
      >
        <div
          style={{
            width: compWidth,
            height: compHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            // Promote the composition to its own GPU layer so it's rasterized at native
            // resolution and scaled continuously — without this the down-scale re-rasterizes
            // every frame and quantizes motion (esp. the <Video>) to device pixels: visible shake.
            willChange: 'transform',
          }}
        >
          <ConfigContext.Provider value={config}>
            <PlayingContext.Provider value={playing}>
              <TimelineContext.Provider value={frame}>
                <FrameContext.Provider value={frame}>
                  <Composition {...inputProps} />
                </FrameContext.Provider>
              </TimelineContext.Provider>
            </PlayingContext.Provider>
          </ConfigContext.Provider>
        </div>
      </div>

      {controls && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, color: '#e9e9ee', font: '13px ui-monospace, monospace' }}
        >
          <button
            type="button"
            onClick={() => setPlaying(!playingRef.current)}
            style={{
              width: 38,
              height: 38,
              flex: 'none',
              borderRadius: '50%',
              border: '1px solid #2a2a30',
              background: '#141417',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {playing ? '❙❙' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={durationInFrames - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              commitFrame(Number(e.target.value), true);
            }}
            style={{ flex: 1 }}
          />
          <span style={{ color: '#8a8a93', minWidth: 90, textAlign: 'right' }}>
            {(frame / fps).toFixed(1)}s / {((durationInFrames - 1) / fps).toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
});
