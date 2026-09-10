import { useRef, useEffect, forwardRef, Fragment } from 'react';
import type { ParsedMessage, ThreadData } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  messages: ParsedMessage[];
  tabId?: number;
  participation?: ThreadData['participation'];
  searchQuery?: string;
}

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread({ messages, participation, tabId, searchQuery = '' }, ref) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    if (messages.length === 0) {
      return (
        <div className="flex items-center justify-center flex-1 text-sm text-gray-400 dark:text-gray-500">
          No messages from this participant.
        </div>
      );
    }

    return (
      <div ref={ref} className="flex-1 overflow-y-auto py-3 bg-gray-50 dark:bg-gray-900">
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showSenderName = !msg.isCurrentUser && (
            !prev || prev.sender.email !== msg.sender.email
          );
          return (
            <Fragment key={msg.id}>
            {participation?.messageId === msg.id && <section className="mx-3 my-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-gray-800 p-3 text-xs" aria-label="Thread participation">
              <p className="font-semibold text-blue-700 dark:text-blue-300">{participation.title}</p>
              <p className="mt-1 text-gray-600 dark:text-gray-300">{participation.detail}</p>
            </section>}
            <MessageBubble
              message={msg}
              tabId={tabId}
              showSenderName={showSenderName}
              searchQuery={searchQuery}
            />
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>
    );
  }
);
