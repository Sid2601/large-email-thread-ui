import type { ParsedMessage } from '../../types';
import { QuotedText } from './QuotedText';

interface Props {
  message: ParsedMessage;
  showSenderName: boolean;
}

export function MessageBubble({ message, showSenderName }: Props) {
  const { sender, body, quotedText, timestamp, isCurrentUser } = message;

  const time = (() => {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  if (isCurrentUser) {
    return (
      <div className="flex justify-end mb-1 px-3">
        <div className="max-w-[80%]">
          <div className="bg-blue-500 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
            <p className="whitespace-pre-wrap break-words">{body}</p>
            {quotedText && <QuotedText text={quotedText} />}
          </div>
          <p className="text-right text-xs text-gray-400 mt-0.5 pr-1">{time}</p>
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
          <p className="text-xs text-gray-500 mb-0.5 ml-1">{sender.name}</p>
        )}
        <div className="bg-white text-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm shadow-sm border border-gray-100">
          <p className="whitespace-pre-wrap break-words">{body}</p>
          {quotedText && <QuotedText text={quotedText} />}
        </div>
        <p className="text-xs text-gray-400 mt-0.5 ml-1">{time}</p>
      </div>
    </div>
  );
}
