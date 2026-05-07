import { useState, useEffect } from 'react';
import type { ThreadData, ExtensionMessage } from '../../types';

export function useThreadData() {
  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load from storage on mount (handles case where panel opens after scrape)
    chrome.storage.local.get(['currentThread'], (result) => {
      if (result.currentThread) setThreadData(result.currentThread as ThreadData);
      setIsLoading(false);
    });

    // Listen for live updates from service worker
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'THREAD_UPDATED') {
        setThreadData(message.data);
        setIsLoading(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Ask service worker for current thread (in case we opened late)
    chrome.runtime.sendMessage({ type: 'REQUEST_THREAD' } satisfies ExtensionMessage)
      .catch(() => {});

    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return { threadData, isLoading };
}
