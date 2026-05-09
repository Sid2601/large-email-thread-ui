import { useState, useRef, useEffect } from 'react';
import type { ParsedMessage, Attachment } from '../../types';
import { QuotedText } from './QuotedText';
import { AttachmentChip } from './AttachmentChip';

interface Props {
  message: ParsedMessage;
  showSenderName: boolean;
  searchQuery?: string;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
      : part
  );
}

export function MessageBubble({ message, showSenderName, searchQuery = '' }: Props) {
  const { sender, body, quotedText, timestamp, isCurrentUser } = message;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLong, setIsLong] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setIsLong(contentRef.current.scrollHeight > 400);
    }
  }, [message.body, message.bodyHtml]);

  const time = (() => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  })();

  const bubbleClasses = isCurrentUser
    ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm shadow-md"
    : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100 dark:border-gray-700";

  const borderColor = !isCurrentUser ? { borderLeft: `3px solid ${sender.avatarColor}` } : {};

  return (
    <div className={`flex ${isCurrentUser ? 'justify-end' : 'items-end gap-2'} mb-4 px-3`}>
      {!isCurrentUser && (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mb-6 shadow-sm"
          style={{ backgroundColor: sender.avatarColor }}
          title={sender.name}
        >
          {sender.initials}
        </div>
      )}
      <div className={`max-w-[90%] ${isCurrentUser ? 'text-right' : ''}`}>
        {showSenderName && !isCurrentUser && (
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 ml-1 uppercase tracking-wider">{sender.name}</p>
        )}
        <div
          className={`${bubbleClasses} transition-all duration-200 ease-in-out`}
          style={borderColor}
        >
          <div
            ref={contentRef}
            className={`px-3 py-2 text-sm overflow-x-auto ${!isExpanded && isLong ? 'max-h-[400px] overflow-hidden relative' : ''}`}
          >
            {message.bodyHtml
              ? <div className="email-body text-left" dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
              : <p className="whitespace-pre-wrap break-words text-left leading-relaxed">{highlightText(body, searchQuery)}</p>
            }
            {!isExpanded && isLong && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white dark:from-gray-800 to-transparent pointer-events-none opacity-90" />
            )}
          </div>

          {(isLong || (quotedText && quotedText.length > 0)) && (
            <div className={`px-3 pb-2 ${isCurrentUser ? 'text-left' : ''}`}>
              {isLong && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={`text-xs font-bold ${isCurrentUser ? 'text-blue-100 hover:text-white' : 'text-blue-600 hover:text-blue-700'} mb-2 underline decoration-dotted`}
                >
                  {isExpanded ? 'Show less' : 'Read more...'}
                </button>
              )}
              {quotedText && <QuotedText text={quotedText} inverted={isCurrentUser} />}
            </div>
          )}
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className={`mt-2 flex flex-wrap gap-1 ${isCurrentUser ? 'justify-end' : ''}`}>
            {message.attachments.map((att: Attachment, i: number) => (
              <AttachmentChip key={i} attachment={att} />
            ))}
          </div>
        )}
        <p className={`text-[10px] font-medium text-gray-400 dark:text-gray-500 mt-1.5 ${isCurrentUser ? 'pr-1' : 'ml-1'}`}>
          {time}
        </p>
      </div>
    </div>
  );
}
