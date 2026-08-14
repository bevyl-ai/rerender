// Browser-side audio mix + mux. Bundled to an IIFE by esbuild (see src/renderer/audio.ts)
// and served to the mux browser. Each span's source window is decoded via mediabunny's
// AudioBufferSink — the same decode stack the preview plays through, so a file that
// previews with sound exports with sound — and an OfflineAudioContext sums the spans
// (each scheduled at its timeline position through a gain node); mediabunny packet-copies
// the silent video and AAC-encodes the mix into one mp4. window.__mux() returns base64.

import { registerAacEncoder } from '@mediabunny/aac-encoder';
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  getFirstEncodableAudioCodec,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { MuxPosition, VideoCodec } from '../src/renderer/types';
import { toBase64 } from './worker-util';

// Polyfill AAC encoding (a self-contained WASM build of FFmpeg's AAC encoder) so we get AAC
// even where WebCodecs lacks it — notably chrome-headless-shell on AWS Lambda, which has no
// licensed AAC encoder and would otherwise fall back to Opus. Registered once on load.
registerAacEncoder();

declare global {
  interface Window {
    __mux?: (positions: MuxPosition[], fps: number, codec: VideoCodec, sampleRate: number, durationSec: number) => Promise<string>;
    __ready?: boolean | undefined;
  }
}

async function mux(positions: MuxPosition[], fps: number, codec: VideoCodec, sampleRate: number, durationSec: number): Promise<string> {
  // One decoded-audio sink per unique source file, shared by every span that cuts to it.
  // null = no decodable audio track (e.g. a silent video) — its spans add nothing to the mix.
  const sinksBySrc = new Map<number, AudioBufferSink | null>();
  const getAudioSink = async (srcIndex: number): Promise<AudioBufferSink | null> => {
    const cached = sinksBySrc.get(srcIndex);
    if (cached !== undefined) return cached;
    let sink: AudioBufferSink | null = null;
    try {
      const bytes = await (await fetch(`/__asset/${srcIndex}`)).arrayBuffer();
      const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
      const track = await input.getPrimaryAudioTrack();
      if (track && (await track.canDecode())) sink = new AudioBufferSink(track);
    } catch {
      // Unreadable/unparseable asset — same degraded state as a missing audio track.
    }
    sinksBySrc.set(srcIndex, sink);
    return sink;
  };

  // 1. Sum every span's audio into one buffer at its timeline position.
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationSec * sampleRate)), sampleRate);
  for (const p of positions) {
    const sink = await getAudioSink(p.srcIndex);
    if (!sink) continue;

    const gain = ctx.createGain();
    // per-frame volume envelope (fades): schedule each frame's volume at its timeline time.
    const spanStart = p.startInVideo / fps;
    for (let i = 0; i < p.volumes.length; i++) {
      const vol = p.volumes[i];
      if (vol === undefined) continue;
      gain.gain.setValueAtTime(vol, spanStart + i / fps);
    }
    gain.connect(ctx.destination);

    // The span plays `duration` composition-frames; at playbackRate that consumes
    // duration·rate source-frames, so the source window is [trimLeft, trimLeft+duration·rate).
    // Decode only that window, chunk by chunk; clamp each chunk to the window (the first
    // decoded chunk can start before it, the last can run past it).
    const sourceStart = p.trimLeft / fps;
    const sourceEnd = sourceStart + (p.duration * p.playbackRate) / fps;
    for await (const { buffer, timestamp } of sink.buffers(sourceStart, sourceEnd)) {
      const from = Math.max(timestamp, sourceStart);
      const to = Math.min(timestamp + buffer.duration, sourceEnd);
      if (to <= from) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = p.playbackRate;
      node.connect(gain);
      // offset/duration are in source (buffer-content) seconds; `when` is timeline seconds,
      // so the distance into the source window is divided back by playbackRate.
      node.start(spanStart + (from - sourceStart) / p.playbackRate, from - timestamp, to - from);
    }
  }
  const mixed = await ctx.startRendering();

  // 2. Copy the silent video's encoded packets + AAC-encode the mix into one mp4.
  const input = new Input({ formats: [MP4], source: new BufferSource(await (await fetch('/__silent')).arrayBuffer()) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('mux: silent video has no video track');
  const videoSink = new EncodedPacketSink(videoTrack);

  const format = new Mp4OutputFormat();
  const out = new Output({ format, target: new BufferTarget() });
  const videoSource = new EncodedVideoPacketSource(codec);
  out.addVideoTrack(videoSource, { frameRate: fps });
  // Prefer AAC (what mp4 consumers expect); registerAacEncoder() above makes it always
  // encodable, but keep the fallback to any other mp4-compatible+encodable codec for safety.
  const audioBitrate = 128_000;
  const containerCodecs = format.getSupportedAudioCodecs();
  const order = containerCodecs.includes('aac')
    ? (['aac', ...containerCodecs.filter((c) => c !== 'aac')] as typeof containerCodecs)
    : containerCodecs;
  const audioCodec = await getFirstEncodableAudioCodec(order, { numberOfChannels: 2, sampleRate, bitrate: audioBitrate });
  if (!audioCodec) throw new Error('mux: no encodable mp4 audio codec available in this browser');
  const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: audioBitrate });
  out.addAudioTrack(audioSource);
  await out.start();

  const decoderConfig = await videoTrack.getDecoderConfig();
  let first = true;
  for await (const packet of videoSink.packets()) {
    await videoSource.add(packet, first && decoderConfig ? { decoderConfig } : undefined);
    first = false;
  }
  videoSource.close();
  await audioSource.add(mixed);
  audioSource.close();
  await out.finalize();
  const buffer = (out.target as BufferTarget).buffer;
  if (!buffer) throw new Error('mux: muxer produced no output');
  return toBase64(buffer);
}

window.__mux = mux;
window.__ready = true;
