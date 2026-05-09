import { forwardRef, useEffect } from 'react';

interface SearchBarProps {
  query: string;
  onChange: (value: string) => void;
  resultCount?: number;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ query, onChange, resultCount }, ref) {
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        const inputRef = (ref as React.RefObject<HTMLInputElement>)?.current;
        if (e.key === 'Escape' && document.activeElement === inputRef) {
          onChange('');
          inputRef?.blur();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [onChange, ref]);

    return (
      <div className="px-3 py-2 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900 px-2 py-1.5 rounded-lg border border-transparent focus-within:border-blue-400 focus-within:bg-white dark:focus-within:bg-gray-950 transition-all">
          <span className="text-gray-400 text-xs">🔍</span>
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={e => onChange(e.target.value)}
            placeholder="Search thread..."
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 font-medium"
          />
          {query && (
            <div className="flex items-center gap-2">
              {resultCount !== undefined && (
                <span className="text-[10px] font-bold text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                  {resultCount}
                </span>
              )}
              <button
                onClick={() => onChange('')}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
);
