// LRU cache of decoded VideoFrames keyed by src + presentation timestamp (µs),
// with a per-src sorted timestamp index for O(log n) nearest-frame lookups.
// The cache owns its frames: replaced, pruned, and cleared entries are closed here.

export type CachedFrameKey = `${string}|${number}`;

interface CachedFrameRecord {
  key: CachedFrameKey;
  src: string;
  frame: VideoFrame;
  timestamp: number;
  lastUsed: number;
}

export interface ClosestCachedFrame {
  key: CachedFrameKey;
  frame: VideoFrame;
  timestamp: number;
  distance: number;
}

const MAX_FRAMES_IN_CACHE = 12340;

const makeCachedFrameKey = (src: string, timestamp: number): CachedFrameKey => `${src}|${timestamp}`;

const closeFrame = (frame: VideoFrame | null | undefined) => {
  if (!frame) {
    return;
  }

  try {
    frame.close();
  } catch {
    // Closing is best-effort. Browsers can throw if the frame is already closed.
  }
};

/** Index of the first element >= target in a sorted ascending array. */
function lowerBound(sorted: readonly number[], target: number): number {
  const bounds = { lo: 0, hi: sorted.length };

  while (bounds.lo < bounds.hi) {
    const mid = (bounds.lo + bounds.hi) >> 1;
    if ((sorted[mid] ?? Infinity) < target) {
      bounds.lo = mid + 1;
    } else {
      bounds.hi = mid;
    }
  }

  return bounds.lo;
}

export class FrameCache {
  private readonly frames = new Map<CachedFrameKey, CachedFrameRecord>();
  /**
   * Sorted timestamps per src. `getClosest` typically runs per rendered slot
   * inside a layout pass; a linear scan over the whole cache (up to
   * MAX_FRAMES_IN_CACHE records) per slot was a measurable main-thread cost
   * on large timelines.
   */
  private readonly timestampsBySrc = new Map<string, readonly number[]>();

  getExact(src: string, targetTimestamp: number): ClosestCachedFrame | null {
    const key = makeCachedFrameKey(src, targetTimestamp);
    const record = this.frames.get(key);
    if (!record || record.timestamp !== targetTimestamp) {
      return null;
    }

    return {
      key: record.key,
      frame: record.frame,
      timestamp: record.timestamp,
      distance: 0,
    };
  }

  getClosest(src: string, targetTimestamp: number): ClosestCachedFrame | null {
    const timestamps = this.timestampsBySrc.get(src);
    if (!timestamps || timestamps.length === 0) {
      return null;
    }

    const upperIndex = lowerBound(timestamps, targetTimestamp);
    const candidates = [timestamps[upperIndex - 1], timestamps[upperIndex]].filter(
      (timestamp): timestamp is number => timestamp !== undefined,
    );

    const bestTimestamp = candidates.reduce((best, candidate) =>
      Math.abs(candidate - targetTimestamp) < Math.abs(best - targetTimestamp) ? candidate : best,
    );

    const record = this.frames.get(makeCachedFrameKey(src, bestTimestamp));
    if (!record) {
      return null;
    }

    return {
      key: record.key,
      frame: record.frame,
      timestamp: record.timestamp,
      distance: Math.abs(record.timestamp - targetTimestamp),
    };
  }

  put(params: { src: string; timestamp: number; frame: VideoFrame }): void {
    const key = makeCachedFrameKey(params.src, params.timestamp);
    const existing = this.frames.get(key);

    if (existing) {
      closeFrame(existing.frame);
    } else {
      const timestamps = this.timestampsBySrc.get(params.src) ?? [];
      const insertAt = lowerBound(timestamps, params.timestamp);
      this.timestampsBySrc.set(params.src, [...timestamps.slice(0, insertAt), params.timestamp, ...timestamps.slice(insertAt)]);
    }

    this.frames.set(key, {
      key,
      src: params.src,
      frame: params.frame,
      timestamp: params.timestamp,
      lastUsed: Date.now(),
    });
  }

  private removeFromIndex(record: CachedFrameRecord): void {
    const timestamps = this.timestampsBySrc.get(record.src);
    if (!timestamps) {
      return;
    }

    const remaining = timestamps.filter((timestamp) => timestamp !== record.timestamp);

    if (remaining.length === 0) {
      this.timestampsBySrc.delete(record.src);
    } else {
      this.timestampsBySrc.set(record.src, remaining);
    }
  }

  markUsed(key: CachedFrameKey): void {
    const record = this.frames.get(key);
    if (record) {
      record.lastUsed = Date.now();
    }
  }

  pruneOld(): void {
    if (this.frames.size <= MAX_FRAMES_IN_CACHE) {
      return;
    }

    const records = Array.from(this.frames.values()).sort((left, right) => left.lastUsed - right.lastUsed);

    for (const record of records.slice(0, records.length - MAX_FRAMES_IN_CACHE)) {
      closeFrame(record.frame);
      this.frames.delete(record.key);
      this.removeFromIndex(record);
    }
  }

  clear(): void {
    for (const record of this.frames.values()) {
      closeFrame(record.frame);
    }
    this.frames.clear();
    this.timestampsBySrc.clear();
  }
}
