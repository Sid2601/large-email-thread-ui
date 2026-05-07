import { useState } from 'react';

export function QuotedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 hover:text-gray-600 underline"
      >
        {open ? 'Hide quoted text' : 'Show quoted text'}
      </button>
      {open && (
        <div className="mt-1 pl-2 border-l-2 border-gray-300 text-xs text-gray-500 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
