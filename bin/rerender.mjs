#!/usr/bin/env node
// `rerender` CLI launcher — runs the TS entry through the tsx loader.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const child = spawn(process.execPath, ['--import', 'tsx', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
