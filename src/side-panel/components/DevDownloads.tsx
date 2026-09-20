import { useState } from 'react';
import type { ThreadData } from '../../types';
import { downloadConversation } from '../export/conversation';
import { downloadThreadSource } from '../export/capture';

/** Mounted only in the development build; all download code is removed from production. */
export function DevDownloads({ threadData }: { threadData: ThreadData }) {
  const [exporting, setExporting] = useState<'' | 'light' | 'masked' | 'source-masked' | 'source-original'>('');
  const [exportError, setExportError] = useState('');
  const [sourceReport, setSourceReport] = useState<{ faithful: boolean; text: string } | null>(null);

  async function saveThreadSource(masked: boolean) {
    setExporting(masked ? 'source-masked' : 'source-original');
    setExportError(''); setSourceReport(null);
    try {
      const fidelity = await downloadThreadSource(threadData, { masked });
      setSourceReport({ faithful: fidelity.sameStructure && fidelity.orderIndependent,
        text: `${fidelity.summary}${fidelity.differences.length ? ` Differences: ${fidelity.differences.slice(0, 3).join('; ')}` : ''}` });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not read the mail page. Refresh the original tab and try again.');
    } finally { setExporting(''); }
  }
  return <>
    <button
      type="button"
      className="mt-2 mb-1 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
      title="Download the messages as a small file: no image or attachment data is written, and each inline image is replaced by its filename (for example image-1.png)."
      disabled={exporting !== ''}
      onClick={async () => {
        setExporting('light');
        setExportError('');
        try { await downloadConversation(threadData, { includeImages: false }); }
        catch { setExportError('Could not export the conversation. Please try again.'); }
        finally { setExporting(''); }
      }}
    >{exporting === 'light' ? 'Preparing file…' : '↓ Text only (no images)'}</button>
    <button
      type="button"
      className="mt-2 mb-1 ml-2 rounded border border-amber-300 dark:border-amber-700 px-2 py-1.5 text-amber-800 dark:text-amber-300 font-medium hover:bg-amber-50 dark:hover:bg-gray-800 disabled:opacity-60"
      title="Download the same messages with every name, email address, company domain, phone number and link replaced by a consistent placeholder such as Person 1. Images and attachment data are not included. Message wording, order, timestamps and formatting are unchanged, so the file is safe to share for diagnosis."
      disabled={exporting !== ''}
      onClick={async () => {
        setExporting('masked');
        setExportError('');
        try { await downloadConversation(threadData, { mask: true }); }
        catch { setExportError('Could not export the masked conversation. Please try again.'); }
        finally { setExporting(''); }
      }}
    >{exporting === 'masked' ? 'Masking identities…' : '↓ Masked copy (share-safe)'}</button>
    {exportError && <p role="alert" className="text-red-600">{exportError}</p>}
    <details className="mt-2">
      <summary className="cursor-pointer text-gray-600 dark:text-gray-400">Report a parsing problem</summary>
      <p className="mt-1">Saves the mail page's own markup for this conversation — exactly what ThreadLens reads — so a wrong split, a repeated email or a missing one can be reproduced. The masked copy carries no real name, address, link or picture and is the one to send; the original stays on this computer for comparison. Both are checked against each other before they are written.</p>
      <button
        type="button"
        className="mt-2 mb-1 rounded border border-amber-300 dark:border-amber-700 px-2 py-1.5 text-amber-800 dark:text-amber-300 font-medium hover:bg-amber-50 dark:hover:bg-gray-800 disabled:opacity-60"
        title="Download the provider markup for every email in this thread with every identity replaced by a placeholder. Message wording, structure, clocks, ordering and picture identity are unchanged, so the file still reproduces a parsing problem."
        disabled={exporting !== ''}
        onClick={() => { void saveThreadSource(true); }}
      >{exporting === 'source-masked' ? 'Reading the mail page…' : '↓ Thread source (masked)'}</button>
      <button
        type="button"
        className="mt-2 mb-1 ml-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
        title="Download the same markup unmasked, with real names and addresses in it. Keep this copy locally to check what the masked copy replaced; do not send it."
        disabled={exporting !== ''}
        onClick={() => { void saveThreadSource(false); }}
      >{exporting === 'source-original' ? 'Reading the mail page…' : '↓ Thread source (original, private)'}</button>
      {sourceReport && <p role="status" className={sourceReport.faithful ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>{sourceReport.text}</p>}
    </details>
  </>;
}
