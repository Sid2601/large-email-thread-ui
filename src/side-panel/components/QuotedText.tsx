import { useState } from 'react';

interface Props {
  text: string;
  inverted?: boolean;
}

export function QuotedText({ text, inverted = false }: Props) {
  const [open, setOpen] = useState(false);

  const buttonClasses = inverted
    ? "text-blue-100 hover:text-white"
    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300";

  const contentClasses = inverted
    ? "border-blue-300 text-blue-50"
    : "border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400";

  return (
    <div className="mt-1 text-left">
      <button
        onClick={() => setOpen(!open)}
        className={`text-[10px] font-semibold uppercase tracking-tight ${buttonClasses} underline decoration-dotted`}
      >
        {open ? 'Hide history' : 'Show history'}
      </button>
      {open && (
        <div className={`mt-1 pl-2 border-l-2 ${contentClasses} text-[11px] whitespace-pre-wrap leading-relaxed opacity-90`}>
          {text}
        </div>
      )}
    </div>
  );
}
