import { useEffect, useRef, useState } from 'react';
import { continueRender, delayRender } from '../core/delay-render';
import { getAudioData } from './get-audio-data';
import type { AudioData } from './types';

interface UseAudioDataOptions {
  sampleRate?: number;
  requestInit?: RequestInit;
}

// useAudioData(src) — Remotion-compatible. Loads and decodes audio, returning null
// until ready. Holds a delayRender handle while loading so the render harness waits
// for the audio before capturing (exactly what real @remotion/media-utils does).
export function useAudioData(src: string, options?: UseAudioDataOptions): AudioData | null {
  const [data, setData] = useState<AudioData | null>(null);
  // Capture requestInit once — a fresh object literal each render must not retrigger.
  const [requestInit] = useState<RequestInit | undefined>(() => options?.requestInit);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = delayRender(`useAudioData(${src})`);
    getAudioData(src, { sampleRate: options?.sampleRate, requestInit })
      .then((loaded) => {
        if (!cancelled && mounted.current) setData(loaded);
      })
      .catch(() => {
        // Leave data null on failure; the consumer renders its empty state.
      })
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
      continueRender(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, options?.sampleRate]);

  return data;
}
