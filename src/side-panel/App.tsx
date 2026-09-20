import { useRef, useEffect, useState } from 'react';
import { useThreadData } from './hooks/useThreadData';
import { useParticipantFilter } from './hooks/useParticipantFilter';
import { useSearch } from './hooks/useSearch';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ChatThread } from './components/ChatThread';
import { SearchBar } from './components/SearchBar';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { LoadingState } from './components/LoadingState';
import { downloadConversation } from './export/conversation';
import { downloadThreadSource } from './export/capture';
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const [exporting, setExporting] = useState<'' | 'light' | 'masked' | 'source-masked' | 'source-original'>('');
  const [exportError, setExportError] = useState('');
  const [sourceReport, setSourceReport] = useState<{ faithful: boolean; text: string } | null>(null);
  useEffect(() => { setExportError(''); setSourceReport(null); }, [threadData?.threadId]);

  async function saveThreadSource(masked: boolean) {
    if (!threadData) return;
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
  /** Expanding and collapsing happen in the mail page; only it can do them. */
  function tellMailTab(type: string, failure: string) {
    setExportError('');
    if (threadData?.sourceTabId === undefined) return setExportError(failure);
    void chrome.tabs.sendMessage(threadData.sourceTabId, { type }).catch(() => setExportError(failure));
  }

  const { selectedEmail, selectSender, filteredMessages: participantFiltered } = useParticipantFilter(threadData);
  const { query, setQuery, filteredMessages: searchedMessages } = useSearch(participantFiltered);

  useEffect(() => setQuery(''), [threadData?.threadId, setQuery]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcuts({
    onFocusSearch: () => searchInputRef.current?.focus(),
    onClearSearch: () => setQuery(''),
    scrollThreadRef: scrollRef,
  });

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-sm font-semibold text-blue-600">ThreadLens</span>
        {threadData && (
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            {threadData.messages.length} messages
          </span>
        )}
        <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto shrink-0">v{__APP_VERSION__}</span>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : !threadData ? (
        <EmptyState />
      ) : (
        <>
          <div className="px-3 py-2 border-b text-xs text-gray-500">
            <p className="font-semibold text-gray-800 dark:text-gray-100">{threadData.subject}</p>
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
            {threadData.client === 'gmail' && <>
              <button className="ml-2 text-blue-700 dark:text-blue-300 underline" title="Only if older history is missing: expand collapsed emails in Gmail and read them." onClick={() => tellMailTab('EXPAND_THREAD', 'Refresh the original mail tab to read collapsed emails.')}>Read collapsed emails</button>
              <button className="ml-2 text-blue-700 dark:text-blue-300 underline" title="Collapse the emails again in Gmail, leaving the mailbox as you found it. Everything already read stays in this panel." onClick={() => tellMailTab('COLLAPSE_THREAD', 'Refresh the original mail tab to collapse its emails.')}>Collapse emails again</button>
            </>}
            {exportError && <p role="alert" className="text-red-600">{exportError}</p>}
            <p className="mt-1">Includes history quoted in the emails available here. Earlier messages or files omitted by the sender cannot be recovered.</p>
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
          </div>
          <ParticipantSidebar
            participants={threadData.participants}
            selectedEmail={selectedEmail}
            onSelect={selectSender}
          />
          <SearchBar
            ref={searchInputRef}
            query={query}
            onChange={setQuery}
            resultCount={query ? searchedMessages.length : undefined}
          />
          <ChatThread tabId={threadData.sourceTabId} participation={threadData.participation} ref={scrollRef} messages={searchedMessages} searchQuery={query} />
        </>
      )}

      {/* Keyboard shortcut hint */}
      <div className="text-xs text-gray-300 dark:text-gray-600 text-center py-1 shrink-0 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
        Ctrl+F to search · J/K to scroll
      </div>
    </div>
  );
}
