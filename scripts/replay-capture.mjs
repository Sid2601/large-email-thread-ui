/**
 * Reads a thread-source capture back through the real parser: `npm run replay -- <file.json>`.
 *
 * A masked capture is the whole point of the file — it can be sent to whoever is
 * diagnosing a problem, and this command shows them the conversation the parser
 * makes of it, message by message, without a browser or a mailbox.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireNode22 } from './node22.mjs';

requireNode22(fileURLToPath(import.meta.url), 'npm run replay');

const [file] = process.argv.slice(2);
if (!file) {
  console.error('\nUsage: npm run replay -- <ThreadLens-…-source-masked.json>\n');
  process.exit(1);
}
const path = resolve(file);
if (!existsSync(path)) {
  console.error(`\nNo capture at ${path}\n`);
  process.exit(1);
}
const run = spawnSync('npx', ['vitest', 'run', 'tests/capture-file.ts', '--disable-console-intercept'],
  { stdio: 'inherit', env: { ...process.env, THREADLENS_CAPTURE: path } });
process.exit(run.status ?? 1);
