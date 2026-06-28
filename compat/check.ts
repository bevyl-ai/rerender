// remover compatibility tool — API layer.
//
// Statically scans example compositions, extracts what they import from
// `remotion` / `@remotion/*`, and scores them against what remover actually
// exports — answering "would this Remotion composition drop in unchanged?" — then
// reports coverage of the full Remotion API surface (the drop-in denominator).
//
//   npm run compat
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as remover from '../src/remotion';
import * as transitions from '../src/transitions';
import * as mediaUtils from '../src/media-utils';
import { remotionApi } from './remotion-api';

// What remover provides for each importable package (runtime exports).
const PROVIDED: Record<string, Set<string>> = {
  remotion: new Set(Object.keys(remover)),
  '@remotion/transitions': new Set(Object.keys(transitions)),
  '@remotion/transitions/slide': new Set(['slide']),
  '@remotion/transitions/fade': new Set(['fade']),
  '@remotion/transitions/wipe': new Set(['wipe']),
  '@remotion/media-utils': new Set(Object.keys(mediaUtils)),
};
const SUPPORTED = PROVIDED.remotion!;

const ROOT = new URL('..', import.meta.url).pathname;
const EXAMPLES = join(ROOT, 'examples');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](remotion|@remotion\/[^'"]+)['"]/g;

interface Use { sym: string; pkg: string; }
function parseUses(src: string): Use[] {
  const uses: Use[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(src))) {
    const pkg = m[2]!;
    for (const raw of m[1]!.split(',')) {
      const sym = raw.trim().split(/\s+as\s+/)[0]!.trim();
      if (sym) uses.push({ sym, pkg });
    }
  }
  return uses;
}

type Status = 'supported' | 'missing' | 'ecosystem';
function classify(u: Use): Status {
  if (PROVIDED[u.pkg]?.has(u.sym)) return 'supported';
  return u.pkg === 'remotion' ? 'missing' : 'ecosystem';
}

// remover also exports these as TYPES, which a runtime Object.keys() can't see.
const TYPE_EXPORTS = new Set(['VideoConfig', 'InterpolateOptions', 'Extrapolate', 'ExtrapolateType', 'SpringConfig', 'RemotionEnvironment', 'PlayerProps']);
// implemented if remover exports the symbol (or its base, for dotted sub-APIs like Series.Sequence)
const isImpl = (name: string): boolean =>
  SUPPORTED.has(name) || SUPPORTED.has(name.split('.')[0]!) || TYPE_EXPORTS.has(name);

function main(): void {
  const files = walk(EXAMPLES);
  const ecoPkgs = new Map<string, Set<string>>();
  let ready = 0;

  console.log('\n  remover · compatibility report');
  console.log('  ' + '─'.repeat(64));

  for (const file of files) {
    const uses = parseUses(readFileSync(file, 'utf8'));
    const miss = uses.filter((u) => classify(u) === 'missing');
    const eco = uses.filter((u) => classify(u) === 'ecosystem');
    const ok = miss.length === 0 && eco.length === 0;
    if (ok) ready++;

    eco.forEach((u) => {
      if (!ecoPkgs.has(u.pkg)) ecoPkgs.set(u.pkg, new Set());
      ecoPkgs.get(u.pkg)!.add(u.sym);
    });

    const name = relative(EXAMPLES, file).replace(/\/composition\.tsx$/, '');
    const tag = ok ? '✅ drop-in   ' : '❌ needs work';
    const detail = ok
      ? `${uses.length} symbols, all supported`
      : [
          miss.length ? `missing remotion: {${miss.map((u) => u.sym).join(', ')}}` : '',
          eco.length ? `ecosystem: ${[...new Set(eco.map((u) => u.pkg))].join(', ')}` : '',
        ].filter(Boolean).join('  ·  ');
    console.log(`  ${tag}  ${name.padEnd(22)} ${detail}`);
  }

  console.log('  ' + '─'.repeat(64));
  console.log(`  drop-in ready: ${ready}/${files.length} examples`);
  if (ecoPkgs.size) {
    console.log(`  ecosystem packages still missing:`);
    for (const [pkg, syms] of ecoPkgs) console.log(`    ${pkg} → {${[...syms].join(', ')}}`);
  }

  // Coverage of the core `remotion` package — the drop-in denominator.
  const core = remotionApi.filter((s) => s.pkg === 'remotion');
  console.log('\n  remotion API coverage');
  console.log('  ' + '─'.repeat(64));
  for (const tier of ['core', 'common', 'advanced'] as const) {
    const syms = core.filter((s) => s.tier === tier);
    const have = syms.filter((s) => isImpl(s.name)).length;
    console.log(`  ${tier.padEnd(9)} ${String(have).padStart(2)}/${syms.length}  (${Math.round((100 * have) / syms.length)}%)`);
  }
  const have = core.filter((s) => isImpl(s.name)).length;
  console.log(`  ${'TOTAL'.padEnd(9)} ${have}/${core.length}  (${Math.round((100 * have) / core.length)}%) of the remotion package`);
  const missing = core.filter((s) => (s.tier === 'core' || s.tier === 'common') && !isImpl(s.name)).map((s) => s.name);
  if (missing.length) console.log(`  not yet implemented (core/common): ${missing.join(', ')}`);
  console.log(`  + ecosystem: @remotion/transitions, @remotion/media-utils\n`);
}

main();
