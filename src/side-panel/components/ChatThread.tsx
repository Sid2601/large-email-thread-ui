import { useRef, useEffect, forwardRef } from 'react';
import type { ParsedMessage } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  messages: ParsedMessage[];
  searchQuery?: string;
}

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread({ messages, searchQuery = '' }, ref) {
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
            <MessageBubble
              key={msg.id}
              message={msg}
              showSenderName={showSenderName}
              searchQuery={searchQuery}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    );
  }
);
