// Fragmented mp4, against files ffmpeg actually produced.
//
// The fixtures are the same 120-sample clip as extract-faststart.mp4, remuxed into moof/mdat
// fragments — so the fragmented reader's answers can be checked against the progressive reader's
// answers about identical media, which is a stronger statement than "it parsed without throwing".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFrameExtractor } from '../src/extract/extractor';
import { parseFragment, readFragmentIndex } from '../src/extract/fmp4';
import { parseSampleTable, parseTrackConfig } from '../src/extract/mp4-sample-table';
import type { RangeSource } from '../src/extract/source';

const fixture = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);
const FRAGMENTED = fixture('extract-fragmented.mp4');
const NO_MFRA = fixture('extract-fragmented-nomfra.mp4');
const PROGRESSIVE = fixture('extract-faststart.mp4');

/** Serves a local file over the RangeSource contract, recording every read. */
function localSource(path: string, reads: { start: number; end: number }[] = []): RangeSource {
  const file = new Uint8Array(readFileSync(path));
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return {
    read: async (start, end) => {
      reads.push({ start, end });
      return file.subarray(start, end);
    },
    readThroughMoov: async () => {
      let at = 0;
      for (;;) {
        const size = view.getUint32(at);
        const type = String.fromCharCode(file[at + 4]!, file[at + 5]!, file[at + 6]!, file[at + 7]!);
        if (type === 'moov') return file.subarray(0, at + size);
        at += size;
      }
    },
    readSuffix: async (length) => ({ bytes: file.subarray(file.byteLength - length), start: file.byteLength - length }),
  };
}

test('a fragmented moov is recognised as one, and a progressive one is not', () => {
  assert.equal(parseTrackConfig(new Uint8Array(readFileSync(FRAGMENTED))).fragmented, true);
  assert.equal(parseTrackConfig(new Uint8Array(readFileSync(PROGRESSIVE))).fragmented, false);
});

test('the index comes out of mfra, not by walking the file', async () => {
  const reads: { start: number; end: number }[] = [];
  const source = localSource(FRAGMENTED, reads);
  const moov = await source.readThroughMoov();
  const index = await readFragmentIndex(source, moov, parseTrackConfig(moov));

  const progressive = parseSampleTable(new Uint8Array(readFileSync(PROGRESSIVE)));
  assert.equal(index.keyframeTicks.length, progressive.keySampleIndices.length, 'one fragment per GOP of the same media');
  assert.equal(index.moofOffsets.length, index.keyframeTicks.length);
  assert.ok(index.mediaEnd > index.moofOffsets[index.moofOffsets.length - 1]!, 'the last fragment ends before mfra');
  // The index itself costs no body reads — two suffix reads for mfro and mfra, and that is the
  // point. The one body read setup does make is the last fragment, and only because this file
  // states no mehd, so its true end time is knowable nowhere else.
  assert.ok(reads.length <= 1, `index setup should not walk the file, made ${reads.length} body reads`);
  if (reads.length === 1) {
    assert.equal(reads[0]!.start, index.moofOffsets[index.moofOffsets.length - 1], 'the only body read is the last fragment');
  }
});

// ffmpeg's fragmented remux drops the edit list the progressive file carries, so the two declare
// timeline origins 1024 ticks apart for identical media. Following what each file says is the
// correct behaviour — an edit list is the file telling you where its timeline starts — so what is
// compared here is sizes and the *spacing* of the timestamps, not their absolute values.
test('a fragment yields the same samples the progressive file states', async () => {
  const source = localSource(FRAGMENTED);
  const moov = await source.readThroughMoov();
  const config = parseTrackConfig(moov);
  const index = await readFragmentIndex(source, moov, config);
  const file = new Uint8Array(readFileSync(FRAGMENTED));

  const progressive = parseSampleTable(new Uint8Array(readFileSync(PROGRESSIVE)));
  for (let gop = 0; gop < index.keyframeTicks.length; gop++) {
    const start = index.moofOffsets[gop]!;
    const end = index.moofOffsets[gop + 1] ?? index.mediaEnd;
    const samples = parseFragment(file.subarray(start, end), start, index.defaults, config.editShiftTicks);

    const first = progressive.keySampleIndices[gop]!;
    const last = progressive.keySampleIndices[gop + 1] ?? progressive.sampleCount;
    assert.equal(samples.length, last - first, `fragment ${gop} sample count`);
    for (let i = 0; i < samples.length; i++) {
      assert.equal(samples[i]!.byteSize, progressive.byteSizes[first + i], `fragment ${gop} sample ${i} size`);
      const fragmentOffset = samples[i]!.presentationTicks - samples[0]!.presentationTicks;
      const progressiveOffset = progressive.presentationTicks[first + i]! - progressive.presentationTicks[first]!;
      assert.equal(fragmentOffset, progressiveOffset, `fragment ${gop} sample ${i} pts spacing`);
    }
  }
});

test('a file with no mfra is refused, and says why', async () => {
  const source = localSource(NO_MFRA);
  const moov = await source.readThroughMoov();
  await assert.rejects(() => readFragmentIndex(source, moov, parseTrackConfig(moov)), /no mfra index/);
});

// ── the extractor over the fragmented adapter, with a stubbed decoder ──

interface Fed {
  timestamps: number[];
}

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

/** Turns a local file into the fetch the extractor expects, honouring suffix ranges. */
function fetchFor(path: string, reads: { start: number; end: number; suffix?: boolean }[]) {
  const file = new Uint8Array(readFileSync(path));
  return ((_input: unknown, init?: { headers?: Record<string, string> }) => {
    const header = init?.headers?.Range ?? '';
    const suffix = /^bytes=-(\d+)$/.exec(header);
    const [start, end] = suffix
      ? [file.byteLength - Number(suffix[1]), file.byteLength]
      : (() => {
          const m = /bytes=(\d+)-(\d+)/.exec(header)!;
          return [Number(m[1]), Math.min(Number(m[2]) + 1, file.byteLength)];
        })();
    reads.push({ start, end, ...(suffix ? { suffix: true } : {}) });
    const slice = file.subarray(start, end);
    return Promise.resolve({
      status: 206,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-range' ? `bytes ${start}-${end - 1}/${file.byteLength}` : null) },
      arrayBuffer: async () => slice.slice().buffer,
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

test('the extractor reads a fragmented file through the same public contract', async () => {
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const reads: { start: number; end: number; suffix?: boolean }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: 'https://fixture.test/frag.mp4', fetchFn: fetchFor(FRAGMENTED, reads) });
    assert.equal(extractor.sampleTable.codec, 'avc1.4d400b', 'codec came from the moov, as for any file');

    const wanted = [0, 0.5, 1.2];
    const delivered: number[] = [];
    await extractor.extract(wanted, (_frame, seconds) => delivered.push(seconds));
    assert.deepEqual(
      delivered.slice().sort((a, b) => a - b),
      wanted.slice().sort((a, b) => a - b),
      'every requested timestamp arrived exactly once',
    );
    extractor.dispose();
  } finally {
    restore();
  }
});

test('setup costs two suffix reads, and a seek costs one range read', async () => {
  const fed: Fed = { timestamps: [] };
  const restore = installFakeDecoder(fed);
  const reads: { start: number; end: number; suffix?: boolean }[] = [];
  try {
    const extractor = await createFrameExtractor({ src: 'https://fixture.test/frag.mp4', fetchFn: fetchFor(FRAGMENTED, reads) });
    const suffixReads = reads.filter((read) => read.suffix).length;
    assert.equal(suffixReads, 2, 'mfro, then mfra');

    const before = reads.length;
    await extractor.extract([1.0], () => {});
    const seekReads = reads.slice(before);
    assert.equal(seekReads.length, 1, 'one fragment, one request');
    // and it is a fragment, not the file
    const file = readFileSync(FRAGMENTED);
    assert.ok(seekReads[0]!.end - seekReads[0]!.start < file.byteLength / 2, 'the read is a fragment, not the file');
    extractor.dispose();
  } finally {
    restore();
  }
});
