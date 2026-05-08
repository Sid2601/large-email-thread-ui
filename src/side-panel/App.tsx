import { useRef } from 'react';
import { useThreadData } from './hooks/useThreadData';
import { useParticipantFilter } from './hooks/useParticipantFilter';
import { useSearch } from './hooks/useSearch';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ChatThread } from './components/ChatThread';
import { SearchBar } from './components/SearchBar';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { LoadingState } from './components/LoadingState';
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const { selectedEmail, selectSender, filteredMessages } = useParticipantFilter(threadData);
  const { query, setQuery, filteredMessages: searchedMessages } = useSearch(filteredMessages);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcuts({
    onFocusSearch: () => searchInputRef.current?.focus(),
    onClearSearch: () => setQuery(''),
    scrollThreadRef: scrollRef,
  });

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 shrink-0">
        <span className="text-sm font-semibold text-blue-600">ThreadLens</span>
        {threadData && (
          <span className="text-xs text-gray-400 truncate">
            {threadData.messages.length} messages
          </span>
        )}
        <span className="text-xs text-gray-300 ml-auto shrink-0">v{__APP_VERSION__}</span>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : !threadData ? (
        <EmptyState />
      ) : (
        <>
          <ParticipantSidebar
            participants={threadData.participants}
            selectedEmail={selectedEmail}
            onSelect={selectSender}
          />
          <SearchBar ref={searchInputRef} query={query} onChange={setQuery} />
          <ChatThread ref={scrollRef} messages={searchedMessages} />
        </>
      )}

      {/* Keyboard shortcut hint */}
      <div className="text-xs text-gray-300 dark:text-gray-600 text-center py-1 shrink-0 bg-gray-50 border-t border-gray-100">
        Ctrl+F to search · J/K to scroll
      </div>
    </div>
  );
}
