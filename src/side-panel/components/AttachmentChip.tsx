import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '../../types';
import { attachmentUrl, fetchAttachment, savedAttachment, saveAttachment, removeAttachment } from '../storage/attachments';

export function AttachmentChip({ attachment, messageId }: { attachment: Attachment; messageId: string }) {
  const key = `${messageId}:${attachment.name}:${attachment.sizeLabel}`;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const url = attachmentUrl(attachment.downloadUrl);
  useEffect(() => {
    let active = true;
    savedAttachment(key).then(blob => { if (active) setSaved(!!blob); }).catch(() => { if (active) setError('Local storage is unavailable.'); });
    return () => { active = false; };
  }, [key]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to access this file.'); }
    finally { setBusy(false); }
  }
  async function downloadSaved() {
    const blob = await savedAttachment(key);
    if (!blob) { setSaved(false); throw new Error('Saved file is no longer available.'); }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl; a.download = attachment.name; a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return (
    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-xs max-w-full">
      <div className="flex gap-2 items-center"><span aria-hidden="true">📎</span><span className="break-all flex-1">{attachment.name}</span><span>{attachment.sizeLabel}</span></div>
      <div className="flex flex-wrap gap-3 mt-2 text-blue-600 dark:text-blue-300">
        {url && <a href={url} target="_blank" rel="noopener noreferrer">Open in email</a>}
        {saved ? <>
          <button disabled={busy} onClick={() => void run(downloadSaved)}>Download saved file</button>
          <button disabled={busy} onClick={() => void run(async () => { await removeAttachment(key); setSaved(false); })}>Remove local copy</button>
        </> : <>
          {url && <button disabled={busy} onClick={() => void run(async () => { await saveAttachment(key, await fetchAttachment(url)); setSaved(true); })}>Save locally</button>}
          <button disabled={busy} onClick={() => input.current?.click()}>Choose downloaded file</button>
        </>}
      </div>
      <input ref={input} type="file" className="hidden" aria-label={`Choose downloaded copy of ${attachment.name}`} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void run(async () => {
          if (file.name !== attachment.name) throw new Error(`Choose the file named ${attachment.name}.`);
          await saveAttachment(key, file); setSaved(true);
        });
      }} />
      {busy && <p role="status" className="mt-1">Working…</p>}
      {saved && <p className="mt-1 text-gray-500">Saved on this device</p>}
      {error && <p role="alert" className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
