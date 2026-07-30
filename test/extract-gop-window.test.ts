// How much of a GOP does one requested frame actually cost?
//
// Samples are fed to the decoder in decode order, and every reference precedes its dependents
// there, so a request only needs the run from the GOP's keyframe up to the wanted sample. Reading
// or decoding past it is waste — and on a filmstrip, where thumbnails land at arbitrary points in
// one-second GOPs, it is most of the work.
//
// The decode path never runs in CI otherwise: Node has no WebCodecs, so the existing extract tests
// exercise the sample table and the abort wiring and stop at the decoder. These stub VideoDecoder
// and EncodedVideoChunk so the fed-sample window and the requested byte range are both assertable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFrameExtractor } from '../src/extract/extractor';
import { parseSampleTable } from '../src/extract/mp4-sample-table';

const FIXTURE = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'extract-faststart.mp4');
const SRC = 'https://fixture.test/faststart.mp4';

interface Fed {
  timestamps: number[];
}

/** Records what gets fed, then emits a frame per chunk on flush — enough for the extractor's
 *  presentation-timestamp matching to resolve, without a real codec. */
function installFakeDecoder(fed: Fed): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = { decoder: scope.VideoDecoder, chunk: scope.EncodedVideoChunk };

  scope.EncodedVideoChunk = class {
    timestamp: number;
    type: string;
    constructor(init: { timestamp: number; type: string }) {
      this.timestamp = init.timestamp;
      this.type = init.type;
    }
  };

  scope.VideoDecoder = class {
    #output: (frame: { timestamp: number; close(): void; clone(): unknown }) => void;
    #queued: number[] = [];
    constructor(init: { output: (frame: { timestamp: number; close(): void; clone(): unknown }) => void }) {
      this.#output = init.output;
    }
    configure(): void {}
    decode(chunk: { timestamp: number }): void {
      fed.timestamps.push(chunk.timestamp);
      this.#queued.push(chunk.timestamp);
    }
    async flush(): Promise<void> {
      for (const timestamp of this.#queued) {
        const frame = { timestamp, close: () => {}, clone: () => frame };
        this.#output(frame);
      }
      this.#queued = [];
    }
    close(): void {}
  };

  return () => {
    scope.VideoDecoder = previous.decoder;
    scope.EncodedVideoChunk = previous.chunk;
  };
}

/** Serves a file over ranged reads and records every range asked for. */
function rangeRecordingFetch(ranges: { start: number; end: number; whole?: boolean }[], path = FIXTURE) {
  const bytes = readFileSync(path);
  return ((_input: unknown, init?: { headers?: Record<string, string> }) => {
    const header = init?.headers?.Range;
    if (!header) {
      ranges.push({ start: 0, end: bytes.byteLength, whole: true });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      } as unknown as Response);
    }
    const match = /bytes=(\d+)-(\d+)/.exec(header);
    const start = Number(match![1]);
    const end = Math.min(Number(match![2]) + 1, bytes.byteLength);
    ranges.push({ start, end });
    const slice = bytes.subarray(start, end);
    return Promise.resolve({
      status: 206,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-range' ? `bytes ${start}-${end - 1}/${bytes.byteLength}` : null) },
      arrayBuffer: async () => slice.slice().buffer,
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

const table = parseSampleTable(new Uint8Array(readFileSync(FIXTURE)));
const gopStart = table.keySampleIndices[0]!;
const gopEnd = table.keySampleIndices[1] ?? table.sampleCount;

test('a frame at the head of a GOP does not read or decode the whole GOP', async () => {
  assert.ok(gopEnd - gopStart > 2, 'fixture GOP is too short for this to mean anything');

  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const ranges: { start: number; end: number }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch(ranges) });
    const setupReads = ranges.length;
    const firstFrameSeconds = table.presentationTicks[gopStart]! / table.timescale;
    await extractor.extract([firstFrameSeconds], () => {});

    assert.equal(fed.timestamps.length, 1, 'only the keyframe is needed for the keyframe');
    const gopRead = ranges[setupReads]!;
    const wholeGopEnd = table.byteOffsets[gopEnd - 1]! + table.byteSizes[gopEnd - 1]!;
    assert.ok(gopRead.end < wholeGopEnd, `read ${gopRead.end} should stop short of the GOP end ${wholeGopEnd}`);
    assert.equal(gopRead.end, table.byteOffsets[gopStart]! + table.byteSizes[gopStart]!);
    extractor.dispose();
  } finally {
    restore();
  }
});

test('a frame deeper in the GOP pulls exactly the run up to it', async () => {
  const target = Math.min(gopStart + 3, gopEnd - 1);
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const ranges: { start: number; end: number }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch(ranges) });
    const setupReads = ranges.length;
    await extractor.extract([table.presentationTicks[target]! / table.timescale], () => {});

    assert.equal(fed.timestamps.length, target - gopStart + 1, 'feeds the keyframe through the wanted sample and no further');
    assert.equal(ranges[setupReads]!.end, table.byteOffsets[target]! + table.byteSizes[target]!);
    extractor.dispose();
  } finally {
    restore();
  }
});

test('every requested timestamp is still delivered exactly once', async () => {
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch([]) });
    const wanted = [0, 0.05, 0.1, 0.2, 0.05];
    const delivered: number[] = [];
    await extractor.extract(wanted, (_frame, requestedSeconds) => delivered.push(requestedSeconds));
    assert.deepEqual(
      delivered.slice().sort((a, b) => a - b),
      wanted.slice().sort((a, b) => a - b),
    );
    extractor.dispose();
  } finally {
    restore();
  }
});
