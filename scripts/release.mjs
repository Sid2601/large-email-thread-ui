/**
 * Build and package one flavor: `npm run release:dev` or `npm run release:prod`.
 *
 * Runs the whole gate in order — typecheck, tests, optimized flavor build, then the
 * packager — and leaves both a ZIP and an already-extracted folder in
 * releases/.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireNode22 } from './node22.mjs';

requireNode22(fileURLToPath(import.meta.url), 'npm run release');

const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some(flag => !['--dev', '--prod'].includes(flag))) {
  console.error('Usage: node scripts/release.mjs [--dev|--prod]');
  process.exit(1);
}
const channel = flags[0] === '--dev' ? 'dev' : 'prod';
console.log(`Preparing ${channel === 'dev' ? 'development (downloads enabled)' : 'production (downloads disabled)'} package.`);
const steps = [
  ['Typecheck', 'npm', ['run', '--silent', 'typecheck']],
  ['Tests', 'npm', ['run', '--silent', 'test']],
  ['Build', 'npm', ['run', '--silent', `build:${channel}`]],
  ['Package', 'python3', ['scripts/package-release.py', `--${channel}`]],
];

const summary = {};
for (const [name, command, args] of steps) {
  console.log(`\n── ${name} ──`);
  const capture = name === 'Package';
  const run = spawnSync(command, args, { stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (capture && run.stdout) {
    for (const line of run.stdout.split('\n')) {
      const tag = /^::(zip|folder|sha256) (.+)$/.exec(line.trim());
      if (tag) summary[tag[1]] = tag[2]; else if (line.trim()) console.log(line);
    }
  }
  if (run.status !== 0) {
    console.error(`\n${name} failed — nothing was released.`);
    process.exit(run.status ?? 1);
  }
}

console.log(`\n✅ ${channel} release ready\n`);
if (summary.folder) console.log(`   Load unpacked : ${summary.folder}`);
if (summary.zip) console.log(`   Share the ZIP : ${summary.zip}`);
if (summary.sha256) console.log(`   SHA-256       : ${summary.sha256}`);
console.log(`\n   chrome://extensions → Developer mode → Load unpacked → select the folder above.`);
console.log(`   Already using this folder? Press Reload, then refresh Gmail. Switching flavors? Load unpacked from the matching folder.\n`);
