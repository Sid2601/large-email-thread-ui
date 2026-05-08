import { forwardRef } from 'react';

interface SearchBarProps {
  query: string;
  onChange: (value: string) => void;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ query, onChange }, ref) {
    return (
      <div className="px-3 py-1.5 bg-white border-b border-gray-100 shrink-0">
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search messages…"
          className="w-full text-sm px-2 py-1 rounded border border-gray-200 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
        />
      </div>
    );
  }
);
