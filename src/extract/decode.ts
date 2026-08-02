// Decoding one run of samples, shared by both index shapes.
//
// A progressive mp4 knows every sample's offset and size before it reads a byte, because the moov
// indexes the whole file. A fragmented one does not: its index is per-fragment and only readable
// once the fragment is in hand. What both agree on is what a decoder needs — a keyframe, the
// samples after it in decode order, and which presentation timestamps somebody is waiting for — so
// that is the seam.

import type { OnFrame } from './extractor';

export interface RunSample {
  /** Presentation timestamp in microseconds, which is what the decoder reports back. */
  presentationMicros: number;
  /** Absolute file byte offset. */
  byteOffset: number;
  byteSize: number;
}

/**
 * Feeds `samples` (decode order, `[0]` being the keyframe) to a decoder and resolves once every
 * timestamp in `wanted` has been handed to `onFrame`.
 *
 * `wanted` maps presentation µs to the requested times waiting on that frame: one decoded frame can
 * satisfy several requests, and each requester gets its own reference to close.
 */
export async function decodeRun(
  config: VideoDecoderConfig,
  samples: readonly RunSample[],
  bytes: Uint8Array,
  bytesStart: number,
  wanted: Map<number, number[]>,
  onFrame: OnFrame,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const decoder = new VideoDecoder({
      output: (frame) => {
        const requesters = wanted.get(frame.timestamp);
        if (!requesters) {
          frame.close();
          return;
        }
        wanted.delete(frame.timestamp);
        for (let i = 0; i < requesters.length; i++) {
          // Last requester gets the frame itself; earlier ones get clones. Receiver closes all.
          onFrame(i === requesters.length - 1 ? frame : frame.clone(), requesters[i]!);
        }
        // Early resolve keeps GOP pipelining: the worker moves on while the
        // flush drains. The abort listener stays armed until the flush-side
        // close — the decoder can outlive this promise.
        if (wanted.size === 0) resolve();
      },
      error: reject,
    });
    const closeDecoder = () => {
      try {
        decoder.close();
      } catch {
        // already closed
      }
    };
    const onAbort = () => {
      // Close eagerly: a wedged decode never settles flush(), so waiting for
      // the flush-side close would leak the hardware decoder past the abort.
      closeDecoder();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const detach = () => signal.removeEventListener('abort', onAbort);
    try {
      decoder.configure(config);
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i]!;
        decoder.decode(
          new EncodedVideoChunk({
            type: i === 0 ? 'key' : 'delta',
            timestamp: sample.presentationMicros,
            data: bytes.subarray(sample.byteOffset - bytesStart, sample.byteOffset - bytesStart + sample.byteSize),
          }),
        );
      }
    } catch (error) {
      detach();
      closeDecoder();
      throw error;
    }
    // The decoder-lifecycle finally owns both the close and the listener
    // removal, so an abort can reach a still-open decoder even after the
    // early resolve above. Aborting closes the decoder, which settles a
    // pending flush, which runs this cleanup.
    decoder
      .flush()
      .then(() => {
        if (wanted.size > 0) reject(new Error(`decoder flushed with ${wanted.size} requested timestamps undelivered`));
      }, reject)
      .finally(() => {
        closeDecoder();
        detach();
      });
  });
}
