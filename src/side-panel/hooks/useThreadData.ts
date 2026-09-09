import { useState, useEffect } from 'react';
import type { ThreadData, ExtensionMessage } from '../../types';

export function useThreadData() {
  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let active = true, tabId: number | undefined, revision = 0;
    async function refresh() {
      const version = ++revision;
      setThreadData(null); setIsLoading(true);
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!active || revision !== version) return;
        tabId = tab?.id;
        const response: ExtensionMessage | null = await chrome.runtime.sendMessage({ type: 'REQUEST_THREAD' });
        if (active && revision === version) setThreadData(response?.type === 'THREAD_UPDATED' && response.tabId === tabId ? response.data : null);
      } finally { if (active && revision === version) setIsLoading(false); }
    }
    const listener = (message: ExtensionMessage) => {
      if (!active) return;
      if ((message.type === 'THREAD_UPDATED' || message.type === 'THREAD_CLEARED') && message.tabId === tabId) {
        revision++;
        setThreadData(message.type === 'THREAD_UPDATED' ? message.data : null);
        setIsLoading(false);
      }
    };
    const activate = () => { void refresh().catch(() => setIsLoading(false)); };
    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.onActivated.addListener(activate);
    activate();
    return () => { active = false; chrome.runtime.onMessage.removeListener(listener); chrome.tabs.onActivated.removeListener(activate); };
  }, []);
  return { threadData, isLoading };
}
