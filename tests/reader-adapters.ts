import { beforeEach, expect, it, vi } from 'vitest';
import type { ReaderAdapter } from '../src/content/incremental-reader';
const adapters = vi.hoisted(() => [] as ReaderAdapter[]);
vi.mock('../src/content/incremental-reader', () => ({ startReader: (adapter: ReaderAdapter) => adapters.push(adapter), imageSources: () => [] }));
import '../src/content/gmail-scraper';
import '../src/content/outlook-scraper';
const gmail = adapters.find(a => a.client === 'gmail')!;
const outlook = adapters.find(a => a.client === 'outlook')!;
beforeEach(() => { document.body.innerHTML = ''; });
it('preserves Gmail metadata identity while a body changes', () => {
  document.body.innerHTML = '<div data-message-id="one"><span class="gD" email="a@example.com">Alice</span><div class="a3s">Before</div></div>';
  const el = document.querySelector<HTMLElement>('[data-message-id]')!;
  const first = gmail.snapshot(el, 0, Date.now())!;
  el.querySelector('.a3s')!.textContent = 'After';
  const next = gmail.snapshot(el, 10, Date.now(), first, true)!;
  expect(next.message.id).toBe(first.message.id);
  expect(next.message.timestamp).toBe(first.message.timestamp);
  expect(next.html).toBe('After');
});
it('keeps Outlook fallback message IDs stable on subsequent edits', () => {
  document.body.innerHTML = '<div class="ReadingPane"><div class="ConversationItem"><span data-pe-id="a@example.com">Alice</span><div role="document">Before</div></div></div>';
  const el = document.querySelector<HTMLElement>('.ConversationItem')!;
  const first = outlook.snapshot(el, 0, Date.now())!;
  el.querySelector('[role="document"]')!.textContent = 'After';
  const next = outlook.snapshot(el, 5, Date.now(), first, true)!;
  expect(next.message.id).toBe(first.message.id);
  expect(next.message.timestamp).toBe(first.message.timestamp);
  expect(next.html).toBe('After');
});
it('uses the authoritative Outlook container once despite nested matching wrappers', () => {
  document.body.innerHTML = '<div class="ReadingPane"><div data-unique-id="one"><div class="ConversationItem"><span data-pe-id="a@example.com">Alice</span><div role="document">Message</div></div></div></div>';
  const outer = document.querySelector<HTMLElement>('[data-unique-id]')!;
  const inner = document.querySelector<HTMLElement>('.ConversationItem')!;
  expect(outlook.snapshot(outer, 0, Date.now())).not.toBeNull();
  expect(outlook.snapshot(inner, 1, Date.now())).toBeNull();
  expect(outlook.messageElement!(inner.querySelector('[role="document"]')!)).toBe(outer);
});
