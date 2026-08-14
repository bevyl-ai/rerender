// Guards the npm dist against license contamination: every import in dist/*.js must
// be relative (our own MIT code) or one of the declared externals. In particular the
// real `remotion` devDependency must never be inlined or imported — its license does
// not permit redistribution.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set(['react', 'react-dom', 'react/jsx-runtime', 'mediabunny', '@mediabunny/aac-encoder']);
const DIST = new URL('../dist', import.meta.url).pathname;

const violations = [];
for (const file of readdirSync(DIST).filter((name) => name.endsWith('.js'))) {
  const code = readFileSync(join(DIST, file), 'utf8');
  for (const match of code.matchAll(/from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1] ?? match[2];
    if (specifier.startsWith('.') || ALLOWED.has(specifier)) continue;
    violations.push(`${file}: ${specifier}`);
  }
}

if (violations.length > 0) {
  console.error(`dist imports outside the allowlist:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('check-dist: all dist imports are relative or allowlisted externals');
