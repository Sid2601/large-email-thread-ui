import { imageResponse, safeImageSource } from '../../shared/images';
const cache = new Map<string, Promise<string>>();
let active = 0;
const waiters: (() => void)[] = [];
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve));
  active++;
  try { return await task(); } finally { active--; waiters.shift()?.(); }
}
/** Session-only cache; at most two image fetches run together. */
export function loadInlineImage(raw: string, tabId?: number): Promise<string> {
  const src = safeImageSource(raw);
  if (!src) return Promise.reject(new Error('Image is unavailable.'));
  if (src.startsWith('data:')) return Promise.resolve(src);
  const key = `${tabId}:${src}`;
  if (cache.has(key)) return cache.get(key)!;
  const promise = limited(async () => {
    if (src.startsWith('blob:')) {
      if (tabId === undefined) throw new Error('Original email tab is unavailable.');
      const result = await chrome.runtime.sendMessage({ type: 'READ_PAGE_IMAGE', tabId, url: src });
      if (!result?.data || !safeImageSource(result.data).startsWith('data:')) throw new Error(result?.error || 'Image unavailable.');
      return result.data as string;
    }
    return imageResponse(await fetch(src, { credentials: 'include', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) }));
  });
  cache.set(key, promise);
  void promise.then(data => {
    // Retain only a small recent set; large images are not held after delivery.
    if (data.length > 2 * 1024 * 1024) cache.delete(key);
    while (cache.size > 16) cache.delete(cache.keys().next().value!);
  }, () => cache.delete(key));
  return promise;
}
export async function embedImages(html: string, tabId?: number) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let missing = 0, bytes = 0;
  const loaded = new Map<string, string>();
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const source = img.getAttribute('src') || img.getAttribute('data-tl-image-src') || '';
    try {
      const data = loaded.get(source) || await loadInlineImage(source, tabId);
      bytes += data.length;
      if (bytes > 50 * 1024 * 1024) throw new Error('Embedding limit reached.');
      loaded.set(source, data); img.setAttribute('src', data); img.removeAttribute('data-tl-image-src');
    } catch {
      missing++;
      const notice = doc.createElement('span'); notice.textContent = ` [Image not embedded: ${img.getAttribute('alt') || 'inline image'}. Open the original email if it does not display.]`;
      img.after(notice);
    }
  }
  if (missing) {
    const note = doc.createElement('p'); note.setAttribute('class', 'meta');
    note.textContent = `${missing} image(s) could not be embedded. Available HTTPS sources were retained and may require an internet connection or email login.`;
    doc.querySelector('.overview')?.append(note);
  }
  return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, missing };
}

const IMAGE_FILENAME = /\.(png|jpe?g|gif|webp|avif)$/i;
/** Names an image for a placeholder: the source's own filename when it has one, else image-N. */
export function inlineImageName(source: string, index: number): string {
  try {
    const base = decodeURIComponent(new URL(source).pathname.split('/').pop() || '').replace(/\s+/g, '-');
    if (IMAGE_FILENAME.test(base) && base.length <= 80) return base;
  } catch { /* blob:, data: and cid: sources carry no filename. */ }
  const mime = /^data:image\/([a-z0-9]+)/i.exec(source)?.[1].toLowerCase();
  return `image-${index}.${mime === 'jpeg' ? 'jpg' : mime && /^(png|gif|webp|avif)$/.test(mime) ? mime : 'png'}`;
}
/** A small export for testing: every image becomes its filename, so no bytes and no expiring URLs are written. */
export function stripImages(html: string): { html: string; replaced: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));
  images.forEach((img, index) => {
    const name = inlineImageName(img.getAttribute('src') || img.getAttribute('data-tl-image-src') || '', index + 1);
    const alt = (img.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const placeholder = doc.createElement('span');
    placeholder.setAttribute('class', 'image-placeholder');
    placeholder.setAttribute('data-image-name', name);
    placeholder.textContent = alt && alt.toLowerCase() !== 'inline image' ? `${name} — ${alt}` : name;
    img.replaceWith(placeholder);
  });
  if (images.length) {
    const note = doc.createElement('p'); note.setAttribute('class', 'meta');
    note.textContent = `${images.length} inline image(s) replaced by their filenames. This copy holds no image or attachment data; export with images for a complete record.`;
    doc.querySelector('.overview')?.append(note);
  }
  return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, replaced: images.length };
}
