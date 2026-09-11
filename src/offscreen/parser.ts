import { extractEmailBody } from '../content/quoted-chain-parser';
import { threadCache } from '../content/thread-cache';
import type { ParsedMessage } from '../types';
import type { SnapshotBatch, MessageSnapshot } from '../shared/snapshots';

export function parseSnapshot(snapshot: MessageSnapshot, batch: SnapshotBatch): ParsedMessage[] {
  // An inert document prevents email images/scripts from loading while parsing.
  const doc = new DOMParser().parseFromString('<!doctype html><body></body>', 'text/html');
  const root = doc.createElement('div'); root.innerHTML = snapshot.html;
  root.querySelectorAll('img').forEach((img, i) => {
    const source = snapshot.imageSources[i];
    if (source) img.setAttribute('src', source);
    img.removeAttribute('srcset');
  });
  const { body, bodyHtml, history } = extractEmailBody(root, batch.currentUserEmail, batch.threadId, snapshot.message.timestamp, snapshot.message.id);
  const hasImage = /<img\b/i.test(bodyHtml);
  if (!body && !hasImage && !history.length && !snapshot.message.attachments?.length) return history;
  return [...history, { ...snapshot.message, body: body || (history.length && !hasImage ? 'This email contains only quoted history, shown separately above.' : ''),
    bodyHtml, historyCarrier: !body && !hasImage && history.length > 0 }];
}
const sessions = new Map<number, string>();
export async function parseBatch(tabId: number, batch: SnapshotBatch) {
  const key = `${tabId}:${batch.session}:${batch.threadId}`;
  if (sessions.get(tabId) !== key) {
    const previous = sessions.get(tabId); if (previous) threadCache.evict(previous);
    sessions.set(tabId, key);
  }
  const incoming: ParsedMessage[] = [];
  for (const snapshot of batch.snapshots) {
    if (sessions.get(tabId) !== key) return null;
    incoming.push(...parseSnapshot(snapshot, batch));
    // Keep the extension's own UI responsive between email parses as well.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (sessions.get(tabId) !== key) return null;
  threadCache.update(key, incoming);
  const data = threadCache.getThreadData(key, batch.subject, batch.client, batch.currentUserEmail);
  return data ? { ...data, threadId: batch.threadId, sourceTabId: tabId } : null;
}
export function dropTab(tabId: number) {
  const key = sessions.get(tabId); if (key) threadCache.evict(key); sessions.delete(tabId);
}
