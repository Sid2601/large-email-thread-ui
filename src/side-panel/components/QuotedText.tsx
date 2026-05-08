import { useState } from 'react';

export function QuotedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline"
      >
        {open ? 'Hide quoted text' : 'Show quoted text'}
      </button>
      {open && (
        <div className="mt-1 pl-2 border-l-2 border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
