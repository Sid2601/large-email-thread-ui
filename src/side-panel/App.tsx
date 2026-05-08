import { useThreadData } from './hooks/useThreadData';
import { useParticipantFilter } from './hooks/useParticipantFilter';
import { useSearch } from './hooks/useSearch';
import { ChatThread } from './components/ChatThread';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { SearchBar } from './components/SearchBar';
import { LoadingState } from './components/LoadingState';
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const { selectedEmail, selectSender, filteredMessages: participantFiltered } = useParticipantFilter(threadData);
  const { query, setQuery, filteredMessages: searchedMessages } = useSearch(participantFiltered);

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
          <ParticipantSidebar
            participants={threadData.participants}
            selectedEmail={selectedEmail}
            onSelect={selectSender}
          />
          <SearchBar
            query={query}
            onChange={setQuery}
            resultCount={query ? searchedMessages.length : undefined}
          />
          <ChatThread messages={searchedMessages} searchQuery={query} />
        </>
      )}
    </div>
  );
}
