// getCompositions / selectComposition — match @remotion/renderer. Open the bundle in
// a headless browser, let the registered Root populate the registry, read it back.
import { chromeExecutable } from '../../render/browser';
import { launchBrowser } from './capture';
import type { VideoConfig } from './types';

function pageUrl(serveUrl: string, id: string, inputProps: Record<string, unknown>): string {
  const props = encodeURIComponent(JSON.stringify(inputProps));
  return `${serveUrl}/?step=1&comp=${encodeURIComponent(id)}&props=${props}`;
}

export async function getCompositions(options: { serveUrl: string; inputProps?: Record<string, unknown> }): Promise<VideoConfig[]> {
  const { serveUrl, inputProps = {} } = options;
  const browser = await launchBrowser(await chromeExecutable());
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    page.on('pageerror', (e) => console.error('[remover] composition page error:', String(e).slice(0, 300)));
    await page.goto(pageUrl(serveUrl, '', inputProps), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true && Boolean(window.__getCompositions), { timeout: 120_000 });
    const comps = await page.evaluate(() => window.__getCompositions!());
    return comps.map((c) => ({ ...c, props: { ...c.defaultProps, ...inputProps } }));
  } finally {
    await browser.close();
  }
}

export async function selectComposition(options: {
  serveUrl: string;
  id: string;
  inputProps?: Record<string, unknown>;
}): Promise<VideoConfig> {
  const all = await getCompositions({ serveUrl: options.serveUrl, inputProps: options.inputProps });
  const found = all.find((c) => c.id === options.id);
  if (!found) throw new Error(`No composition with id "${options.id}". Found: ${all.map((c) => c.id).join(', ') || '(none)'}`);
  return found;
}
