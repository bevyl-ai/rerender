// Shared look for the demo page's two showcases (extraction, in-browser export).
import { type CSSProperties, useEffect, useState } from 'react';

/** One accent, not a gradient — also the keyword blue in the code snippets. */
export const ACCENT = '#61afef';

/**
 * `?smoketest` — set by test/export.test.ts, which drives the real export flow through the real UI
 * in headless Chrome. It makes the page do less: the export captures a short slice instead of the
 * full hero video, and the extraction showcase doesn't auto-run at all (its Range requests would
 * fall back to whole-file reads against that test's deliberately range-less server, and its decodes
 * would contend with the export's on a 2-core runner). The real page never sets it.
 */
export const SMOKE_TEST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('smoketest');

export const card: CSSProperties = { background: '#0f0f15', border: '1px solid #23232c', borderRadius: 14, overflow: 'hidden' };

export const cardLabel: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  letterSpacing: 1.5,
  color: '#8a8a99',
  padding: '10px 14px',
  borderBottom: '1px solid #1d1d25',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

export function Badge({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: '#16161d',
        border: '1px solid #26262e',
        borderRadius: 999,
        padding: '7px 14px',
        fontSize: 13,
        fontFamily: 'ui-monospace, monospace',
        color: '#cfcfd8',
      }}
    >
      {children}
    </span>
  );
}

/** True on narrow (phone) viewports — drives the tables' stacked mobile layout. */
export function useNarrow(maxWidth = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [maxWidth]);
  return narrow;
}

/** How the race is set up, stated once per page rather than once per race. */
export const RACE_TERMS =
  "Rigged in Remotion's favor: it gets a web worker, a fresh timestamp array, in-range timestamps only. Our index rebuilds cold on every run.";
