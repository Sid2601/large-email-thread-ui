import { useThreadData } from './hooks/useThreadData';
import { useParticipantFilter } from './hooks/useParticipantFilter';
import { ChatThread } from './components/ChatThread';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { LoadingState } from './components/LoadingState';
import { EmptyState } from './components/EmptyState';

export default function App() {
  const { threadData, isLoading } = useThreadData();
  const { selectedEmail, selectSender, filteredMessages } = useParticipantFilter(threadData);

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
          <ChatThread messages={filteredMessages} />
        </>
      )}
    </div>
  );
}
