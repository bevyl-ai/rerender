#!/usr/bin/env node
// `rerender` CLI launcher — runs the TS entry through the tsx loader under Node.
// Always spawn `node`, not process.execPath: `bun bin/rerender.mjs` would otherwise
// re-exec Bun, which cannot load `--import tsx`.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const node = typeof process.versions.bun === 'string' ? 'node' : process.execPath;
const child = spawn(node, ['--import', 'tsx', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
