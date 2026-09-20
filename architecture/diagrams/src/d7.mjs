import { C, svg, title, panel, box, arrow, label, footer, text, rect, tint } from './svg-kit.mjs';
const W = 1480, H = 840, o = [];
o.push(title(44, 56, 'ThreadLens — build flavours, release gate and what guards the product',
  'One source tree, two packages; the difference is chosen at build time and the code for the other flavour is not emitted'));
const h = n => 42 + (n - 1) * 17 + 14;
const card = (x, y, w, t, lines, color) => o.push(box(x, y, w, h(lines.length), t, lines, color));

o.push(panel(40, 100, 700, 400, 'A · Two packages from one source', C.blue));
card(60, 136, 320, 'ThreadLens Dev  ·  dist-dev/', [
  '__DEV_TOOLS__ = true',
  'conversation export · masked copy',
  'thread-source capture (both copies)',
  'replay + fidelity reporting',
  'attachments, images, search, all of it',
], C.blue);
card(400, 136, 320, 'ThreadLens  ·  dist/', [
  '__DEV_TOOLS__ = false',
  'no export UI, no masking code,',
  'no CAPTURE_THREAD_SOURCE handler',
  'attachments, images, search, history',
  'recovery — all present and unchanged',
], C.green);
card(60, 316, 660, 'The switch', [
  'vite.config.ts: devTools = (mode === "development")   →   define __DEV_TOOLS__ and __APP_VERSION__',
  'import.meta.env.DEV is false for both optimised builds, so it is never used for this decision',
  'dead-code elimination removes the other flavour entirely — there is no runtime toggle to flip',
  'manifest name, output folder and package name all follow from the same flag',
], C.slate);

o.push(panel(760, 100, 680, 400, 'B · Release gate — npm run package:dev | package:prod', C.orange));
const steps = [
  ['1 · typecheck', 'tsc --noEmit'],
  ['2 · tests', '251 assertions (vitest, jsdom)'],
  ['3 · build', 'vite build --mode development | production'],
  ['4 · package', 'scripts/package-release.py inspects the emitted bundle'],
  ['5 · publish locally', 'versioned ZIP + extracted folder + INSTALL.txt + SHA-256'],
];
let y = 136;
for (const [t, sub] of steps) {
  o.push(box(780, y, 640, 54, t, [sub], C.orange));
  if (y < 400) o.push(arrow(`M1100 ${y + 55} V${y + 66}`, { color: C.orange, sw: 1.8 }));
  y += 68;
}
o.push(text(780, 478, 'Any failing step stops the pipeline — nothing is released.', { size: 12, weight: 600, fill: C.red }));

o.push(panel(40, 530, 1400, 194, 'C · What the packager and the suites actually check', C.purple));
card(60, 566, 440, 'Packaging refuses to write a ZIP when…', [
  'the production bundle still contains an export control',
  'or the diagnostic capture request',
  'either bundle is missing the attachment controls',
  'the manifest version disagrees with package.json',
  'a declared icon, page or script is missing from the build',
], C.purple);
card(520, 566, 440, 'Automated suites (tests/)', [
  'verify · regressions · enterprise-cases · reader-adapters',
  'expansion-stability · participant-identity · inline-images',
  'image-download · conversation-export · masked-export',
  'reader-order · thread-source-capture · capture-file',
  'all fixtures are synthetic — no customer mail is committed',
], C.purple);
card(980, 566, 460, 'Browser checks (Playwright + Chromium)', [
  'smoke-packages.mjs loads both delivered folders and drives',
  'them against synthetic Gmail: images, tables, search,',
  'attachments (save, reload, download, remove, import),',
  'and proves the production package exposes no export path',
  'smoke-extension.mjs covers the wider dev flow',
], C.purple);
o.push(footer(44, 774, 'Releases are local artefacts: releases/threadlens-<version>-<flavour>.zip, an already-extracted folder for Load unpacked, and SHA256SUMS.txt. Nothing is uploaded anywhere.'));
o.push(footer(44, 800, 'Node 22 or newer and Python 3 are required; the release script re-runs itself on an nvm-installed Node 22 when the shell default is older.'));
process.stdout.write(svg(W, H, o.join('\n')));
