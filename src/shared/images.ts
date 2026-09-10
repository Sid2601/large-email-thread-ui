/** Raster data only; SVG/script-bearing data is never embedded. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function safeImageSource(raw: string): string {
  if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(raw) && raw.length < MAX_IMAGE_BYTES * 1.4) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    if (url.protocol === 'blob:' && /^https:\/\/(?:mail\.google\.com|outlook\.(?:live|office|office365)\.com)$/.test(url.origin)) return url.href;
  } catch { /* Missing or cid-only images are unavailable without provider data. */ }
  return '';
}
export function rasterMime(mime: string): boolean { return /^image\/(png|jpeg|gif|webp|avif)(?:;|$)/i.test(mime); }
export async function imageResponse(response: Response): Promise<string> {
  const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!response.ok || !rasterMime(mime)) throw new Error('Image is unavailable or is not a supported raster image.');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image exceeds 8 MB.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty image response.');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image exceeds 8 MB.'); }
    chunks.push(value);
  }
  const blob = new Blob(chunks, { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
