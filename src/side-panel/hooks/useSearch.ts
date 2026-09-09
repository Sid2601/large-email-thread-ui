import { useState, useMemo } from 'react';
import type { ParsedMessage } from '../../types';

export function useSearch(messages: ParsedMessage[]) {
  const [query, setQuery] = useState('');

  const filteredMessages = useMemo((): ParsedMessage[] => {
    if (!query.trim()) return messages;
    const lower = query.toLowerCase();
    return messages.filter(
      m =>
        m.body.toLowerCase().includes(lower) ||
        m.quotedVariants?.some(variant => variant.body.toLowerCase().includes(lower)) ||
        m.sender.name.toLowerCase().includes(lower) ||
        m.sender.email.toLowerCase().includes(lower)
    );
  }, [messages, query]);

  return { query, setQuery, filteredMessages };
}
