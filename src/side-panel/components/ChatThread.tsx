import { useRef, useEffect, useState, useCallback, forwardRef, Fragment } from 'react';
import type { ParsedMessage, ThreadData } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  messages: ParsedMessage[];
  tabId?: number;
  participation?: ThreadData['participation'];
  searchQuery?: string;
}

/** Far enough from an end that jumping to it is worth offering. */
const EDGE = 40;

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread({ messages, participation, tabId, searchQuery = '' }, ref) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [at, setAt] = useState({ start: true, end: true });

    // The panel's own ref drives the keyboard shortcuts, and this one drives the
    // jump buttons; the element is handed to both as it mounts and unmounts.
    const attach = useCallback((node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }, [ref]);

    const track = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const room = el.scrollHeight - el.clientHeight;
      setAt({ start: el.scrollTop <= EDGE, end: room <= EDGE || room - el.scrollTop <= EDGE });
    }, []);

    const jump = (to: 'start' | 'end') => {
      const el = scrollRef.current;
      el?.scrollTo({ top: to === 'start' ? 0 : el.scrollHeight, behavior: 'smooth' });
    };

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      track();
    }, [messages.length, track]);

    if (messages.length === 0) {
      return (
        <div className="flex items-center justify-center flex-1 text-sm text-gray-400 dark:text-gray-500">
          No messages from this participant.
        </div>
      );
    }

    return (
      <div className="relative flex flex-1 min-h-0">
        <div ref={attach} onScroll={track} className="flex-1 overflow-y-auto py-3 bg-gray-50 dark:bg-gray-900">
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
        {/* A long thread is mostly quoted history, so both ends are worth one tap. */}
        <div className="pointer-events-none absolute right-2 bottom-3 flex flex-col gap-2">
          {!at.start && (
            <button
              type="button"
              aria-label="Jump to the first message"
              title="Jump to the first message"
              onClick={() => jump('start')}
              className="pointer-events-auto w-8 h-8 rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 shadow hover:bg-gray-100 dark:hover:bg-gray-700"
            >↑</button>
          )}
          {!at.end && (
            <button
              type="button"
              aria-label="Jump to the latest message"
              title="Jump to the latest message"
              onClick={() => jump('end')}
              className="pointer-events-auto w-8 h-8 rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 shadow hover:bg-gray-100 dark:hover:bg-gray-700"
            >↓</button>
          )}
        </div>
      </div>
    );
  }
);
