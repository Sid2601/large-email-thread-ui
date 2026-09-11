import type { ExtensionMessage, ThreadData } from '../types';

// Session storage isolates mail by tab and clears it when Chrome exits.
// Remove the legacy single-thread persistent entry on upgrade/startup.
void chrome.storage.local.remove('currentThread');
chrome.action.onClicked.addListener(tab => {
  if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
});
let openingParser: Promise<void> | undefined;
async function ensureParser() {
  const url = chrome.runtime.getURL('src/offscreen/index.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length) return;
  openingParser ??= chrome.offscreen.createDocument({ url: 'src/offscreen/index.html', reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: 'Parse email HTML away from Gmail so scrolling stays responsive.' }).finally(() => { openingParser = undefined; });
  await openingParser;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'SNAPSHOT_BATCH' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    void ensureParser().then(() => chrome.runtime.sendMessage({ type: 'PARSER_BATCH', tabId, batch: message.batch })).then(respond, error => respond({ error: String(error) }));
    return true;
  }
  if (message.type === 'READ_PAGE_IMAGE' && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('src/side-panel/index.html') && Number.isInteger(message.tabId)) {
    void chrome.tabs.sendMessage(message.tabId, { type: 'READ_BLOB_IMAGE', url: message.url }).then(respond, () => respond({ error: 'Original mail tab is no longer available.' }));
    return true;
  }
  return false;
});
const pending = new Map<number, Promise<void>>();
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'THREAD_PARSED' || message.type === 'CLEAR_THREAD') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    const key = `thread:${tabId}`;
    const work = (pending.get(tabId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (message.type === 'THREAD_PARSED') {
        await chrome.storage.session.set({ [key]: { ...message.data, sourceTabId: tabId } });
        await chrome.runtime.sendMessage({ type: 'THREAD_UPDATED', data: message.data, tabId }).catch(() => {});
      } else {
        await chrome.storage.session.remove(key);
        await chrome.runtime.sendMessage({ type: 'THREAD_CLEARED', tabId }).catch(() => {});
      }
    });
    pending.set(tabId, work);
    work.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    void work.finally(() => { if (pending.get(tabId) === work) pending.delete(tabId); }).catch(() => {});
    return true;
  }
  if (message.type === 'REQUEST_THREAD') {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) return sendResponse(null);
      await pending.get(tab.id)?.catch(() => {});
      const result = await chrome.storage.session.get(`thread:${tab.id}`);
      const data = result[`thread:${tab.id}`] as ThreadData | undefined;
      sendResponse(data ? { type: 'THREAD_UPDATED', data, tabId: tab.id } : null);
      void chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_THREAD' }).catch(() => {});
    })().catch(() => sendResponse(null));
    return true;
  }
  return false;
});
chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.runtime.sendMessage({ type: 'PARSER_DROP', tabId }).catch(() => {});
  void (pending.get(tabId) ?? Promise.resolve()).catch(() => {}).then(() => chrome.storage.session.remove(`thread:${tabId}`));
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    void chrome.storage.session.remove(`thread:${tabId}`);
    void chrome.runtime.sendMessage({ type: 'THREAD_CLEARED', tabId }).catch(() => {});
  }
});
