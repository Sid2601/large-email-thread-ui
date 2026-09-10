import { afterEach, expect, it, vi } from 'vitest';
import { startReader } from '../src/content/incremental-reader';
import type { MessageSnapshot } from '../src/shared/snapshots';
import { buildSender } from '../src/content/scraper-utils';

function stubChrome() {
  const sent: { type: string }[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (message: { type: string }) => { sent.push(message); return Promise.resolve({ data: { messages: [] } }); },
      onMessage: { addListener: () => {} },
    },
  };
  return sent;
}
const readers: { disconnect(): void }[] = [];
afterEach(() => { readers.splice(0).forEach(reader => reader.disconnect()); document.body.innerHTML = ''; });

function snapshotOf(el: HTMLElement, position: number): MessageSnapshot {
  return { message: { id: el.id, sender: buildSender('Alice', 'a@example.com'), timestamp: '2026-09-09T12:00:00Z', body: el.id, source: 'direct', index: position, isCurrentUser: false }, html: el.id, imageSources: [] };
}
it('reports where each message sits in the mailbox, not when it was snapshotted', async () => {
  stubChrome();
  document.body.innerHTML = '<div class="m" id="second"></div>';
  const seen: { id: string; position: number }[] = [];
  readers.push(startReader({
    client: 'gmail', messageSelector: '.m', bodySelector: '.body',
    threadId: () => 'thread', subject: () => 'Subject', currentUser: () => '',
    snapshot(el, index, anchor, previous, bodyDirty, position = index) { seen.push({ id: el.id, position }); return snapshotOf(el, position); },
  }));
  // The mailbox renders an earlier email after the panel already found a later
  // one, so the discovery order and the thread order disagree.
  document.body.insertAdjacentHTML('afterbegin', '<div class="m" id="first"></div>');
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(seen.map(entry => entry.id)).toEqual(['second', 'first']);
  expect(seen.map(entry => entry.position)).toEqual([1, 0]);
});
it('stops reading once disconnected', async () => {
  const sent = stubChrome();
  document.body.innerHTML = '<div class="m" id="only"></div>';
  const reader = startReader({
    client: 'gmail', messageSelector: '.m', bodySelector: '.body',
    threadId: () => 'thread', subject: () => 'Subject', currentUser: () => '',
    snapshot: (el, index, anchor, previous, bodyDirty, position = index) => snapshotOf(el, position),
  });
  reader.disconnect();
  document.body.insertAdjacentHTML('afterbegin', '<div class="m" id="added"></div>');
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(sent.filter(message => message.type === 'SNAPSHOT_BATCH')).toHaveLength(0);
});
