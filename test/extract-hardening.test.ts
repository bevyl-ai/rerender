// Regressions for an adversarial review of the 1.0 candidate. Every test here failed before the
// commit that added it, and the existing suite was green throughout — which is the point.
//
// The decoder stub matters. WebCodecs delivers `output` from a queued task, not synchronously
// inside flush(); the older stubs in this repo call it inside flush(), and that difference is what
// hid the deadlock and the abort hole. This one defers.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { must } from '../src/core/must';
import { decodeRun } from '../src/extract/decode';
import { createFrameExtractor } from '../src/extract/extractor';

const fixture = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);
const FRAGMENTED = fixture('extract-fragmented.mp4');
const PROGRESSIVE = fixture('extract-faststart.mp4');

interface StubFrame {
  timestamp: number;
  close(): void;
  clone(): StubFrame;
}

function installDeferredDecoder(): { restore: () => void; open: () => number } {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = { decoder: scope.VideoDecoder, chunk: scope.EncodedVideoChunk };
  let opened = 0;
  let closed = 0;

  scope.EncodedVideoChunk = class {
    timestamp: number;
    type: string;
    constructor(init: { timestamp: number; type: string }) {
      this.timestamp = init.timestamp;
      this.type = init.type;
    }
  };
  scope.VideoDecoder = class {
    #output: (frame: StubFrame) => void;
    #queued: number[] = [];
    constructor(init: { output: (frame: StubFrame) => void }) {
      this.#output = init.output;
    }
    configure(): void {}
    decode(chunk: { timestamp: number }): void {
      this.#queued.push(chunk.timestamp);
    }
    async flush(): Promise<void> {
      const queued = this.#queued;
      this.#queued = [];
      await Promise.resolve(); // the queued task WebCodecs would use
      for (const timestamp of queued) {
        const make = (): StubFrame => {
          opened += 1;
          let shut = false;
          return {
            timestamp,
            close() {
              if (!shut) {
                shut = true;
                closed += 1;
              }
            },
            clone: make,
          };
        };
        this.#output(make());
      }
    }
    close(): void {}
  };
  return {
    restore: () => {
      scope.VideoDecoder = previous.decoder;
      scope.EncodedVideoChunk = previous.chunk;
    },
    open: () => opened - closed,
  };
}

/** Serves a local file, honouring both ordinary and suffix ranges. */
function fetchFor(path: string, reads: { start: number; end: number }[] = []) {
  const file = new Uint8Array(readFileSync(path));
  return ((_input: unknown, init?: { headers?: Record<string, string> }) => {
    const header = init?.headers?.Range ?? '';
    const suffix = /^bytes=-(\d+)$/.exec(header);
    const [start, end] = suffix
      ? [file.byteLength - Number(suffix[1]), file.byteLength]
      : (() => {
          const match = must(/bytes=(\d+)-(\d+)/.exec(header));
          return [Number(match[1]), Math.min(Number(match[2]) + 1, file.byteLength)];
        })();
    if (!suffix) reads.push({ start, end });
    const slice = file.subarray(start, end);
    return Promise.resolve({
      status: 206,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-range' ? `bytes ${start}-${end - 1}/${file.byteLength}` : null) },
      arrayBuffer: async () => slice.slice().buffer,
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

// Fragments abut exactly, so the gap between them is always 0 and they ALWAYS coalesce. Handing
// every job the whole merged buffer made each one find the first moof in it and decode that
// fragment instead of its own — silently, with the right requested timestamps coming back.
test('frames from a coalesced read match frames fetched one at a time', async () => {
  const decoder = installDeferredDecoder();
  try {
    const extractor = await createFrameExtractor({ src: 'https://fixture.test/f.mp4', fetchFn: fetchFor(FRAGMENTED) });
    const wanted = [0.1, 3.1];

    const reads: { start: number; end: number }[] = [];
    const merged = await createFrameExtractor({ src: 'https://fixture.test/f.mp4', fetchFn: fetchFor(FRAGMENTED, reads) });
    const afterSetup = reads.length; // the moov probe and the last-fragment duration read
    const together: number[] = [];
    await merged.extract(wanted, (frame) => together.push((frame as unknown as StubFrame).timestamp));
    assert.equal(reads.length - afterSetup, 1, 'the two fragments really did coalesce into one read');

    const apart: number[] = [];
    for (const seconds of wanted) await extractor.extract([seconds], (frame) => apart.push((frame as unknown as StubFrame).timestamp));

    assert.deepEqual(
      together.sort((a, b) => a - b),
      apart.sort((a, b) => a - b),
      'coalescing must not change which frames come back',
    );
    extractor.dispose();
    merged.dispose();
  } finally {
    decoder.restore();
  }
});

// mehd is absent from ffmpeg's fragmented output, and stopping at the last sync sample put
// everything after it out of reach — half the file on a two-fragment one.
test('the tail of a fragmented file is reachable', async () => {
  const decoder = installDeferredDecoder();
  try {
    const fragmented = await createFrameExtractor({ src: 'https://fixture.test/f.mp4', fetchFn: fetchFor(FRAGMENTED) });
    const progressive = await createFrameExtractor({ src: 'https://fixture.test/p.mp4', fetchFn: fetchFor(PROGRESSIVE) });

    const late = [3.9, 5.5];
    const fromFragmented: number[] = [];
    const fromProgressive: number[] = [];
    await fragmented.extract(late, (frame) => fromFragmented.push((frame as unknown as StubFrame).timestamp));
    await progressive.extract(late, (frame) => fromProgressive.push((frame as unknown as StubFrame).timestamp));

    assert.deepEqual(
      fromFragmented.sort((a, b) => a - b),
      fromProgressive.sort((a, b) => a - b),
      'same media, same frames',
    );
    assert.ok(fragmented.durationSeconds > 5.9, `durationSeconds ${fragmented.durationSeconds} should cover the whole file`);
    fragmented.dispose();
    progressive.dispose();
  } finally {
    decoder.restore();
  }
});

// onFrame belongs to the caller. Unguarded, a throw escaped into the WebCodecs output task, which
// neither rejects flush() nor settles the run — extract() stayed pending forever.
test('a throwing onFrame rejects instead of hanging, and leaks nothing', async () => {
  const decoder = installDeferredDecoder();
  try {
    const run = decodeRun(
      { codec: 'avc1.4d400b' },
      [{ presentationMicros: 0, byteOffset: 0, byteSize: 1 }],
      new Uint8Array(8),
      0,
      new Map([[0, [0, 0.5]]]), // two requesters, so a clone is in flight too
      () => {
        throw new Error('caller blew up');
      },
      new AbortController().signal,
    );
    const outcome = await Promise.race([
      run.then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      new Promise((resolve) => setTimeout(() => resolve('PENDING'), 500)),
    ]);
    assert.equal(outcome, 'caller blew up', "the caller's error should surface, not a timeout");
    assert.equal(decoder.open(), 0, 'every frame handed out was closed');
  } finally {
    decoder.restore();
  }
});

// Abort events are not replayed, and decodeRun is reached through microtasks after an early
// resolve, so a signal that fired in that window was simply never seen.
test('decodeRun refuses a signal that aborted before it was called', async () => {
  const decoder = installDeferredDecoder();
  try {
    const controller = new AbortController();
    controller.abort(new Error('too late'));
    await assert.rejects(
      () =>
        decodeRun(
          { codec: 'avc1.4d400b' },
          [{ presentationMicros: 0, byteOffset: 0, byteSize: 1 }],
          new Uint8Array(8),
          0,
          new Map([[0, [0]]]),
          () => {},
          controller.signal,
        ),
      /too late/,
    );
  } finally {
    decoder.restore();
  }
});

// Math.min(0 | NaN, n) fed Array.from a length it treats as zero, so extract() resolved having
// fetched nothing — a blank filmstrip and no error, from Number(env.X) being NaN.
test('a nonsense maxParallelFetches still extracts', async () => {
  const decoder = installDeferredDecoder();
  try {
    for (const maxParallelFetches of [0, -1, Number.NaN, 0.5]) {
      const extractor = await createFrameExtractor({
        src: 'https://fixture.test/p.mp4',
        fetchFn: fetchFor(PROGRESSIVE),
        maxParallelFetches,
      });
      const delivered: number[] = [];
      await extractor.extract([0, 1], (_frame, seconds) => delivered.push(seconds));
      assert.equal(delivered.length, 2, `maxParallelFetches=${maxParallelFetches} delivered nothing`);
      extractor.dispose();
    }
  } finally {
    decoder.restore();
  }
});

// A worker that fails cannot cancel its siblings by itself; they drained the queue and kept
// pushing frames at a caller that had already seen the rejection.
test('one failed read stops the rest of the call', async () => {
  const decoder = installDeferredDecoder();
  try {
    const file = new Uint8Array(readFileSync(PROGRESSIVE));
    let bodyReads = 0;
    const fetchFn = ((_input: unknown, init?: { headers?: Record<string, string> }) => {
      const match = must(/bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? ''));
      const [start, end] = [Number(match[1]), Math.min(Number(match[2]) + 1, file.byteLength)];
      if (start > 1000) {
        bodyReads += 1;
        return Promise.resolve({
          status: 503,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 206,
        headers: { get: () => null },
        arrayBuffer: async () => file.subarray(start, end).slice().buffer,
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const extractor = await createFrameExtractor({ src: 'https://fixture.test/p.mp4', fetchFn, maxParallelFetches: 2 });
    let frames = 0;
    await assert.rejects(() => extractor.extract([0, 1, 2, 3, 4, 5], () => frames++), /range request failed/);
    const atRejection = { frames, bodyReads };
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual({ frames, bodyReads }, atRejection, 'no read or frame may land after the caller saw the rejection');
    extractor.dispose();
  } finally {
    decoder.restore();
  }
});
