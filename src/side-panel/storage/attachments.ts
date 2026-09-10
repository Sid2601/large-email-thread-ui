/** Attachment bytes stay on this device. Nothing is saved automatically. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_CACHE_BYTES = 100 * 1024 * 1024;
interface SavedAttachment { key: string; blob: Blob; savedAt: number }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('threadlens-attachments', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function savedAttachment(key: string): Promise<Blob | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('files').objectStore('files').get(key);
      req.onsuccess = () => resolve((req.result as SavedAttachment | undefined)?.blob);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
export async function saveAttachment(key: string, blob: Blob): Promise<void> {
  if (blob.size > MAX_FILE_BYTES) throw new Error('File exceeds the 20 MB local-save limit.');
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const request = store.getAll();
      let reason = 'Could not save the file. Browser storage may be full.';
      request.onsuccess = () => {
        const used = (request.result as SavedAttachment[]).reduce((n, file) => n + (file.key === key ? 0 : file.blob.size), 0);
        if (used + blob.size > MAX_CACHE_BYTES) { reason = 'Local attachment storage is full (100 MB). Remove saved files first.'; tx.abort(); return; }
        store.put({ key, blob, savedAt: Date.now() } satisfies SavedAttachment);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally { db.close(); }
}
export async function removeAttachment(key: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function attachmentUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}
export async function fetchAttachment(raw: string): Promise<Blob> {
  const url = attachmentUrl(raw);
  if (!url) throw new Error('No accessible file link. Open the original email or choose a downloaded file.');
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !attachmentUrl(response.url) || /text\/html/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('The provider requires opening this file in email. Download it there, then choose the downloaded file.');
  }
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('File exceeds the 20 MB local-save limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The provider returned no file.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new Error('File exceeds the 20 MB local-save limit.'); }
    chunks.push(value);
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
}
