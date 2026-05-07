import { useState, useMemo } from 'react';
import type { ThreadData, ParsedMessage } from '../../types';

export function useParticipantFilter(threadData: ThreadData | null) {
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  const filteredMessages = useMemo((): ParsedMessage[] => {
    if (!threadData) return [];
    if (!selectedEmail) return threadData.messages;
    return threadData.messages.filter(m => m.sender.email === selectedEmail);
  }, [threadData, selectedEmail]);

  function selectSender(email: string | null) {
    setSelectedEmail(email);
  }

  return { selectedEmail, selectSender, filteredMessages };
}
