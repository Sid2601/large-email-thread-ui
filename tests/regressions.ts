import { describe, it, expect } from 'vitest';
import { extractEmailBody, mergeMessages, parseEmailDate } from '../src/content/quoted-chain-parser';
import { sanitizeEmailHtml } from '../src/content/scraper-utils';
import { threadCache } from '../src/content/thread-cache';
import { highlightedEmailHtml } from '../src/side-panel/components/email-markup';
import { attachmentUrl, saveAttachment, MAX_FILE_BYTES } from '../src/side-panel/storage/attachments';
import { buildSender } from '../src/content/scraper-utils';
import type { ParsedMessage } from '../src/types';
const anchor = '2026-09-09T12:00:00Z';
function parse(html: string) {
  const el = document.createElement('div'); el.innerHTML = html;
  return extractEmailBody(el, 'me@example.com', 'thread', anchor);
}
function quote(body: string, day = 6, who = 'Alice') {
  return `<div class="gmail_attr">On Sun, Sep ${day}, 2026 at 10:00 AM <a href="mailto:${who.toLowerCase()}@example.com">${who}</a> wrote:</div><blockquote class="gmail_quote">${body}</blockquote>`;
}
describe('History reconstruction regressions', () => {
  it('recovers all 40 messages from an invitation containing nested history', () => {
    let html = '<p>Message 0</p>';
    for (let i = 1; i <= 40; i++) html = `<p>Message ${i}</p>${quote(html, 6, `Person${i}`)}`;
    const result = parse(html);
    expect(result.history).toHaveLength(40);
    expect(result.body).toBe('Message 40');
    for (const message of result.history) expect(message.body.match(/Message/g)).toHaveLength(1);
  });
  it('recovers included history inside collapsed provider wrappers', () => {
    const result = parse('<p>Adding you.</p><div hidden style="display:none">' + quote('Earlier approval') + '</div>');
    expect(result.history[0].body).toBe('Earlier approval');
    expect(result.body).toBe('Adding you.');
  });
  it('keeps repeated short replies on different dates and full content beyond 300 characters', () => {
    const result = parse(quote('OK', 6) + quote('OK', 7) + quote('x'.repeat(310) + 'A') + quote('x'.repeat(310) + 'B'));
    expect(result.history).toHaveLength(4);
    expect(new Set(result.history.map(m => m.id)).size).toBe(4);
  });
  it('separates Outlook HTML without blank lines and preserves a single-cell table', () => {
    const result = parse('<p>Adding you now.</p><div><b>From:</b> Alice &lt;alice@example.com&gt;<br><b>Sent:</b> 6 Sep 2026 10:00 +0000<br><b>To:</b> me@example.com<br><b>Subject:</b> Budget</div><table><tr><td colspan="2" style="background-color:yellow"><b>Approved</b></td></tr></table>');
    expect(result.body).toBe('Adding you now.');
    expect(result.history).toHaveLength(1);
    expect(result.history[0].body).toBe('Approved');
    expect(result.history[0].bodyHtml).toContain('<table>');
    expect(result.history[0].bodyHtml).toContain('colspan="2"');
    expect(result.history[0].bodyHtml).toContain('<b>Approved</b>');
  });
  it('does not remove an ordinary blockquote with no email header', () => {
    expect(parse('<p>Requirement:</p><blockquote>Use the approved spec.</blockquote>').body).toContain('approved spec');
  });
  it('splits mixed forwarded chains without repeating their nested bodies', () => {
    const result = parse('FYI<br>---------- Forwarded message ---------<br>From: Bob &lt;bob@example.com&gt;<br>Date: 8 Sep 2026 10:00 +0000<br>To: me@example.com<br>Subject: Update<br><br>Latest approval<br>From: Alice &lt;alice@example.com&gt;<br>Sent: 7 Sep 2026 10:00 +0000<br>To: Bob<br>Subject: Update<br><br>Original proposal');
    expect(result.body).toBe('FYI');
    expect(result.history.map(m => m.body)).toEqual(['Original proposal', 'Latest approval']);
  });
  it('parses timezone offsets and labels unavailable dates', () => {
    expect(parseEmailDate('6 Sep 2026 at 10:00 +0530', anchor).timestamp).toBe('2026-09-06T04:30:00.000Z');
    expect(parseEmailDate('unavailable', anchor).timestampEstimated).toBe(true);
  });
  it('reconciles direct messages without deleting earlier quoted-only history', () => {
    const history = parse(quote('Earlier', 6) + quote('Latest', 7)).history;
    const direct = { ...history[1], id: 'gmail-id', source: 'direct' as const };
    expect(mergeMessages([...history, direct])).toHaveLength(2);
    threadCache.evict('cache-test');
    threadCache.update('cache-test', history);
    threadCache.update('cache-test', [direct]);
    const data = threadCache.getThreadData('cache-test', 'Subject', 'gmail')!;
    expect(data.messages.map(m => m.id)).toContain('gmail-id');
    expect(data.messages).toHaveLength(2);
    expect(data.participants[0].messageCount).toBe(2);
    const changed = { ...direct, attachments: [{ name: 'report.pdf', mimeType: 'application/pdf', sizeLabel: '10 KB', downloadUrl: '' }] };
    expect(threadCache.update('cache-test', [changed])).toBe(true);
    expect(threadCache.getThreadData('cache-test', '', 'gmail')!.messages[1].attachments).toHaveLength(1);
    expect(threadCache.update('cache-test', [changed])).toBe(false);
  });
});
describe('Quoted attribution timezones', () => {
  const LONG = 'Hi Alex, By design the ledger will hold some unresolved in-transit rows for non-participating stores, because those stores have no feed to complete the receipting. That leaves orphaned records, so the closing position still lists in-transit items.';
  const SHORT = 'Hi Alex, Please find the details for on-order and in-transit stock for the northern region.';
  // A replying client writes its own wall clock with no offset, so the reader
  // sees the quote a whole timezone away from the provider header.
  const SHIFT = 4.5 * 3600 * 1000;
  function wall(ms: number) {
    const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function attribution(ms: number, who: string, body: string) {
    return `<div class="gmail_attr">On ${wall(ms - SHIFT)}, <a href="mailto:${who}@example.com">${who}</a> wrote:</div><blockquote class="gmail_quote">${body}</blockquote>`;
  }
  function sent(id: string, who: string, ms: number, body: string, options: Partial<ParsedMessage> = {}): ParsedMessage {
    return { id, sender: buildSender(who, `${who}@example.com`), timestamp: new Date(ms).toISOString(), body, source: 'direct', index: 0, isCurrentUser: false, ...options };
  }
  const longSentAt = Date.parse('2026-09-09T08:04:00Z'), shortSentAt = Date.parse('2026-09-09T04:10:00Z');

  it('marks a zoneless attribution clock and trusts an explicit offset', () => {
    expect(parse(attribution(longSentAt, 'motka', LONG)).history[0].timestampZoneUnknown).toBe(true);
    expect(parse(quote(LONG)).history[0].timestampZoneUnknown).toBe(true);
    expect(parse(`<div class="gmail_attr">On Sun, Sep 6, 2026 at 10:00 +0530 <a href="mailto:a@example.com">A</a> wrote:</div><blockquote class="gmail_quote">${LONG}</blockquote>`).history[0].timestampZoneUnknown).toBeUndefined();
  });
  it('collapses a quoted copy that reads a whole timezone from its provider header', () => {
    const history = parse(attribution(longSentAt, 'motka', LONG)).history;
    const merged = mergeMessages([sent('provider-id', 'motka', longSentAt, LONG), ...history]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('provider-id');
    expect(merged[0].timestamp).toBe(new Date(longSentAt).toISOString());
    expect(merged[0].timestampZoneUnknown).toBeFalsy();
  });
  it('resolves shorter duplicates once a long copy confirms the offset', () => {
    const history = parse(attribution(longSentAt, 'motka', `${LONG}${attribution(shortSentAt, 'kumar', SHORT)}`)).history;
    const merged = mergeMessages([sent('long-id', 'motka', longSentAt, LONG), sent('short-id', 'kumar', shortSentAt, SHORT), ...history]);
    expect(merged.map(m => m.id)).toEqual(['short-id', 'long-id']);
  });
  it('does not merge a short shifted copy on its own weak evidence', () => {
    const history = parse(attribution(shortSentAt, 'kumar', SHORT)).history;
    expect(mergeMessages([sent('short-id', 'kumar', shortSentAt, SHORT), ...history])).toHaveLength(2);
  });
  it('merges identical copies quoted by clients in two different timezones', () => {
    const [first] = parse(attribution(longSentAt, 'motka', LONG)).history;
    const [second] = parse(attribution(longSentAt - 2 * 3600 * 1000, 'motka', LONG)).history;
    expect(mergeMessages([first, { ...second, id: 'other-chain' }])).toHaveLength(1);
  });
  it.each([
    ['a gap no timezone produces', 37 * 60000],
    ['a gap beyond any inhabited offset', 15 * 3600 * 1000],
  ])('keeps a shifted-looking copy separate across %s', (_label, gap) => {
    const [copy] = parse(attribution(longSentAt, 'motka', LONG)).history;
    expect(mergeMessages([sent('provider-id', 'motka', Date.parse(copy.timestamp) + gap, LONG), copy])).toHaveLength(2);
  });
  it('keeps a shifted copy whose figures changed', () => {
    const [copy] = parse(attribution(longSentAt, 'motka', LONG.replace('some unresolved', '40000 unresolved'))).history;
    expect(mergeMessages([sent('provider-id', 'motka', longSentAt, LONG), copy])).toHaveLength(2);
  });
  it('stays stable across repeated merges and cache rescans', () => {
    const history = parse(attribution(longSentAt, 'motka', `${LONG}${attribution(shortSentAt, 'kumar', SHORT)}`)).history;
    const input = [sent('long-id', 'motka', longSentAt, LONG), sent('short-id', 'kumar', shortSentAt, SHORT), ...history];
    const merged = mergeMessages(input);
    expect(JSON.stringify(mergeMessages(merged))).toBe(JSON.stringify(merged));
    expect(threadCache.update('timezones', input)).toBe(true);
    expect(threadCache.update('timezones', input)).toBe(false);
    expect(threadCache.getThreadData('timezones', 'Stock', 'gmail')!.messages).toHaveLength(2);
  });
  it('never collapses two real emails an offset apart', () => {
    expect(mergeMessages([sent('first', 'motka', longSentAt, LONG), sent('second', 'motka', longSentAt - SHIFT, LONG, { timestampZoneUnknown: true })])).toHaveLength(2);
  });
});
describe('HTML and attachment boundaries', () => {
  it('removes active content, tracking requests and layout takeover while preserving formatting', () => {
    const html = sanitizeEmailHtml('<script>alert(1)</script><img src="https://tracker.test/x"><div id="app" onclick="evil()" style="position:fixed;background-image:url(https://tracker.test);color:red"><a href="javascript:evil()">bad</a><a href="https://example.com">good</a><table><tr><td rowspan="2">Cell</td></tr></table></div>');
    expect(html).not.toMatch(/script|tracker|onclick|position|javascript|id="app"/);
    expect(html).toContain('color:red');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('highlights text inside tables without changing their structure', () => {
    const html = highlightedEmailHtml('<table><tr><td>Approved</td></tr></table>', 'approved');
    expect(html).toContain('<td><mark>Approved</mark></td>');
  });
  it('only accepts attachment links from supported mail hosts', () => {
    expect(attachmentUrl('https://mail.google.com/mail/u/0/?view=att')).toBeTruthy();
    for (const url of ['javascript:alert(1)', 'https://mail.google.com.evil.test/file', 'http://mail.google.com/file', 'file:///etc/passwd']) expect(attachmentUrl(url)).toBe('');
  });
  it('rejects oversized files before accessing storage', async () => {
    await expect(saveAttachment('large', new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]))).rejects.toThrow('20 MB');
  });
});
