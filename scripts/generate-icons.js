import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '../public/icons');

mkdirSync(ICONS_DIR, { recursive: true });

// Chat bubble icon: blue circle background, white speech bubble with blue dots
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="#2563eb"/>
  <path d="M25 30 Q25 20 35 20 L65 20 Q75 20 75 30 L75 55 Q75 65 65 65 L55 65 L50 75 L45 65 L35 65 Q25 65 25 55 Z" fill="white"/>
  <circle cx="38" cy="42" r="5" fill="#2563eb"/>
  <circle cx="50" cy="42" r="5" fill="#2563eb"/>
  <circle cx="62" cy="42" r="5" fill="#2563eb"/>
</svg>`;

const sizes = [16, 48, 128];

for (const size of sizes) {
  const pngBuffer = await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(ICONS_DIR, `icon${size}.png`), pngBuffer);
  console.log(`Generated icon${size}.png (${pngBuffer.length} bytes)`);
}

console.log('Done — all icons written to public/icons/');
