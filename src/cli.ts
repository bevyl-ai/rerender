// `remover render|still` — 1-1 with `remotion render|still`. Bundles an arbitrary
// project in-process, selects the composition, and renders it.
//
//   remover render <entry> <comp-id> [output] [flags]
//   remover still  <entry> <comp-id> [output] [--frame N]
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { bundle } from './renderer/bundle';
import { getCompositions, selectComposition } from './renderer/select-composition';
import { renderMedia } from './renderer/render-media';
import { renderStill } from './renderer/render-still';

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.startsWith('no-')) {
        flags[key.slice(3)] = false;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const num = (v: string | boolean | undefined): number | undefined => (typeof v === 'string' ? Number(v) : undefined);
const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['render', 'still', 'studio', 'concat', 'cloud'].includes(cmd ?? '')) {
    console.error(
      'usage: remover render|still|studio <entry> [comp-id] [output] [flags]\n       remover concat --output <out.mp4> <segment0.mp4> …\n       remover cloud deploy | remover cloud render <entry> <comp> --function <name> --bucket <b> …',
    );
    process.exit(1);
  }
  const { positional, flags } = parseArgs(rest);

  // Distributed render on AWS Lambda (the @remotion/lambda equivalent).
  if (cmd === 'cloud') {
    const sub = positional[0];
    if (sub === 'deploy') {
      const project = positional[1] ?? str(flags.project);
      if (!project) {
        console.error(
          'usage: remover cloud deploy <project-dir> [--region r] [--memory 3008]\n  (project-dir is your video project, with src/index.ts — it gets baked into the worker image)',
        );
        process.exit(1);
      }
      const { deploy } = await import('../cloud/deploy');
      const r = await deploy({
        project: resolve(project),
        region: str(flags.region),
        memory: num(flags.memory),
        build: flags.build !== false,
        localTag: str(flags['local-tag']),
      });
      console.log(`\n✓ deployed to ${r.region}`);
      console.log(`  function: ${r.functionName}`);
      console.log(`  bucket:   ${r.bucketName}`);
      console.log(
        `  render:   remover cloud render ${project}/src/index.ts <Comp> --function ${r.functionName} --bucket ${r.bucketName} --workers 20 -o out.mp4`,
      );
      return;
    }
    if (sub === 'render') {
      const [, cEntry, cComp] = positional;
      const fn = str(flags.function);
      const bucket = str(flags.bucket);
      if (!cEntry || !cComp || !fn || !bucket) {
        console.error(
          'usage: remover cloud render <entry> <comp> --function <name> --bucket <bucket> [--workers N] [--region r] [--props json] --output out.mp4',
        );
        process.exit(1);
      }
      let props: Record<string, unknown> = {};
      const pf = str(flags.props);
      if (pf) props = JSON.parse(pf.endsWith('.json') ? readFileSync(pf, 'utf8') : pf);
      const { orchestrateRender } = await import('../cloud/orchestrate');
      const { awsInvoker } = await import('../cloud/aws');
      const output = str(flags.output) ?? `out/${cComp}.mp4`;
      mkdirSync(dirname(resolve(output)), { recursive: true });
      const t0 = Date.now();
      const r = await orchestrateRender({
        entry: resolve(cEntry),
        comp: cComp,
        props,
        workers: num(flags.workers) ?? 8,
        output: resolve(output),
        invoke: awsInvoker({ functionName: fn, bucket, keyPrefix: `renders/${cComp}-${Date.now()}`, region: str(flags.region) }),
        onProgress: (d, total) => process.stdout.write(`\r  ${d}/${total} workers done`),
      });
      process.stdout.write('\n');
      console.log(
        `✓ cloud render: ${cComp} (${r.durationInFrames}f @ ${r.fps}fps) across ${r.slices} Lambda workers → ${output}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`,
      );
      return;
    }
    console.error('usage: remover cloud deploy | remover cloud render <entry> <comp> --function <name> --bucket <bucket> …');
    process.exit(1);
  }

  // Coordinator step for distributed renders: stitch the segments produced by N workers
  // (each `remover render <entry> <comp> --frames lo-hi --muted -o segK.mp4`) into one
  // mp4. Pure mediabunny packet-copy in Node — no browser, no ffmpeg.
  if (cmd === 'concat') {
    const output = str(flags.output);
    if (!output || positional.length === 0) {
      console.error('usage: remover concat --output <out.mp4> [--fps 30] [--codec avc] <segment0.mp4> <segment1.mp4> …');
      process.exit(1);
    }
    const { concatSegments } = await import('./renderer/encode');
    await concatSegments(
      positional.map((s) => resolve(s)),
      (str(flags.codec) as 'avc' | 'hevc' | 'vp9' | 'av1' | undefined) ?? 'avc',
      num(flags.fps) ?? 30,
      resolve(output),
    );
    console.log(`✓ concat: ${positional.length} segments → ${output}`);
    return;
  }

  const [entry, compId, outputPos] = positional;
  if (!entry) {
    console.error('error: missing entry point (e.g. src/index.ts)');
    process.exit(1);
  }

  if (cmd === 'studio') {
    const { studioServer } = await import('./renderer/studio');
    const s = await studioServer(resolve(entry), { port: num(flags.port) });
    console.log(`\n  remover studio  →  ${s.url}\n  Ctrl-C to stop.\n`);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const { spawn } = await import('node:child_process');
    spawn(opener, [s.url], { stdio: 'ignore', detached: true }).unref();
    await new Promise(() => undefined); // keep the server alive
    return;
  }

  let inputProps: Record<string, unknown> = {};
  const propsFlag = str(flags.props);
  if (propsFlag) inputProps = JSON.parse(propsFlag.endsWith('.json') ? readFileSync(propsFlag, 'utf8') : propsFlag);

  const b = await bundle(resolve(entry), { port: num(flags.port) });
  try {
    if (!compId) {
      const comps = await getCompositions({ serveUrl: b.serveUrl, inputProps });
      console.log('compositions:', comps.map((c) => c.id).join(', ') || '(none)');
      return;
    }
    let composition = await selectComposition({ serveUrl: b.serveUrl, id: compId, inputProps });
    composition = {
      ...composition,
      width: num(flags.width) ?? composition.width,
      height: num(flags.height) ?? composition.height,
      fps: num(flags.fps) ?? composition.fps,
      durationInFrames: num(flags.duration) ?? composition.durationInFrames,
    };

    const ext = cmd === 'still' ? 'png' : 'mp4';
    const output = str(flags.output) ?? outputPos ?? `out/${composition.id}.${ext}`;
    mkdirSync(dirname(resolve(output)), { recursive: true });

    if (cmd === 'still') {
      const frame = num(flags.frame);
      await renderStill({
        composition,
        serveUrl: b.serveUrl,
        output,
        frame,
        inputProps,
        scale: num(flags.scale),
        imageFormat: str(flags['image-format']) as 'png' | 'jpeg' | undefined,
        jpegQuality: num(flags['jpeg-quality']),
      });
      console.log(`✓ still: ${composition.id} @ frame ${frame ?? composition.durationInFrames - 1} → ${output}`);
      return;
    }

    let frameRange: number | [number, number] | undefined;
    const framesFlag = str(flags.frames);
    if (framesFlag) {
      const parts = framesFlag.split('-').map(Number);
      frameRange = parts.length === 2 ? [parts[0]!, parts[1]!] : parts[0]!;
    }

    const t0 = Date.now();
    await renderMedia({
      composition,
      serveUrl: b.serveUrl,
      outputLocation: output,
      inputProps,
      crf: num(flags.crf),
      scale: num(flags.scale),
      concurrency: num(flags.concurrency),
      imageFormat: str(flags['image-format']) as 'png' | 'jpeg' | undefined,
      jpegQuality: num(flags['jpeg-quality']),
      muted: flags.muted === true,
      pixelFormat: str(flags['pixel-format']),
      frameRange,
      onProgress: ({ progress }) => process.stdout.write(`\r  rendering… ${Math.round(progress * 100)}%`),
    });
    process.stdout.write('\n');
    const renderedFrames = Array.isArray(frameRange) ? frameRange[1] - frameRange[0] + 1 : composition.durationInFrames;
    console.log(
      `✓ render: ${composition.id} (${renderedFrames}f @ ${composition.fps}fps, ${composition.width}x${composition.height}) → ${output}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`,
    );
  } finally {
    await b.close();
  }
}

main().catch((e) => {
  console.error('error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
