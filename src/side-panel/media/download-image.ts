import { loadInlineImage, inlineImageName } from './images';
import { saveFile } from '../export/download';

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif)$/i;
/** Keep a useful name, but use the downloaded image's format for its extension. */
export function imageDownloadName(source: string, alt: string, mime: string): string {
  const sourceName = inlineImageName(source, 1);
  const label = alt.trim();
  const candidate = IMAGE_EXTENSION.test(label) ? label
    : !/^image-1\./.test(sourceName) ? sourceName
    : label && !/^inline image$/i.test(label) ? label : 'inline-image';
  const stem = candidate.replace(IMAGE_EXTENSION, '').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).trim();
  const extension = mime.toLowerCase() === 'image/jpeg' ? 'jpg' : mime.toLowerCase().split('/')[1];
  return `${stem || 'inline-image'}.${extension}`;
}

/** Save the original raster bytes on demand; reuse the viewer's authenticated image loader. */
export async function downloadInlineImage(source: string, alt: string, tabId?: number): Promise<void> {
  const data = await loadInlineImage(source, tabId);
  const match = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=\s]+)$/i.exec(data);
  if (!match) throw new Error('This image format cannot be downloaded. Open it in the original email.');
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), character => character.charCodeAt(0));
  saveFile(imageDownloadName(source, alt, match[1]), new Blob([bytes], { type: match[1].toLowerCase() }));
}
