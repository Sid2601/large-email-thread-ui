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
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const [exporting, setExporting] = useState<'' | 'full' | 'light'>('');
  const [exportError, setExportError] = useState('');
  useEffect(() => setExportError(''), [threadData?.threadId]);
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
              className="mt-2 mb-1 rounded border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-blue-700 dark:text-blue-300 font-medium hover:bg-blue-50 dark:hover:bg-gray-800 disabled:opacity-60"
              title="Download all recovered messages as one HTML file, including formatting, available inline images and attachment names. Other attachment files are downloaded separately."
              disabled={exporting !== ''}
              onClick={async () => {
                setExporting('full');
                setExportError('');
                try { const missing = await downloadConversation(threadData); if (missing) setExportError(`${missing} image(s) could not be embedded; the export explains which images need email access.`); }
                catch { setExportError('Could not export the conversation. Please try again.'); }
                finally { setExporting(''); }
              }}
            >{exporting === 'full' ? 'Preparing images…' : '↓ Download conversation (.html)'}</button>
            <button
              type="button"
              className="mt-2 mb-1 ml-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
              title="Download the same messages as a small file for testing: no image or attachment data is written, and each inline image is replaced by its filename (for example image-1.png)."
              disabled={exporting !== ''}
              onClick={async () => {
                setExporting('light');
                setExportError('');
                try { await downloadConversation(threadData, { includeImages: false }); }
                catch { setExportError('Could not export the conversation. Please try again.'); }
                finally { setExporting(''); }
              }}
            >{exporting === 'light' ? 'Preparing file…' : '↓ Text only (no images)'}</button>
            {threadData.client === 'gmail' && <button className="ml-2 text-blue-700 dark:text-blue-300 underline" title="Only if older history is missing: expand collapsed emails in Gmail and read them." onClick={() => { if (threadData.sourceTabId !== undefined) void chrome.tabs.sendMessage(threadData.sourceTabId, { type: 'EXPAND_THREAD' }).catch(() => setExportError('Refresh the original mail tab to read collapsed emails.')); }}>Read collapsed emails</button>}
            {exportError && <p role="alert" className="text-red-600">{exportError}</p>}
            <p className="mt-1">Includes history quoted in the emails available here. Earlier messages or files omitted by the sender cannot be recovered.</p>
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
