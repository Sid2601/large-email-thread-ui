import { expect, it } from 'vitest';
import { conversationHtml, conversationFilename } from '../src/side-panel/export/conversation';
import { buildSender } from '../src/content/scraper-utils';
import type { ThreadData } from '../src/types';
const thread: ThreadData = {
  threadId: 'export', subject: 'Rollout <Q4>', client: 'gmail', scrapedAt: '2026-09-09T12:00:00Z', participants: [],
  messages: [
    { id: 'new', sender: buildSender('Carol', 'carol@example.com'), timestamp: '2026-09-09T12:00:00Z', body: 'Approved', bodyHtml: '<table><tr><td colspan="2"><b>Approved</b></td></tr></table>', index: 1, isCurrentUser: true, attachments: [{ name: 'report.pdf', sizeLabel: '1 MB', mimeType: 'application/pdf', downloadUrl: 'https://mail.google.com/?token=SECRET' }] },
    { id: 'old', sender: buildSender('Alice', 'alice@example.com'), timestamp: '2026-09-08T12:00:00Z', body: 'Original <proposal>\nNext line', source: 'quoted', index: 0, isCurrentUser: false },
  ],
};
const date = new Date('2026-09-09T12:00:00Z');
it('exports all messages in order with formatting, identities and attachment names', () => {
  const doc = new DOMParser().parseFromString(conversationHtml(thread, date), 'text/html');
  expect(doc.querySelectorAll('article')).toHaveLength(2);
  expect(doc.querySelector('article')?.textContent).toContain('Original <proposal>');
  expect(doc.querySelector('td')?.getAttribute('colspan')).toBe('2');
  expect(doc.querySelector('td b')?.textContent).toBe('Approved');
  expect(doc.body.textContent).toContain('alice@example.com');
  expect(doc.body.textContent).toContain('Recovered from quoted history');
  expect(doc.body.textContent).toContain('report.pdf');
  expect(doc.documentElement.outerHTML).not.toContain('SECRET');
  expect(thread.messages[0].id).toBe('new');
});
it('escapes metadata and plain text, sanitizes HTML, and embeds no executable scripts', () => {
  const unsafe = { ...thread, subject: '</title><script>alert(1)</script>', messages: [{ ...thread.messages[0], bodyHtml: '<img src="https://tracker.test"><script>evil()</script><a href="javascript:evil()">Click</a>', sender: buildSender('<img src=x onerror=evil()>', 'a@example.com') }] };
  const doc = new DOMParser().parseFromString(conversationHtml(unsafe, date), 'text/html');
  expect(doc.querySelectorAll('script,img,iframe')).toHaveLength(0);
  expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(doc.querySelector('h1')?.textContent).toBe(unsafe.subject);
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
});
it('labels estimated timestamps without presenting a made-up precise date', () => {
  const doc = new DOMParser().parseFromString(conversationHtml({ ...thread, messages: [{ ...thread.messages[0], timestampEstimated: true }] }, date), 'text/html');
  expect(doc.querySelector('article .meta')?.textContent).toContain('Time unavailable · approximate order');
});
it('creates a bounded portable HTML filename', () => {
  expect(conversationFilename('../Q4: a/b\\c?*', date)).not.toMatch(/[<>:"/\\|?*]/);
  expect(conversationFilename('', date)).toBe('ThreadLens-conversation-2026-09-09.html');
  expect(conversationFilename('x'.repeat(400), date).length).toBeLessThan(140);
});
