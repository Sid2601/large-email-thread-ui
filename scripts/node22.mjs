/**
 * Vitest needs Node 22 and this machine's default node is older, so a command
 * that runs tests finds an installed Node 22 through nvm and re-runs itself on
 * it rather than failing halfway through with a module error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';

export const REQUIRED_MAJOR = 22;

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

/**
 * Returns on a new enough Node; otherwise re-runs `self` on one and exits with
 * its status. `command` names the npm script in the message a user has to act on.
 */
export function requireNode22(self, command) {
  if (Number(process.versions.node.split('.')[0]) >= REQUIRED_MAJOR) return;
  const binary = nvmNode();
  if (!binary) {
    console.error(`\n${command} needs Node ${REQUIRED_MAJOR} or newer; this shell has ${process.versions.node}.`);
    console.error(`Install one with "nvm install ${REQUIRED_MAJOR}", or run "nvm use ${REQUIRED_MAJOR}" before ${command}.\n`);
    process.exit(1);
  }
  console.log(`Node ${process.versions.node} is too old for the test runner; using ${binary}.`);
  // npm and vitest are started as child processes, so the whole run needs that
  // Node ahead of the inherited PATH, not only this script.
  const path = `${join(binary, '..')}${delimiter}${process.env.PATH ?? ''}`;
  process.exit(spawnSync(binary, [self, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PATH: path } }).status ?? 1);
}
