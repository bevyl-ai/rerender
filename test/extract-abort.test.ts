// Validates AbortSignal wiring on the frame extractor: a pre-aborted or later-aborted
// extractor-level signal fails setup with the caller's reason; a per-call extract()
// signal cancels that call's in-flight fetches while the extractor stays usable.
// Decoder-side abort (eager decoder.close) needs WebCodecs and is exercised in-browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFrameExtractor } from '../src/extract/extractor';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const FIXTURE = join(FIXTURES, 'extract-faststart.mp4');
const SRC = 'https://fixture.test/faststart.mp4';

/**
 * Range-serving fetch stub that honors AbortSignal. From `holdFromCall` (1-based)
 * onward, requests never resolve — they only reject when their signal aborts —
 * so tests can pin an "in-flight" fetch deterministically.
 */
function fileFetch(path: string, opts?: { holdFromCall?: number; settleOnAbortFromCall?: number }) {
  const bytes = readFileSync(path);
  let calls = 0;
  const fetchFn: typeof fetch = (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      calls += 1;
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const serve = () => {
        const range = new Headers(init?.headers).get('Range');
        const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
        assert.ok(match, `unexpected Range: ${range}`);
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]) + 1, bytes.length);
        resolve(new Response(bytes.subarray(start, end), { status: 206 }));
      };
      if (opts?.holdFromCall !== undefined && calls >= opts.holdFromCall) {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        return;
      }
      // Settled-while-aborting race: the read RESOLVES with real bytes in the
      // same tick the abort fires, so the awaiter resumes with an already-aborted signal.
      if (opts?.settleOnAbortFromCall !== undefined && calls >= opts.settleOnAbortFromCall) {
        signal?.addEventListener('abort', serve, { once: true });
        return;
      }
      serve();
    });
  return { fetchFn, calls: () => calls };
}

// A signal aborted before setup fails createFrameExtractor with the caller's reason.
{
  const reason = new Error('caller gave up');
  const controller = new AbortController();
  controller.abort(reason);
  const { fetchFn } = fileFetch(FIXTURE);
  await assert.rejects(createFrameExtractor({ src: SRC, fetchFn, signal: controller.signal }), (error: unknown) => error === reason);
}

// A signal aborted mid-setup (moov fetch in flight) rejects setup promptly.
{
  const controller = new AbortController();
  const { fetchFn } = fileFetch(FIXTURE, { holdFromCall: 1 });
  const pending = createFrameExtractor({ src: SRC, fetchFn, signal: controller.signal });
  const reason = new Error('setup timeout');
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(pending, (error: unknown) => error === reason);
}

// A per-call signal cancels that call's in-flight GOP fetch; the extractor stays usable.
{
  // Call 1 is the moov probe (faststart moov fits the head probe); GOP fetches follow.
  const { fetchFn, calls } = fileFetch(FIXTURE, { holdFromCall: 2 });
  const extractor = await createFrameExtractor({ src: SRC, fetchFn });

  const controller = new AbortController();
  const reason = new Error('call timeout');
  const pending = extractor.extract([0], () => assert.fail('no frames expected from an aborted call'), { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(pending, (error: unknown) => error === reason);

  // Still alive: the sample grid answers and a fresh call reaches the network again.
  assert.equal(typeof extractor.snapToSampleMicros(0), 'number');
  const callsBefore = calls();
  const second = new AbortController();
  const secondPending = extractor.extract([0], () => undefined, { signal: second.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls() > callsBefore, 'second extract() should start a new GOP fetch');
  second.abort(new Error('test cleanup'));
  await secondPending.catch(() => undefined);
  extractor.dispose();
}

// A GOP read that settles WITH bytes in the same tick the signal aborts must still
// reject with the abort reason — never proceed to the decoder with a dead signal.
// (Without the post-read guard this crashes on VideoDecoder in node, failing the
// reason assertion.)
{
  const { fetchFn } = fileFetch(FIXTURE, { settleOnAbortFromCall: 2 });
  const extractor = await createFrameExtractor({ src: SRC, fetchFn });
  const controller = new AbortController();
  const reason = new Error('aborted as read settled');
  const pending = extractor.extract([0], () => assert.fail('no frames expected'), {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(pending, (error: unknown) => error === reason);
  extractor.dispose();
}

// A pre-aborted per-call signal throws at entry without touching the network.
{
  const { fetchFn, calls } = fileFetch(FIXTURE);
  const extractor = await createFrameExtractor({ src: SRC, fetchFn });
  const callsBefore = calls();
  await assert.rejects(
    extractor.extract([0], () => assert.fail('no frames expected'), { signal: AbortSignal.abort() }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(calls(), callsBefore, 'entry abort must not fetch');
  extractor.dispose();
}

console.log('extract-abort: all assertions passed');
