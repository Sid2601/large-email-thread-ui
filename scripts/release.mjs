/**
 * One command for a loadable release: `npm run release`.
 *
 * Runs the whole gate in order — typecheck, tests, production build, then the
 * packager — and leaves both a ZIP and an already-extracted folder in
 * releases/. Vitest needs Node 22, and this machine's default node is older,
 * so the runner finds an installed Node 22 through nvm and re-runs itself on
 * it rather than failing halfway through with a module error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_MAJOR = 22;
const self = fileURLToPath(import.meta.url);
const major = Number(process.versions.node.split('.')[0]);

/** The newest installed Node that is new enough, as nvm lays them out. */
function nvmNode() {
  const root = join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions', 'node');
  if (!existsSync(root)) return '';
  const usable = readdirSync(root)
    .filter(name => Number(name.replace(/^v/, '').split('.')[0]) >= REQUIRED_MAJOR)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const newest = usable.pop();
  const binary = newest && join(root, newest, 'bin', 'node');
  return binary && existsSync(binary) ? binary : '';
}

if (major < REQUIRED_MAJOR) {
  const binary = nvmNode();
  if (!binary) {
    console.error(`\nThis release needs Node ${REQUIRED_MAJOR} or newer; this shell has ${process.versions.node}.`);
    console.error(`Install one with "nvm install ${REQUIRED_MAJOR}", or run "nvm use ${REQUIRED_MAJOR}" before npm run release.\n`);
    process.exit(1);
  }
  console.log(`Node ${process.versions.node} is too old for the test runner; using ${binary}.`);
  // npm and vitest are started as child processes, so the whole run needs that
  // Node ahead of the inherited PATH, not only this script.
  const path = `${join(binary, '..')}${delimiter}${process.env.PATH ?? ''}`;
  process.exit(spawnSync(binary, [self, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PATH: path } }).status ?? 1);
}

const steps = [
  ['Typecheck', 'npm', ['run', '--silent', 'typecheck']],
  ['Tests', 'npm', ['run', '--silent', 'test']],
  ['Build', 'npm', ['run', '--silent', 'build']],
  ['Package', 'python3', ['scripts/package-release.py']],
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

console.log(`\n✅ Release ready\n`);
if (summary.folder) console.log(`   Load unpacked : ${summary.folder}`);
if (summary.zip) console.log(`   Share the ZIP : ${summary.zip}`);
if (summary.sha256) console.log(`   SHA-256       : ${summary.sha256}`);
console.log(`\n   chrome://extensions → Developer mode → Load unpacked → select the folder above.`);
console.log(`   Already loaded? Press Reload on the ThreadLens card instead, then refresh Gmail.\n`);
