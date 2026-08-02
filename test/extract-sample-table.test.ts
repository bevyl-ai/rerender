// Validates the extract module's sample-table flattening against ffprobe's packet table
// (committed as extract-faststart.expected.json; regenerate with the ffprobe command in
// that file's sibling comment below). Covers both moov placements via the real RangeSource
// probe path, backed by a local-file fetch stub instead of a server.
//
// Regenerate fixtures + expectations:
//   ffmpeg -f lavfi -i "testsrc2=size=228x128:rate=20:duration=6" -c:v libx264 -profile:v main \
//     -g 60 -bf 2 -pix_fmt yuv420p [-movflags +faststart] test/fixtures/extract-<layout>.mp4
//   ffprobe -select_streams v:0 -show_packets -show_entries packet=pts,size,pos,flags -of json …
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUrlSource } from '../src/extract/source';
import { parseSampleTable } from '../src/extract/mp4-sample-table';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

/** fetch stub serving Range requests from a local file, so RangeSource probing runs for real. */
function fileFetch(path: string): typeof fetch {
  const bytes = readFileSync(path);
  return async (_input, init) => {
    const range = new Headers(init?.headers).get('Range');
    assert.ok(range, 'extract source must always send a Range header');
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    assert.ok(match, `unexpected Range format: ${range}`);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]) + 1, bytes.length);
    return new Response(bytes.subarray(start, end), { status: 206 });
  };
}

interface ExpectedPacket {
  pts: number;
  size: number;
  pos: number;
  key: boolean;
}

for (const layout of ['faststart', 'moovend'] as const) {
  const expected: { timescale: number; packets: ExpectedPacket[] } = JSON.parse(
    readFileSync(join(FIXTURES, `extract-${layout}.expected.json`), 'utf8'),
  );
  const source = createUrlSource(`https://fixture.test/${layout}.mp4`, fileFetch(join(FIXTURES, `extract-${layout}.mp4`)));
  const table = parseSampleTable(await source.readThroughMoov());

  assert.equal(table.timescale, expected.timescale, `${layout}: timescale`);
  assert.equal(table.sampleCount, expected.packets.length, `${layout}: sample count`);
  assert.match(table.codec, /^avc1\.4d40/, `${layout}: Main-profile codec string, got ${table.codec}`);
  assert.ok(table.description.length > 8, `${layout}: avcC description present`);

  // Byte layout and keyframe flags must match ffprobe exactly, per sample in decode order.
  for (let i = 0; i < table.sampleCount; i++) {
    assert.equal(table.byteOffsets[i], expected.packets[i].pos, `${layout}: sample ${i} offset`);
    assert.equal(table.byteSizes[i], expected.packets[i].size, `${layout}: sample ${i} size`);
    assert.equal(table.keySampleIndices.includes(i), expected.packets[i].key, `${layout}: sample ${i} keyflag`);
  }

  // Presentation timestamps: ffprobe reports raw stream pts; the table applies the elst
  // shift so the first *presented* frame sits at 0. The two must differ by one constant.
  const shift = expected.packets[0].pts - table.presentationTicks[0];
  for (let i = 0; i < table.sampleCount; i++) {
    assert.equal(table.presentationTicks[i], expected.packets[i].pts - shift, `${layout}: sample ${i} pts (shift ${shift})`);
  }
  assert.equal(Math.min(...table.presentationTicks), 0, `${layout}: first presented frame at t=0`);

  // GOP contiguity: every GOP must be one contiguous byte range (what the extractor fetches).
  for (let i = 1; i < table.sampleCount; i++) {
    assert.equal(table.byteOffsets[i], table.byteOffsets[i - 1] + table.byteSizes[i - 1], `${layout}: contiguity at sample ${i}`);
  }

  console.log(`extract-sample-table [${layout}]: ${table.sampleCount} samples OK (codec ${table.codec}, shift ${shift})`);
}

console.log('extract-sample-table: PASS');

// snapToSampleMicros: the stable cache key for a requested time. Uses the extractor
// itself (no decode happens until extract(), so this runs fine in node).
{
  const { createFrameExtractor } = await import('../src/extract/extractor');
  const extractor = await createFrameExtractor({
    src: 'https://fixture.test/faststart.mp4',
    fetchFn: fileFetch(join(FIXTURES, 'extract-faststart.mp4')),
  });
  const lastMicros = Math.round((Math.max(...extractor.sampleTable!.presentationTicks) / extractor.sampleTable!.timescale) * 1_000_000);

  // 20 fps fixture: samples every 50_000 µs. Nearest-sample rounding in both directions.
  assert.equal(extractor.snapToSampleMicros(0), 0, 'snap: exact first sample');
  assert.equal(extractor.snapToSampleMicros(0.26), 250_000, 'snap: rounds up to nearest sample');
  assert.equal(extractor.snapToSampleMicros(0.22), 200_000, 'snap: rounds down to nearest sample');
  assert.equal(extractor.snapToSampleMicros(-5), 0, 'snap: clamps below to first sample');
  assert.equal(extractor.snapToSampleMicros(1e9), lastMicros, 'snap: clamps past end to last sample');
  assert.equal(extractor.snapToSampleMicros(0.26), extractor.snapToSampleMicros(0.26), 'snap: stable');
  extractor.dispose();
  console.log('snapToSampleMicros: PASS');
}
