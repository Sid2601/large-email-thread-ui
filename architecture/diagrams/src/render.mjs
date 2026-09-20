/**
 * Regenerate every architecture diagram: SVG from its source script, then a 2× PNG.
 *
 *   node architecture/diagrams/src/render.mjs            # all of them
 *   node architecture/diagrams/src/render.mjs 04         # just one, by number
 *
 * Run from the project root. Requires the dev dependencies (sharp) to be installed.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const DIAGRAMS = [
  ['d1.mjs', '01-system-architecture'],
  ['d2.mjs', '02-message-lifecycle'],
  ['d3.mjs', '03-message-splitting'],
  ['d4.mjs', '04-reconciliation-and-ordering'],
  ['d5.mjs', '05-images-and-attachments'],
  ['d6.mjs', '06-exports-and-diagnostics'],
  ['d7.mjs', '07-build-and-release'],
];
const only = process.argv.slice(2);
await mkdir(out, { recursive: true });
for (const [script, name] of DIAGRAMS) {
  if (only.length && !only.some(arg => name.includes(arg))) continue;
  // Each source script writes its SVG to stdout; import it and capture that write.
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = chunk => { chunks.push(chunk); return true; };
  try { await import(`${join(here, script)}?v=${Date.now()}`); } finally { process.stdout.write = write; }
  const svg = chunks.join('');
  await writeFile(join(out, `${name}.svg`), svg);
  await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile(join(out, `${name}.png`));
  console.log(`${name}.svg + .png`);
}
