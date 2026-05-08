import type { Participant } from '../../types';

interface Props {
  participants: Participant[];
  selectedEmail: string | null;
  onSelect: (email: string | null) => void;
}

export function ParticipantSidebar({ participants, selectedEmail, onSelect }: Props) {
  return (
    <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* All chip */}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
          selectedEmail === null
            ? 'bg-blue-500 text-white border-blue-500'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500'
        }`}
      >
        All
        <span className="text-[10px] opacity-70">
          {participants.reduce((s, p) => s + p.messageCount, 0)}
        </span>
      </button>

      {participants.map(p => (
        <button
          key={p.sender.email}
          onClick={() => onSelect(p.sender.email)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
            selectedEmail === p.sender.email
              ? 'text-white border-transparent'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500'
          }`}
          style={selectedEmail === p.sender.email ? { backgroundColor: p.sender.avatarColor, borderColor: p.sender.avatarColor } : {}}
        >
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: p.sender.avatarColor, fontSize: '8px' }}
          >
            {p.sender.initials}
          </span>
          <span className="max-w-[80px] truncate">{p.sender.name.split(' ')[0]}</span>
          <span className="text-[10px] opacity-70">{p.messageCount}</span>
        </button>
      ))}
    </div>
  );
}
