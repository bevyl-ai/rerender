// Ranged reads and moov location, on synthetic box layouts rather than fixtures — a moov large
// enough to overrun the 64 KB probe would otherwise mean a megabyte-scale binary in the repo, and
// that branch had no coverage at all until it was already deployed.
//
// The 200-instead-of-206 case is not hypothetical: Cloudflare's asset layer answers a Range
// request with the whole body until the URL is warm at the edge, which is what broke
// @remotion/media-parser on rerender.video while this module carried on working.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createUrlSource } from '../src/extract/source';

const SRC = 'https://fixture.test/synthetic.mp4';
const PROBE = 64 * 1024;

function box(type: string, payloadSize: number, fill = 0): Uint8Array {
  const size = 8 + payloadSize;
  const bytes = new Uint8Array(size).fill(fill);
  new DataView(bytes.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

interface Call {
  start: number;
  end: number;
}

/** Serves `bytes` over ranged reads, recording every range. `ignoreRange` mimics a server that
 *  answers 200 with the entire body regardless of what was asked for. */
function serve(bytes: Uint8Array, calls: Call[], ignoreRange = false) {
  return ((_input: unknown, init?: { headers?: Record<string, string> }) => {
    const match = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '');
    const start = Number(match![1]);
    const end = Math.min(Number(match![2]) + 1, bytes.byteLength);
    calls.push({ start, end });
    const body = ignoreRange ? bytes : bytes.subarray(start, end);
    return Promise.resolve({
      status: ignoreRange ? 200 : 206,
      arrayBuffer: async () => body.slice().buffer,
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

test('moov inside the probe costs one request', async () => {
  const file = concat(box('ftyp', 24), box('moov', 4096, 0xab), box('mdat', 1024));
  const calls: Call[] = [];
  const moov = await createUrlSource(SRC, serve(file, calls)).readThroughMoov();

  assert.equal(calls.length, 1);
  assert.equal(moov.byteLength, 32 + 8 + 4096);
  assert.deepEqual(moov.subarray(32), file.subarray(32, 32 + 8 + 4096));
});

test('moov past the probe fetches only the remainder and rebuilds it exactly', async () => {
  const moovPayload = 300 * 1024;
  const file = concat(box('ftyp', 24), box('moov', moovPayload, 0x5c), box('mdat', 4096));
  const calls: Call[] = [];
  const moov = await createUrlSource(SRC, serve(file, calls)).readThroughMoov();

  const moovEnd = 32 + 8 + moovPayload;
  assert.equal(calls.length, 2, 'probe, then the part the probe missed');
  assert.deepEqual(calls[0], { start: 0, end: PROBE });
  assert.equal(calls[1]!.start, PROBE, 'second read starts where the probe ended, not at 0');
  assert.equal(calls[1]!.end, moovEnd);
  assert.equal(moov.byteLength, moovEnd);
  assert.deepEqual(moov, file.subarray(0, moovEnd), 'concatenated bytes match the file');
});

test('moov behind mdat is found by probing past it', async () => {
  const file = concat(box('ftyp', 24), box('mdat', 200 * 1024), box('moov', 2048, 0x77));
  const calls: Call[] = [];
  const moov = await createUrlSource(SRC, serve(file, calls)).readThroughMoov();

  assert.equal(moov.byteLength, 8 + 2048);
  assert.deepEqual(moov, file.subarray(file.byteLength - 8 - 2048));
});

test('a server that ignores Range and returns 200 still yields the requested slice', async () => {
  const file = concat(box('ftyp', 24), box('moov', 4096, 0x11), box('mdat', 8192, 0x22));
  const calls: Call[] = [];
  const source = createUrlSource(SRC, serve(file, calls, true));

  const moov = await source.readThroughMoov();
  assert.equal(moov.byteLength, 32 + 8 + 4096, 'sliced locally rather than handing back the whole file');

  const mid = await source.read(40, 104);
  assert.equal(mid.byteLength, 64);
  assert.deepEqual(mid, file.subarray(40, 104));
});

test('a file with no moov fails loudly', async () => {
  const file = concat(box('ftyp', 24), box('free', 1024));
  await assert.rejects(() => createUrlSource(SRC, serve(file, [])).readThroughMoov(), /could not locate moov/);
});
