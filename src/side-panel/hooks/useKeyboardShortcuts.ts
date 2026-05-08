import { useEffect, useCallback } from 'react';

interface Options {
  onFocusSearch: () => void;
  onClearSearch: () => void;
  scrollThreadRef: React.RefObject<HTMLDivElement | null>;
}

export function useKeyboardShortcuts({ onFocusSearch, onClearSearch, scrollThreadRef }: Options) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    const inInput = document.activeElement?.tagName === 'INPUT' ||
                    document.activeElement?.tagName === 'TEXTAREA';

    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      onFocusSearch();
      return;
    }
    if (e.key === 'Escape') {
      onClearSearch();
      return;
    }
    if (inInput) return; // don't intercept j/k when typing

    const el = scrollThreadRef.current;
    if (!el) return;

    if (e.key === 'ArrowDown' || e.key === 'j') el.scrollBy({ top: 80, behavior: 'smooth' });
    if (e.key === 'ArrowUp' || e.key === 'k') el.scrollBy({ top: -80, behavior: 'smooth' });
    if (e.key === 'Home') el.scrollTo({ top: 0, behavior: 'smooth' });
    if (e.key === 'End') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [onFocusSearch, onClearSearch, scrollThreadRef]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);
}
