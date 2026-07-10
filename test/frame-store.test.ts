// Unit tests for extract/frame-store and extract/frame-cache — the multi-subscriber
// store layer. DOM-free: VideoFrame is faked (timestamp + clone/close bookkeeping),
// the extractor is faked on a 50ms sample grid with decode completion held until the
// test releases it. Run with: tsx test/frame-store.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FrameExtractor } from '../src/extract/extractor';
import { FrameCache } from '../src/extract/frame-cache';
import { createFrameStore } from '../src/extract/frame-store';

const MICROS = 1_000_000;
/** 20fps grid: snap to the nearest 50ms sample, like a real filmstrip rendition. */
const SAMPLE_STEP_MICROS = 50_000;

class FakeVideoFrame {
  closed = false;

  constructor(
    readonly timestamp: number,
    private readonly registry?: FakeVideoFrame[],
  ) {
    registry?.push(this);
  }

  clone(): FakeVideoFrame {
    if (this.closed) {
      throw new Error('clone of closed frame');
    }
    return new FakeVideoFrame(this.timestamp, this.registry);
  }

  close() {
    this.closed = true;
  }
}

interface FakeExtractorState {
  extractCalls: number[][];
  decodedMicros: number[];
  /** Every frame the fake decoder produced, including clones the store made. */
  createdFrames: FakeVideoFrame[];
  release: () => void;
}

/**
 * Fake extractor on the 50ms sample grid. Holds every extract() until
 * release() so tests control when "decode" completes.
 */
function makeFakeExtractor(): {
  state: FakeExtractorState;
  create: () => Promise<FrameExtractor>;
} {
  const pendingDeliveries: (() => void)[] = [];
  const state: FakeExtractorState = {
    extractCalls: [],
    decodedMicros: [],
    createdFrames: [],
    release: () => {
      for (const deliverOne of pendingDeliveries.splice(0)) {
        deliverOne();
      }
    },
  };

  const extractor = {
    snapToSampleMicros: (seconds: number) => Math.round((seconds * MICROS) / SAMPLE_STEP_MICROS) * SAMPLE_STEP_MICROS,
    extract: (timestampsInSeconds: readonly number[], onFrame: (frame: VideoFrame, requestedSeconds: number) => void) => {
      state.extractCalls.push(timestampsInSeconds.map((s) => s * MICROS));
      return new Promise<void>((resolve) => {
        pendingDeliveries.push(() => {
          for (const seconds of timestampsInSeconds) {
            const micros = Math.round(seconds * MICROS);
            state.decodedMicros.push(micros);
            onFrame(new FakeVideoFrame(micros, state.createdFrames) as unknown as VideoFrame, seconds);
          }
          resolve();
        });
      });
    },
    dispose: () => undefined,
  } as unknown as FrameExtractor;

  return { state, create: () => Promise.resolve(extractor) };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createFrameStore', () => {
  it('snaps quantized targets to the sample grid and decodes each sample once across overlapping subscriptions', async () => {
    const { state, create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    const first: number[] = [];
    const second: number[] = [];
    // Different quantizations of the same moment: 90ms and 110ms both snap to 100ms.
    store.subscribeToExtraction('src-a', [90_000], (frame) => first.push(frame.timestamp));
    store.subscribeToExtraction('src-a', [110_000], (frame) => second.push(frame.timestamp));
    await flushMicrotasks();

    assert.equal(state.extractCalls.length, 1);
    assert.deepEqual(state.extractCalls[0], [100_000]);

    state.release();
    await flushMicrotasks();

    assert.deepEqual(first, [100_000]);
    assert.deepEqual(second, [100_000]);
    assert.deepEqual(state.decodedMicros, [100_000]);
  });

  it('serves later subscriptions from the cache without re-extracting', async () => {
    const { state, create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    store.subscribeToExtraction('src-a', [100_000], () => undefined);
    await flushMicrotasks();
    state.release();
    await flushMicrotasks();

    const replayed: number[] = [];
    store.subscribeToExtraction('src-a', [110_000], (frame) => replayed.push(frame.timestamp));
    await flushMicrotasks();

    assert.deepEqual(replayed, [100_000]);
    assert.equal(state.extractCalls.length, 1);
  });

  it('stops delivering after unsubscribe but still caches the decoded frame', async () => {
    const { state, create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    const delivered: number[] = [];
    const unsubscribe = store.subscribeToExtraction('src-a', [100_000], (frame) => delivered.push(frame.timestamp));
    await flushMicrotasks();
    unsubscribe();
    state.release();
    await flushMicrotasks();

    assert.deepEqual(delivered, []);
    // The decode still happened and the frame is cached for the next pass.
    assert.deepEqual(state.decodedMicros, [100_000]);
    assert.equal(store.getClosestCachedFrame('src-a', 100_000)?.timestamp, 100_000);
  });

  it('drops late frames after dispose instead of re-populating the cleared cache', async () => {
    const { state, create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    const delivered: number[] = [];
    store.subscribeToExtraction('src-a', [100_000], (frame) => delivered.push(frame.timestamp));
    await flushMicrotasks();

    store.dispose();
    state.release();
    await flushMicrotasks();

    assert.deepEqual(delivered, []);
    assert.equal(store.getClosestCachedFrame('src-a', 100_000), null);
    // The late frame itself was closed, not cached or leaked.
    assert.deepEqual(
      state.createdFrames.map((frame) => frame.closed),
      [true],
    );
  });

  it('keeps delivering to remaining waiters when one subscriber throws', async () => {
    const { state, create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    const survivor: number[] = [];
    store.subscribeToExtraction('src-a', [90_000], () => {
      throw new Error('bad canvas draw');
    });
    store.subscribeToExtraction('src-a', [110_000], (frame) => survivor.push(frame.timestamp));
    await flushMicrotasks();
    state.release();
    await flushMicrotasks();

    assert.deepEqual(survivor, [100_000]);
    // Original + thrower's clone + cache clone were created; only the cache's
    // copy stays open (it lives in the cache by design).
    assert.equal(state.createdFrames.filter((frame) => !frame.closed).length, 1);
  });

  it('exposes the extractor snap once resolved, null before', async () => {
    const { create } = makeFakeExtractor();
    const store = createFrameStore({ createExtractor: create });

    assert.equal(store.snapToSampleMicros('src-a', 60_000), null);

    store.subscribeToExtraction('src-a', [100_000], () => undefined);
    await flushMicrotasks();

    // 50ms fake grid: 60ms snaps to 50ms.
    assert.equal(store.snapToSampleMicros('src-a', 60_000), 50_000);
  });

  it('retries extraction on a later subscription after a decode failure', async () => {
    let shouldFail = true;
    const extractCalls: number[][] = [];
    const failingExtractor = {
      snapToSampleMicros: (seconds: number) => Math.round((seconds * MICROS) / SAMPLE_STEP_MICROS) * SAMPLE_STEP_MICROS,
      extract: (timestampsInSeconds: readonly number[], onFrame: (frame: VideoFrame, requestedSeconds: number) => void) => {
        extractCalls.push(timestampsInSeconds.map((s) => s * MICROS));
        if (shouldFail) {
          return Promise.reject(new Error('decoder exploded'));
        }
        for (const seconds of timestampsInSeconds) {
          onFrame(new FakeVideoFrame(Math.round(seconds * MICROS)) as unknown as VideoFrame, seconds);
        }
        return Promise.resolve();
      },
      dispose: () => undefined,
    } as unknown as FrameExtractor;

    const store = createFrameStore({
      createExtractor: () => Promise.resolve(failingExtractor),
    });

    store.subscribeToExtraction('src-a', [100_000], () => undefined);
    await flushMicrotasks();
    assert.equal(extractCalls.length, 1);

    shouldFail = false;
    const delivered: number[] = [];
    store.subscribeToExtraction('src-a', [100_000], (frame) => delivered.push(frame.timestamp));
    await flushMicrotasks();

    // The failed sample was not left parked in the in-flight index.
    assert.equal(extractCalls.length, 2);
    assert.deepEqual(delivered, [100_000]);
  });
});

describe('FrameCache', () => {
  it('keeps cached frames isolated to the exact source key prefix', () => {
    const cache = new FrameCache();
    const previewSource = 'https://cdn.example.com/preview.mp4';
    const chunkSource = `${previewSource}/segment-0.mp4`;

    cache.put({
      src: chunkSource,
      timestamp: 100,
      frame: new FakeVideoFrame(100) as unknown as VideoFrame,
    });

    assert.equal(cache.getClosest(previewSource, 100), null);
  });

  it('returns the nearer of the two neighboring cached timestamps', () => {
    const cache = new FrameCache();
    const src = 'https://cdn.example.com/preview.mp4';

    for (const timestamp of [100, 500, 900]) {
      cache.put({
        src,
        timestamp,
        frame: new FakeVideoFrame(timestamp) as unknown as VideoFrame,
      });
    }

    assert.equal(cache.getClosest(src, 640)?.timestamp, 500);
    assert.equal(cache.getClosest(src, 780)?.timestamp, 900);
    assert.equal(cache.getClosest(src, 40)?.timestamp, 100);
    assert.equal(cache.getClosest(src, 2000)?.timestamp, 900);
    assert.equal(cache.getClosest(src, 640)?.distance, 140);
  });

  it('replacing a timestamp keeps a single closest-lookup entry', () => {
    const cache = new FrameCache();
    const src = 'https://cdn.example.com/preview.mp4';
    const original = new FakeVideoFrame(100);
    const replacement = new FakeVideoFrame(100);

    cache.put({ src, timestamp: 100, frame: original as unknown as VideoFrame });
    cache.put({ src, timestamp: 100, frame: replacement as unknown as VideoFrame });

    assert.equal(original.closed, true);
    assert.equal(cache.getClosest(src, 100)?.frame, replacement as unknown as VideoFrame);
  });

  it('closes cached frames when cleared', () => {
    const cache = new FrameCache();
    const frame = new FakeVideoFrame(100);

    cache.put({
      src: 'https://cdn.example.com/preview.mp4',
      timestamp: 100,
      frame: frame as unknown as VideoFrame,
    });

    cache.clear();

    assert.equal(frame.closed, true);
  });
});
