import { describe, it, expect } from 'vitest';
import { mergeMessages } from '../src/content/message-reconciliation';
import { buildSender, htmlToText } from '../src/content/scraper-utils';
import { parseBatch, dropTab } from '../src/offscreen/parser';
import type { ParsedMessage } from '../src/types';
import type { SnapshotBatch, MessageSnapshot } from '../src/shared/snapshots';

const words = 'Please review the transfer analysis for the twelve regional warehouses and confirm the opening balance before we schedule the next reconciliation.';
const image = (alt = 'Inline image', src = 'blob:https://mail.google.com/copy-1') => `<img src="${src}" alt="${alt}">`;
const body = (alt = 'Inline image', src?: string) => `<p>${words}</p>${image(alt, src)}<p>Kind regards</p><p>Alice</p><p>Operations Manager</p>`;
function message(id: string, html: string, options: Partial<ParsedMessage> = {}): ParsedMessage {
  return { id, sender: buildSender('Alice', 'alice@example.com'), timestamp: '2026-09-06T10:00:00Z',
    body: htmlToText(html), bodyHtml: html, source: 'quoted', index: 0, isCurrentUser: false, ...options };
}
const noVariants = (m: ParsedMessage) => expect(m.quotedVariants ?? []).toHaveLength(0);

describe('Opening already represented emails', () => {
  it.each(['image.png', 'Image removed by sender.', ''])('ignores generated image caption %s when comparing authored words', alt => {
    const result = mergeMessages([message('quote', body()), message('opened', body(alt, 'blob:https://mail.google.com/copy-2'), { source: 'direct' })]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('opened');
    noVariants(result[0]);
    expect(result[0].bodyHtml).toContain('<img');
  });
  it.each([false, true])('keeps the complete signature and picture when a copy is clipped (reverse %s)', reverse => {
    const full = message('full', body());
    const clipped = message('clipped', `<blockquote><blockquote><p>${words}</p><p>Kind regards</p><p>Alice</p></blockquote></blockquote>[Message clipped] View entire message`, { source: 'direct' });
    const merged = mergeMessages(reverse ? [full, clipped] : [clipped, full]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('clipped');
    expect(merged[0].bodyHtml).toContain('<img');
    expect(merged[0].body).toContain('Operations Manager');
    expect(merged[0].bodyHtml).not.toContain('<blockquote');
    noVariants(merged[0]);
  });
  it('retains pictures when the mailbox copy dropped them, and clears stale formatting variants', () => {
    const full = message('quote', body());
    const bare = message('direct', body().replace(/<img[^>]*>/, ''), { source: 'direct', quotedVariants: [{ body: full.body, bodyHtml: full.bodyHtml }] });
    const merged = mergeMessages([bare, full]);
    expect(merged[0].bodyHtml).toContain('<img');
    noVariants(merged[0]);
    expect(mergeMessages([bare, ...merged])).toEqual(merged);
  });
  it('does not hide a changed known image, signature title, or actual wording', () => {
    for (const changed of [body().replace('Operations Manager', 'Delivery Manager'), body().replace('twelve', 'thirteen'), body('Inline image', 'cid:changed')]) {
      const merged = mergeMessages([message('one', body('Inline image', 'cid:original')), message('two', changed)]);
      if (changed.includes('thirteen')) expect(merged).toHaveLength(2);
      else { expect(merged).toHaveLength(1); expect(merged[0].quotedVariants).toHaveLength(1); }
    }
  });
  it('cleans presentation-only variants even without another copy in this batch', () => {
    const full = message('one', body());
    full.quotedVariants = [{ body: htmlToText(body('Image removed by sender.')), bodyHtml: body('Image removed by sender.') }];
    noVariants(mergeMessages([full])[0]);
  });
  it('keeps a picture available when only the clipped copy contains it', () => {
    const full = message('full', `<p>${words}</p><p>Additional complete instructions for the review.</p>`);
    const partial = message('partial', `<p>${words}</p>${image()}<p>[Message clipped] View entire message</p>`);
    const result = mergeMessages([partial, full]);
    expect(result).toHaveLength(1);
    expect(result[0].body).toContain('Additional complete instructions');
    expect(result[0].quotedVariants?.[0].bodyHtml).toContain('<img');
  });
  it('distinguishes image payloads sharing a long encoded prefix', () => {
    const prefix = 'data:image/png;base64,' + 'A'.repeat(160);
    expect(mergeMessages([message('one', image('Chart', prefix + 'one')), message('two', image('Chart', prefix + 'two'))])).toHaveLength(2);
  });
  it('keeps distinct direct IDs and image-only messages with conflicting content', () => {
    expect(mergeMessages([message('one', body(), { source: 'direct' }), message('two', body(), { source: 'direct' })])).toHaveLength(2);
    expect(mergeMessages([message('one', image('Chart', 'cid:one')), message('two', image('Chart', 'cid:two'))])).toHaveLength(2);
  });
  it('keeps an authored blockquote inside the displayed email', () => {
    const html = `${body()}<blockquote>The specification requires approval.</blockquote>`;
    const merged = mergeMessages([message('one', html), message('two', html.replace('Inline image', 'image.png'))]);
    expect(merged).toHaveLength(1);
    expect(merged[0].bodyHtml).toContain('<blockquote>The specification requires approval.</blockquote>');
  });

  const people = ['Alice', 'Bob', 'Carol', 'Dana', 'Evan'];
  const own = (i: number, expanded: boolean) => `<p>Update ${i}: ${words}</p>${image(expanded ? 'image.png' : 'Inline image', `blob:https://mail.google.com/${expanded}-${i}`)}<p>Kind regards</p><p>${people[i]}</p>`;
  function chain(i: number, expanded: boolean): string {
    if (i < 0) return '';
    const header = i % 2
      ? `<div>---------- Forwarded message ---------<br>From: ${people[i]} &lt;${people[i].toLowerCase()}@example.com&gt;<br>Date: ${6 + i} Sep 2026 10:00 +0000<br>To: ${people[i + 1]?.toLowerCase() ?? 'me'}@example.com<br>Subject: Transfers</div>`
      : `<div class="gmail_attr">On Sep ${6 + i}, 2026 at 10:00 AM UTC <a href="mailto:${people[i].toLowerCase()}@example.com">${people[i]}</a> wrote:</div>`;
    return `${header}<blockquote class="gmail_quote">${own(i, expanded)}${chain(i - 1, expanded)}</blockquote>`;
  }
  function snapshot(i: number, expanded: boolean): MessageSnapshot {
    return { message: message(`direct-${i}`, '', { source: 'direct', sender: buildSender(people[i], `${people[i].toLowerCase()}@example.com`), timestamp: `2026-09-${String(6 + i).padStart(2, '0')}T10:00:00Z`, index: i, recipients: [i === 4 ? 'me@example.com' : `${people[i + 1].toLowerCase()}@example.com`] }), html: own(i, expanded) + chain(i - 1, expanded), imageSources: [] };
  }
  it.each([[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2]])('keeps the timeline stable across mixed forwards and sequential joins: %j', async (...order) => {
    const tab = 770;
    dropTab(tab);
    const batch: SnapshotBatch = { threadId: 'expansion-test', subject: 'Transfers', client: 'gmail', currentUserEmail: 'me@example.com', session: 'one', snapshots: [snapshot(4, false)] };
    let data = await parseBatch(tab, batch);
    expect(data?.messages).toHaveLength(5);
    const check = () => {
      expect(data?.messages).toHaveLength(5);
      expect(data?.messages.map(m => m.body.match(/Update \d/)?.[0])).toEqual(people.map((_, i) => `Update ${i}`));
      expect(data?.participation?.messageId).toBe('direct-4');
      for (const m of data!.messages) { noVariants(m); expect(m.bodyHtml).toContain('<img'); expect(m.body).not.toMatch(/wrote:|From:|Subject:/); }
    };
    check();
    for (const index of order) {
      data = await parseBatch(tab, { ...batch, snapshots: [snapshot(index, true)] });
      check();
      data = await parseBatch(tab, { ...batch, snapshots: [snapshot(index, false)] });
      check();
    }
    data = await parseBatch(tab, { ...batch, snapshots: [0, 1, 2, 3, 4].map(i => snapshot(i, true)) });
    check();
    dropTab(tab);
  });
});
