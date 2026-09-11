import type { ParsedMessage, Attachment } from '../../types';
import { RichBody } from './RichBody';
import { QuotedText } from './QuotedText';
import { AttachmentChip } from './AttachmentChip';

interface Props {
  message: ParsedMessage;
  tabId?: number;
  showSenderName: boolean;
  searchQuery?: string;
}

function QuotedVariants({ message, query, tabId }: { message: ParsedMessage; query: string; tabId?: number }) {
  if (!message.quotedVariants?.length) return null;
  return <details className="mt-2 border-t pt-2 text-xs">
    <summary className="cursor-pointer">Quoted copy differs ({message.quotedVariants.length})</summary>
    <p className="my-1">A likely repeated quote has different wording. The copy is preserved here for comparison.</p>
    {message.quotedVariants.map((variant, index) => <div key={index} className="email-body mt-2 border-t pt-2">
      {variant.bodyHtml ? <RichBody html={variant.bodyHtml} query={query} tabId={tabId} /> : <p className="whitespace-pre-wrap">{variant.body}</p>}
    </div>)}
  </details>;
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

export function MessageBubble({ message, showSenderName, searchQuery = '', tabId }: Props) {
  const { sender, body, quotedText, timestamp, isCurrentUser } = message;

  const time = (() => {
    if (message.timestampEstimated) return 'Time unavailable · approximate order';
    try {
      return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();
  // No provider header was available for this copy, only a quoted clock written
  // without an offset, so say so rather than presenting it as exact.
  const timeHint = message.orderedByQuote
    ? 'Placed by the quoted reply chain, not by this clock. The time was read from quoted text, which records no timezone, so it sits in a different one to its neighbour.'
    : message.timestampZoneUnknown && !message.timestampEstimated
    ? 'Read from quoted text, which records no timezone. This can be offset from the original send time.'
    : undefined;

  // An email that added no words of its own is an event, not a message: it is
  // announced on one line instead of being drawn as an empty bubble.
  if (message.historyCarrier) {
    return (
      <div className="my-2 px-3 flex justify-center">
        <p className="max-w-[92%] rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1 text-center text-xs text-gray-600 dark:text-gray-300">
          ↪ {highlightText(body, searchQuery)}{time ? ` · ${time}` : ''}
        </p>
      </div>
    );
  }

  if (isCurrentUser) {
    return (
      <div className="flex justify-end mb-1 px-3">
        <div className="max-w-[80%]">
          <div className="bg-blue-500 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
            {message.bodyHtml
              ? <RichBody html={message.bodyHtml} query={searchQuery} tabId={tabId} />
              : <p className="whitespace-pre-wrap break-words">{highlightText(body, searchQuery)}</p>
            }
            {quotedText && <QuotedText text={quotedText} />}
          <QuotedVariants message={message} query={searchQuery} tabId={tabId} />
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {message.attachments.map((att: Attachment, i: number) => (
                <AttachmentChip key={i} attachment={att} messageId={message.id} />
              ))}
            </div>
          )}
          <p title={timeHint} className="text-right text-xs text-gray-400 dark:text-gray-500 mt-0.5 pr-1">{message.source === 'quoted' ? 'From quoted history · ' : ''}{time}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 mb-1 px-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mb-4"
        style={{ backgroundColor: sender.avatarColor }}
      >
        {sender.initials}
      </div>
      <div className="max-w-[80%]">
        {showSenderName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 ml-1">{sender.name}</p>
        )}
        <div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 text-sm shadow-sm border border-gray-100 dark:border-gray-700">
          {message.bodyHtml
            ? <RichBody html={message.bodyHtml} query={searchQuery} tabId={tabId} />
            : <p className="whitespace-pre-wrap break-words">{highlightText(body, searchQuery)}</p>
          }
          {quotedText && <QuotedText text={quotedText} />}
          <QuotedVariants message={message} query={searchQuery} tabId={tabId} />
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {message.attachments.map((att: Attachment, i: number) => (
              <AttachmentChip key={i} attachment={att} messageId={message.id} />
            ))}
          </div>
        )}
        <p title={timeHint} className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-1">{message.source === 'quoted' ? 'From quoted history · ' : ''}{time}</p>
      </div>
    </div>
  );
}
