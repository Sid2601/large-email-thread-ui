import type { ExtensionMessage, ThreadData } from '../types';

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === 'THREAD_PARSED') {
      const data: ThreadData = message.data;
      chrome.storage.local.set({ currentThread: data }, () => {
        chrome.runtime.sendMessage({ type: 'THREAD_UPDATED', data } satisfies ExtensionMessage)
          .catch(() => {}); // side panel may not be open yet
      });
      if (sender.tab?.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id });
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'REQUEST_THREAD') {
      chrome.storage.local.get(['currentThread'], (result) => {
        if (result.currentThread) {
          sendResponse({ type: 'THREAD_UPDATED', data: result.currentThread } satisfies ExtensionMessage);
        } else {
          sendResponse(null);
        }
      });
      return true;
    }
  }
);
