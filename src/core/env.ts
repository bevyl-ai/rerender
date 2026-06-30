// getInputProps / getRemotionEnvironment — Remotion-compatible. Input props are
// injected by the host (Player inputProps or the render page); the environment
// reflects whether we're playing or rendering.
declare global {
  interface Window {
    __rerenderInputProps?: Record<string, unknown>;
    __rerenderEnv?: 'player' | 'rendering';
  }
}

export function getInputProps<T = Record<string, unknown>>(): T {
  if (typeof window !== 'undefined' && window.__rerenderInputProps) {
    return window.__rerenderInputProps as T;
  }
  return {} as T;
}

export interface RemotionEnvironment {
  isStudio: boolean;
  isRendering: boolean;
  isPlayer: boolean;
  isReadOnlyStudio: boolean;
  isClientSideRendering: boolean;
}

export function getRemotionEnvironment(): RemotionEnvironment {
  const rendering = typeof window !== 'undefined' && window.__rerenderEnv === 'rendering';
  return {
    isStudio: false,
    isRendering: rendering,
    isPlayer: !rendering,
    isReadOnlyStudio: false,
    isClientSideRendering: false,
  };
}
