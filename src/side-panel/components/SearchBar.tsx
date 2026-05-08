import { useRef, useEffect } from 'react';

interface Props {
  query: string;
  onChange: (q: string) => void;
  resultCount?: number;
}

export function SearchBar({ query, onChange, resultCount }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onChange]);

  return (
    <div className="px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search messages… (Ctrl+F)"
          className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
        />
        {query && (
          <>
            {resultCount !== undefined && (
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                {resultCount} result{resultCount !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={() => onChange('')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm shrink-0"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
