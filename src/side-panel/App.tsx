import { useRef, useEffect, useState } from 'react';
import { useThreadData } from './hooks/useThreadData';
import { useParticipantFilter } from './hooks/useParticipantFilter';
import { useSearch } from './hooks/useSearch';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ChatThread } from './components/ChatThread';
import { SearchBar } from './components/SearchBar';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { LoadingState } from './components/LoadingState';
import { DevDownloads } from './components/DevDownloads';
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const [mailError, setMailError] = useState('');
  useEffect(() => setMailError(''), [threadData?.threadId]);
  /** Expanding and collapsing happen in the mail page; only it can do them. */
  function tellMailTab(type: string, failure: string) {
    setMailError('');
    if (threadData?.sourceTabId === undefined) return setMailError(failure);
    void chrome.tabs.sendMessage(threadData.sourceTabId, { type }).catch(() => setMailError(failure));
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
        <span className="text-sm font-semibold text-blue-600">ThreadLens{__DEV_TOOLS__ ? ' Dev' : ''}</span>
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
            {__DEV_TOOLS__ && <DevDownloads key={threadData.threadId} threadData={threadData} />}
            {threadData.client === 'gmail' && <>
              <button className="ml-2 text-blue-700 dark:text-blue-300 underline" title="Only if older history is missing: expand collapsed emails in Gmail and read them." onClick={() => tellMailTab('EXPAND_THREAD', 'Refresh the original mail tab to read collapsed emails.')}>Read collapsed emails</button>
              <button className="ml-2 text-blue-700 dark:text-blue-300 underline" title="Collapse the emails again in Gmail, leaving the mailbox as you found it. Everything already read stays in this panel." onClick={() => tellMailTab('COLLAPSE_THREAD', 'Refresh the original mail tab to collapse its emails.')}>Collapse emails again</button>
            </>}
            {mailError && <p role="alert" className="text-red-600">{mailError}</p>}
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
