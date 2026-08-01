// The codec registry, and what happens at its edges.
//
// Two of these run against real files produced by ffmpeg rather than synthetic boxes, because a
// codec string derived from a spec I read is worth less than one derived from bytes an encoder
// actually wrote. The rest are synthetic: a fragmented mp4 and a codec nobody supports are easier
// to construct than to obtain.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODECS, describeFailure, handlerFor } from '../src/extract/codecs';
import { parseSampleTable } from '../src/extract/mp4-sample-table';

const fixture = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

test('H.264 still parses exactly as it did', () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(fixture('extract-faststart.mp4'))));
  assert.equal(table.codecId, 'avc');
  assert.equal(table.codec, 'avc1.4d400b');
  assert.equal(table.sampleCount, 120);
});

test('AV1 parses, and its codec string matches the bytes the encoder wrote', () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(fixture('extract-av1.mp4'))));
  assert.equal(table.codecId, 'av1');
  // ffprobe reports this file as profile Main, level 0, yuv420p 8-bit
  assert.equal(table.codec, 'av01.0.00M.08');
  assert.equal(table.sampleCount, 20);
  assert.ok(table.keySampleIndices.length > 0, 'sync samples were found');
  // av1C, not avcC: the description handed to VideoDecoder is this codec's own record
  assert.equal(table.description[0], 0x81, 'av1C marker/version byte');
});

// Derived by hand from each file's configuration record, then checked against what ffprobe reports
// about the same file. The bit-reversed HEVC compatibility field is the one that would fail quietly.
test('HEVC parses, and its codec string matches the bytes x265 wrote', () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(fixture('extract-hevc.mp4'))));
  assert.equal(table.codecId, 'hevc');
  // hvcC: profile_space 0, tier L, profile_idc 1 (Main), compat 0x60000000 reversed = 6, level 30
  assert.equal(table.codec, 'hvc1.1.6.L30.90');
  assert.equal(table.sampleCount, 20);
  assert.equal(table.description[0], 0x01, 'hvcC configurationVersion');
});

test('VP9 parses, and reads past the FullBox header it sits behind', () => {
  const table = parseSampleTable(new Uint8Array(readFileSync(fixture('extract-vp9.mp4'))));
  assert.equal(table.codecId, 'vp9');
  // vpcC is a FullBox: 4 bytes of version/flags, then profile 0, level 10, bit depth in the top nibble
  assert.equal(table.codec, 'vp09.00.10.08');
  assert.equal(table.sampleCount, 20);
});

test('every sample entry is claimed by exactly one handler', () => {
  const seen = new Set<string>();
  for (const codec of CODECS) {
    for (const entry of codec.sampleEntries) {
      assert.ok(!seen.has(entry), `'${entry}' is claimed twice`);
      seen.add(entry);
      assert.equal(handlerFor(entry)?.id, codec.id);
    }
  }
  assert.equal(handlerFor('mp4v'), null, 'an unknown entry is unclaimed, not a wrong guess');
});

test('every registry entry produces a well-formed codec string', () => {
  // Shape only — a browser is the authority on whether it can decode one, and the demo asks it.
  const shapes: Record<string, RegExp> = {
    avc: /^avc1\.[0-9a-f]{6}$/,
    hevc: /^hvc1\.[ABC]?\d+\.[0-9a-f]+\.[LH]\d+(\.[0-9a-f]{2})*$/,
    vp9: /^vp09\.\d{2}\.\d{2}\.\d{2}$/,
    av1: /^av01\.\d\.\d{2}[MH]\.\d{2}$/,
  };
  const files: Record<string, string> = {
    avc: 'extract-faststart.mp4',
    hevc: 'extract-hevc.mp4',
    vp9: 'extract-vp9.mp4',
    av1: 'extract-av1.mp4',
  };
  for (const codec of CODECS) {
    const table = parseSampleTable(new Uint8Array(readFileSync(fixture(files[codec.id]!))));
    assert.match(table.codec, shapes[codec.id]!, `${codec.id} codec string`);
  }
});

// ── synthetic layouts ──

const box = (type: string, payload: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(payload, 8);
  return bytes;
};

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const u32 = (...values: number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => {
    view.setUint32(i * 4, value);
  });
  return bytes;
};

/** A moov whose video sample entry is `entryType`, optionally carrying `configBox`, optionally fragmented. */
function moovWith(entryType: string, configBox: string | null, { fragmented = false } = {}): Uint8Array {
  const config = configBox ? box(configBox, new Uint8Array([1, 0x4d, 0x40, 0x14])) : new Uint8Array(0);
  const entry = box(entryType, cat(new Uint8Array(78), config));
  const stbl = box(
    'stbl',
    cat(
      box('stsd', cat(u32(0, 1), entry)),
      box('stts', u32(0, 0)),
      box('stsz', u32(0, 0, 0)),
      box('stsc', u32(0, 0)),
      box('stco', u32(0, 0)),
    ),
  );
  const mdhd = box('mdhd', cat(u32(0, 0, 0, 90000), new Uint8Array(8)));
  const trak = box('trak', box('mdia', cat(mdhd, box('minf', stbl))));
  const moov = box('moov', fragmented ? cat(trak, box('mvex', box('trex', u32(0, 1, 1, 0, 0, 0)))) : trak);
  return cat(box('ftyp', new Uint8Array(16)), moov);
}

// Before the registry this parsed cleanly and reported a video with zero frames, so the failure
// surfaced far from its cause. A fragmented file's sample table is in each fragment, not the moov.
test('a fragmented mp4 says so instead of reporting an empty video', () => {
  assert.throws(() => parseSampleTable(moovWith('avc1', 'avcC', { fragmented: true })), /fragmented mp4/);
});

test('an unsupported codec names itself and what is supported', () => {
  assert.throws(
    () => parseSampleTable(moovWith('mp4v', 'esds')),
    (error: Error) => {
      assert.match(error.message, /unsupported codec 'mp4v'/);
      assert.match(error.message, /avc1/, 'lists what it does support');
      return true;
    },
  );
});

test('a claimed entry missing its config box names the box', () => {
  assert.throws(() => parseSampleTable(moovWith('av01', null)), /'av01' sample entry has no av1C/);
});

test('no video track at all is distinct from an unsupported one', () => {
  const soun = box('trak', box('mdia', box('minf', box('stbl', box('stsd', u32(0, 0))))));
  const file = cat(box('ftyp', new Uint8Array(16)), box('moov', soun));
  assert.throws(() => parseSampleTable(file), /no video track/);
});

test('every failure has a message', () => {
  const failures = [
    { ok: false, reason: 'no-video-track' },
    { ok: false, reason: 'fragmented' },
    { ok: false, reason: 'unsupported-codec', sampleEntry: 'vp09' },
    { ok: false, reason: 'missing-config', sampleEntry: 'avc1', configBox: 'avcC' },
  ] as const;
  for (const failure of failures) assert.ok(describeFailure(failure).length > 0, failure.reason);
});
