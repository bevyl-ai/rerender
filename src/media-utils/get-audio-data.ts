import type { AudioData } from './types';

interface GetAudioDataOptions {
  sampleRate?: number;
  requestInit?: RequestInit;
}

// Decoded results, keyed on src. Decoding is expensive and idempotent, so the
// same src never decodes twice.
const cache = new Map<string, AudioData>();

// Bound concurrent decodes; a composition mounting many <Audio> visualizers at
// once otherwise spawns one fetch + AudioContext per source simultaneously.
const MAX_CONCURRENT = 3;
let active = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function decode(src: string, options?: GetAudioDataOptions): Promise<AudioData> {
  const response = await fetch(src, options?.requestInit);
  const buffer = await response.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: options?.sampleRate ?? 48000 });
  try {
    const wave = await ctx.decodeAudioData(buffer);
    if (wave.numberOfChannels === 0) {
      throw new Error(`Audio source "${src}" decoded to zero channels.`);
    }
    const channelWaveforms = Array.from({ length: wave.numberOfChannels }, (_, i) => wave.getChannelData(i));
    return {
      channelWaveforms,
      sampleRate: ctx.sampleRate,
      numberOfChannels: wave.numberOfChannels,
      durationInSeconds: wave.duration,
      resultId: String(Math.random()),
      isRemote: new URL(src, location.href).origin !== location.origin,
    };
  } finally {
    void ctx.close();
  }
}

// getAudioData(src) — Remotion-compatible. Fetch + decode an audio source into
// an AudioData. Cached per src.
export async function getAudioData(src: string, options?: GetAudioDataOptions): Promise<AudioData> {
  const cached = cache.get(src);
  if (cached) return cached;

  await acquire();
  try {
    const data = await decode(src, options);
    cache.set(src, data);
    return data;
  } finally {
    release();
  }
}
