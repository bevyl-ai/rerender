// Render-asset collector — Remotion-compatible (window.remotion_collectAssets). Each
// <Audio>/<Video> registers itself on every render while mounted, carrying its
// absolute timeline frame, volume, and source (media) frame. The renderer drains
// this once per captured frame, then computes each asset's timeline span + trim.
export interface CollectedAsset {
  type: 'audio' | 'video';
  src: string;
  id: string;
  /** absolute composition frame this asset is showing at */
  frame: number;
  volume: number;
  /** source-media frame (currentFrame + startFrom), used as the trim offset */
  mediaFrame: number;
  playbackRate: number;
}

declare global {
  interface Window {
    remotion_collectAssets?: () => CollectedAsset[];
  }
}

let pending: CollectedAsset[] = [];

export function registerRenderAsset(asset: CollectedAsset): void {
  pending.push(asset);
}

function collectAssets(): CollectedAsset[] {
  const out = pending;
  pending = [];
  return out;
}

if (typeof window !== 'undefined') {
  window.remotion_collectAssets = collectAssets;
}
