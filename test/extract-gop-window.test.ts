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

/** Serves a file over ranged reads and records every request. A request with no Range header is
 *  recorded as `whole`, which is how the preload path shows up. */
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

// Ranges of one URL serialize at the origin, so past a handful of GOPs it is cheaper to pull the
// file than to ask for windows of it. Needs a source with enough GOPs to cross the threshold,
// which the two small fixtures do not have — the committed demo rendition does.
const MANY_GOPS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'sintel-480p.mp4');

test('enough scattered GOPs and the file is pulled once instead of windowed', async () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(MANY_GOPS)));
  assert.ok(table.keySampleIndices.length >= 8, 'demo rendition should have plenty of GOPs');

  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const requests: { start: number; end: number; whole?: boolean }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch(requests, MANY_GOPS) });
    const setupReads = requests.length;
    const duration = table.presentationTicks.reduce((max, t) => Math.max(max, t), 0) / table.timescale;
    const wanted = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * duration);

    const delivered: number[] = [];
    await extractor.extract(wanted, (_frame, requestedSeconds) => delivered.push(requestedSeconds));

    const afterSetup = requests.slice(setupReads);
    assert.equal(afterSetup.length, 1, 'one request, not one per GOP');
    assert.equal(afterSetup[0]!.whole, true, 'and it is the whole file, not a range');
    assert.equal(delivered.length, wanted.length, 'every timestamp still delivered');
    extractor.dispose();
  } finally {
    restore();
  }
});

test('a couple of GOPs still uses ranges rather than pulling the file', async () => {
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const requests: { start: number; end: number; whole?: boolean }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch(requests) });
    const setupReads = requests.length;
    await extractor.extract([0, 0.1], () => {});
    assert.ok(
      requests.slice(setupReads).every((r) => !r.whole),
      'below the threshold it should stay on ranges',
    );
    extractor.dispose();
  } finally {
    restore();
  }
});

// The preloaded file must not outlive the calls that wanted it. An extractor is typically kept
// alive for as long as its source is on screen — a timeline holds one per clip — so retaining a
// whole rendition each would be megabytes per clip for the rest of the session.
test('the whole-file buffer is dropped once the extract that needed it finishes', async () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(MANY_GOPS)));
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const requests: { start: number; end: number; whole?: boolean }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: SRC, fetchFn: rangeRecordingFetch(requests, MANY_GOPS) });
    const duration = table.presentationTicks.reduce((max, t) => Math.max(max, t), 0) / table.timescale;
    const spread = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * duration);

    await extractor.extract(spread, () => {});
    const firstWholeReads = requests.filter((r) => r.whole).length;
    assert.equal(firstWholeReads, 1, 'first call pulls the file');

    // A second spread call has to fetch again: nothing is retained between calls.
    await extractor.extract(spread, () => {});
    assert.equal(requests.filter((r) => r.whole).length, 2, 'buffer was not held across calls');

    // And a single seek afterwards is a small range, not served from a lingering whole-file buffer.
    const before = requests.length;
    await extractor.extract([spread[0]!], () => {});
    const after = requests.slice(before);
    assert.ok(after.length > 0 && after.every((r) => !r.whole), 'a lone seek should use a range, and must still hit the network at all');
    extractor.dispose();
  } finally {
    restore();
  }
});
