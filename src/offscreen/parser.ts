import { extractEmailBody } from '../content/quoted-chain-parser';
import { threadCache } from '../content/thread-cache';
import type { ParsedMessage } from '../types';
import type { SnapshotBatch, MessageSnapshot } from '../shared/snapshots';

/**
 * An email that adds no words of its own is still an event in the conversation:
 * somebody passed the thread on, and to whom is what the reader wants to know.
 * It is named rather than shown as an empty message.
 */
function carrierNotice(message: ParsedMessage): string {
  const who = message.sender.name?.trim() || message.sender.email;
  const to = (message.recipients ?? []).filter(address => address && address !== message.sender.email);
  const named = to.length <= 3 ? to.join(', ') : `${to.slice(0, 2).join(', ')} and ${to.length - 2} others`;
  return named
    ? `${who} passed this conversation on to ${named} without adding a message. Everything below was quoted from the thread.`
    : `${who} passed this conversation on without adding a message. Everything below was quoted from the thread.`;
}

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
  const carrier = !body && !hasImage && history.length > 0;
  return [...history, { ...snapshot.message, body: carrier ? carrierNotice(snapshot.message) : body,
    bodyHtml: carrier ? '' : bodyHtml, historyCarrier: carrier }];
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
