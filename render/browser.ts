// remover's own browser binary. NOT Playwright — a thin puppeteer-core driving a
// managed chrome-headless-shell (the same engine family Remotion renders with, so
// output is pixel-identical). Pinned to match Remotion's version; override with
// REMOVER_CHROME (absolute path) or REMOVER_CHROME_BUILD (a Chrome-for-Testing id).
import { Browser, computeExecutablePath, install } from '@puppeteer/browsers';
import { join } from 'node:path';

const BUILD_ID = process.env.REMOVER_CHROME_BUILD ?? '149.0.7790.0';
const CACHE = join(process.cwd(), 'node_modules', '.remover-chrome');

export async function chromeExecutable(): Promise<string> {
  if (process.env.REMOVER_CHROME) return process.env.REMOVER_CHROME;
  // idempotent — downloads once into remover's own cache, then reuses it.
  await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId: BUILD_ID, cacheDir: CACHE });
  return computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: BUILD_ID, cacheDir: CACHE });
}
