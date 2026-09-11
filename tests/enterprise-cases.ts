/** Synthetic enterprise cases; no private mailbox contents are checked in. */
import { describe, expect, it } from 'vitest';
import { extractEmailBody, parseEmailDate } from '../src/content/quoted-chain-parser';
import { mergeMessages, participationBoundary } from '../src/content/message-reconciliation';
import { readRecipients } from '../src/content/message-metadata';
import { buildSender } from '../src/content/scraper-utils';
import { threadCache } from '../src/content/thread-cache';
import { conversationHtml } from '../src/side-panel/export/conversation';
import type { ParsedMessage, ThreadData } from '../src/types';
const anchor = '2026-09-09T12:00:00Z';
const request = 'Hi all,\n\nCan you send the opening position for on-order and in-transit stock by purchase order to ensure we are all aligned? Please include the reconciliation details and confirm when the final data will be available for review.\n\nMany thanks\nAlex\n--\nAlex Taylor\nFinance Manager';
function direct(body = request, options: Partial<ParsedMessage> = {}): ParsedMessage {
  return { id: 'direct', sender: buildSender('Alex Taylor', 'alex@example.com'), timestamp: '2026-09-08T09:44:00Z', body, source: 'direct', index: 0, isCurrentUser: false, ...options };
}
function quoted(body = request, options: Partial<ParsedMessage> = {}) { return direct(body, { id: 'quoted', source: 'quoted', ...options }); }
function element(html: string) { const el = document.createElement('div'); el.innerHTML = html; return el; }
function parse(html: string) { return extractEmailBody(element(html), 'new@example.com', 'enterprise', anchor); }
function gmail(body: string, name = 'Alex', day = 8) {
  return `<div class="gmail_attr">On Sep ${day}, 2026 at 09:44 AM UTC <a href="mailto:${name.toLowerCase()}@example.com">${name}</a> wrote:</div><blockquote class="gmail_quote">${body}</blockquote>`;
}
function outlook(body: string, name = 'Alex', day = 8, recipients = 'team@example.com') {
  return `<div>From: ${name} &lt;${name.toLowerCase()}@example.com&gt;<br>Sent: ${day} Sep 2026 09:44 +0000<br>To: ${recipients}<br>Subject: Inventory review</div>${body}`;
}
describe('Duplicate reply and forward reconciliation', () => {
  it('collapses the reported pattern: missing-year direct message plus edited quote and extra signatures', () => {
    const original = direct(request, parseEmailDate('8 Sep, 09:44 +0000', anchor));
    const copy = quoted(request.replace('by purchase order', 'by purchase order for Riverside North') + '\n--\nAlex Taylor\nUpdated signature');
    const result = mergeMessages([original, copy]);
    expect(result).toHaveLength(1);
    expect(Date.parse(result[0].timestamp)).toBe(Date.parse('2026-09-08T09:44:00Z'));
    expect(result[0].timestampEstimated).toBe(false);
    expect(result[0].id).toBe('direct');
    expect(result[0].quotedVariants?.[0].body).toContain('Riverside North');
  });
  it('combines signature-only changes but preserves the full differing copy', () => {
    const result = mergeMessages([direct(), quoted(request + '\n--\nUpdated title')]);
    expect(result).toHaveLength(1);
    expect(result[0].quotedVariants?.[0].body).toContain('Updated title');
  });
  it('ignores reply quote markers, nonbreaking spaces and whitespace', () => {
    expect(mergeMessages([direct(), quoted(request.replace(/ /g, '\u00a0').replace(/^/gm, '> '))])).toHaveLength(1);
  });
  it('preserves distinct direct messages even if sender, time and body are identical', () => {
    expect(mergeMessages([direct('OK'), direct('OK', { id: 'another-direct' })])).toHaveLength(2);
  });
  it('does not guess which identical direct email an ambiguous quote belongs to', () => {
    expect(mergeMessages([direct('OK'), direct('OK', { id: 'another-direct' }), quoted('OK')])).toHaveLength(3);
  });
  it('keeps repeated approvals at different known times', () => {
    expect(mergeMessages([direct('Approved'), quoted('Approved', { timestamp: '2026-09-08T11:44:00Z' })])).toHaveLength(2);
  });
  it('keeps short replies whose dates are unknown', () => {
    expect(mergeMessages([direct('OK', { timestampEstimated: true }), quoted('OK', { timestamp: anchor, timestampEstimated: true })])).toHaveLength(2);
  });
  it('never merges identical text from different senders', () => {
    expect(mergeMessages([direct(), quoted(request, { sender: buildSender('Sam', 'sam@example.com') })])).toHaveLength(2);
  });
  it.each([
    ['inserted negation', request.replace('Can you send', 'Can you not send')],
    ['inserted quantity', request.replace('opening position', 'opening position for 40000 units')],
    ['changed meaning', request.replace('Can you send', 'Please do not send')],
  ])('preserves a quote with %s as a separate message', (_label, body) => {
    expect(mergeMessages([direct(), quoted(body)])).toHaveLength(2);
  });
  it('keeps attachment metadata when merging a quoted copy', () => {
    const attachments = [{ name: 'stock.csv', sizeLabel: '', mimeType: 'text/csv', downloadUrl: '' }];
    expect(mergeMessages([direct(), quoted(request, { attachments })])[0].attachments).toEqual(attachments);
  });
  it('remains idempotent as the same quote is rescanned and a real message expands', () => {
    threadCache.evict('expansion');
    const quote = quoted(request + '\n--\nAnother signature');
    threadCache.update('expansion', [quote]);
    threadCache.update('expansion', [direct(), quote]);
    const first = threadCache.getThreadData('expansion', '', 'gmail')!;
    expect(first.messages).toHaveLength(1);
    expect(threadCache.update('expansion', [direct(), quote])).toBe(false);
    expect(threadCache.getThreadData('expansion', '', 'gmail')!.messages[0].quotedVariants).toHaveLength(1);
  });
});
describe('Header scope, forwarding and joined-midway histories', () => {
  it('assigns text/signatures after a nested quote to the correct author', () => {
    const result = parse('<p>Adding you now.</p>' + gmail('<p>Second message.</p>' + gmail('<p>First message.</p>', 'Sam', 7) + '<p>Alex signature.</p>') + '<p>Current sender signature.</p>');
    expect(result.body).toContain('Current sender signature.');
    expect(result.body).not.toContain('Alex signature.');
    expect(result.history[0].body).toBe('First message.');
    expect(result.history[1].body).toContain('Alex signature.');
    expect(result.history[1].body).not.toContain('First message.');
  });
  it('parses two independent forwarded siblings without mixing their senders', () => {
    const result = parse('<p>Compare these.</p>' + gmail('First branch.', 'Alex', 7) + gmail('Second branch.', 'Sam', 8));
    expect(result.history.map(m => m.body)).toEqual(['First branch.', 'Second branch.']);
    expect(result.body).toBe('Compare these.');
  });
  it('recovers a forwarded chain before the new person replies in the same thread', () => {
    const forwarded = parse('<p>Looping in New.</p>---------- Forwarded message ---------<br>' + outlook('<p>Can you review?</p>' + outlook('<table><tr><td>Original figures</td></tr></table>', 'Sam', 7), 'Alex', 8, 'new@example.com'));
    const incoming = direct(forwarded.body, { id: 'forwarding-email', sender: buildSender('Lee', 'lee@example.com'), timestamp: '2026-09-09T09:00:00Z', recipients: ['new@example.com'] });
    const response = direct('I can review.', { id: 'new-person-reply', sender: buildSender('New', 'new@example.com'), isCurrentUser: true, timestamp: anchor });
    const messages = mergeMessages([...forwarded.history, incoming, response, ...forwarded.history]);
    expect(messages).toHaveLength(4);
    expect(messages[0].body).toBe('Original figures');
    expect(messages[0].bodyHtml).toContain('<table>');
    expect(participationBoundary(messages, 'new@example.com')?.messageId).toBe(forwarded.history[1].id);
  });
  it('deduplicates a direct original that is also present inside a forward', () => {
    const result = parse('Forwarding for awareness.<br>' + outlook('<p>Original approval.</p>'));
    const original = direct('Original approval.');
    expect(mergeMessages([...result.history, original])).toHaveLength(1);
  });
  it('reads a recipient address on a wrapped Outlook To list', () => {
    const result = parse(outlook('<p>Review this.</p>', 'Alex', 8, 'first@example.com;<br>new@example.com;<br>third@example.com'));
    expect(result.history[0].recipients).toEqual(['first@example.com', 'new@example.com', 'third@example.com']);
    expect(result.history[0].body).toBe('Review this.');
  });
  it('does not treat ordinary From/To prose as an email header', () => {
    const result = parse('<p>From: warehouse</p><p>To: retail</p><p>Move the stock tomorrow.</p>');
    expect(result.history).toHaveLength(0);
    expect(result.body).toContain('Move the stock');
  });
  it('preserves a forward with no introduction as history instead of a duplicate empty message', () => {
    const result = parse('---------- Forwarded message ---------<br>' + outlook('<p>Only original content.</p>'));
    expect(result.body).toBe('');
    expect(result.history).toHaveLength(1);
  });
  it('extracts plain-text On/wrote replies without Gmail classes', () => {
    const result = parse('<p>Reply.</p><div>On Sep 8, 2026 at 09:44 AM UTC Alex &lt;alex@example.com&gt; wrote:</div><p>Original.</p>');
    expect(result.history[0].body).toBe('Original.');
    expect(result.body).toBe('Reply.');
  });
});
describe('Dates and participation evidence', () => {
  it('never silently assigns 2001 to a missing-year September date', () => {
    const parsed = parseEmailDate('8 Sep, 09:44 +0000', anchor);
    expect(parsed.timestamp).toBe('2026-09-08T09:44:00.000Z');
    expect(parsed.timestampEstimated).toBe(true);
  });
  it('handles missing-year December history encountered in January', () => {
    expect(parseEmailDate('Dec 31, 23:00 +0000', '2026-01-02T12:00:00Z').timestamp).toBe('2025-12-31T23:00:00.000Z');
  });
  it('respects an explicit historical year and a time zone', () => {
    expect(parseEmailDate('8 Sep 2001 09:44 +0000', anchor).timestamp).toBe('2001-09-08T09:44:00.000Z');
    expect(parseEmailDate('8 Sep 2026 15:14 +0530', anchor).timestamp).toBe('2026-09-08T09:44:00.000Z');
  });
  it('marks time-only, invalid and ambiguous numeric dates as estimated', () => {
    for (const raw of ['09:44', 'not a date', '09/08 09:44']) expect(parseEmailDate(raw, anchor)).toEqual({ timestamp: anchor, timestampEstimated: true });
  });
  it('marks explicit first inclusion after earlier quoted history', () => {
    const messages = [quoted('Earlier.'), direct('Adding you.', { id: 'join', timestamp: anchor, recipients: ['new@example.com'] })];
    const boundary = participationBoundary(messages, 'new@example.com');
    expect(boundary?.kind).toBe('recipient');
    expect(boundary?.messageId).toBe('join');
    expect(boundary?.detail).toContain('does not prove');
  });
  it('does not falsely claim a join date without recipient evidence', () => {
    const boundary = participationBoundary([quoted('Earlier.'), direct('Available.')], 'new@example.com');
    expect(boundary?.kind).toBe('available');
    expect(boundary?.title).not.toContain('joined');
  });
  it('does not mark a midway join when the user was included from the start', () => {
    expect(participationBoundary([quoted('First.', { recipients: ['new@example.com'] }), direct()], 'new@example.com')).toBeUndefined();
  });
  it('recognizes earlier authorship instead of a later first To appearance', () => {
    const boundary = participationBoundary([quoted('Before.'), quoted('My response.', { id: 'mine', sender: buildSender('New', 'new@example.com') }), direct('Recipient.', { recipients: ['new@example.com'] })], 'new@example.com');
    expect(boundary?.kind).toBe('authored');
    expect(boundary?.messageId).toBe('mine');
  });
  it('does not infer recipients from email addresses mentioned inside message bodies', () => {
    const el = element('<span class="g2" email="actual@example.com"></span><div class="body"><span class="g2" email="mentioned@example.com"></span></div>');
    expect(readRecipients(el, el.querySelector('.body')!)).toEqual(['actual@example.com']);
  });
  it('exports a single message for a repeated quote while preserving its variant and boundary', () => {
    const messages = [quoted('Earlier.', { id: 'earlier', timestamp: '2026-09-07T09:44:00Z', sender: buildSender('Sam', 'sam@example.com') }), direct(request, { recipients: ['new@example.com'] }), quoted(request + '\n--\nNew signature')];
    const thread: ThreadData = { threadId: 'export', subject: 'Review', client: 'gmail', scrapedAt: anchor, participants: [], messages, currentUserEmail: 'new@example.com' };
    const doc = new DOMParser().parseFromString(conversationHtml(thread), 'text/html');
    expect(doc.querySelectorAll('article')).toHaveLength(2);
    expect(doc.querySelector('.participation')?.textContent).toContain('first visible inclusion');
    expect(doc.querySelector('details')?.textContent).toContain('New signature');
  });
});

describe('Long threads and defensive matching', () => {
  it('reconstructs 40 unique messages when only the last five emails are directly available', () => {
    let chain = '';
    const available: ParsedMessage[] = [];
    for (let i = 0; i < 40; i++) {
      const timestamp = `2026-09-08T10:${String(i).padStart(2, '0')}:00Z`;
      const body = `Business update number ${i}.`;
      const author = `person${i % 4}`;
      const email = `${author}@example.com`;
      if (i >= 35) {
        const parsed = extractEmailBody(element(`<p>${body}</p>${chain}`), 'new@example.com', 'forty', timestamp);
        available.push(...parsed.history, direct(parsed.body, { id: `direct-${i}`, timestamp, sender: buildSender(author, email), recipients: ['new@example.com'] }));
      }
      chain = `<div class="gmail_attr">On Sep 8, 2026 at 10:${String(i).padStart(2, '0')} AM UTC <a href="mailto:${email}">${author}</a> wrote:</div><blockquote class="gmail_quote"><p>${body}</p>${chain}</blockquote>`;
    }
    const messages = mergeMessages(available);
    expect(messages).toHaveLength(40);
    expect(messages[0].body).toBe('Business update number 0.');
    expect(messages[39].body).toBe('Business update number 39.');
    expect(participationBoundary(messages, 'new@example.com')?.messageId).toBe('direct-35');
  });
  it('keeps quoted messages with unknown sender identities separate', () => {
    const sender = buildSender('Unknown', 'unknown:Unknown');
    expect(mergeMessages([quoted(request, { id: 'q1', sender }), quoted(request, { id: 'q2', sender })])).toHaveLength(2);
  });
  it('does not throw or collapse short messages with malformed timestamps', () => {
    expect(mergeMessages([direct('OK', { timestamp: 'invalid', timestampEstimated: true }), quoted('OK')])).toHaveLength(2);
  });
});

describe('Mobile and recipient-list boundaries', () => {
  it('does not swallow body prose mentioning an email after a recipient header', () => {
    const result = parse('From: Alex &lt;alex@example.com&gt;<br>Sent: 8 Sep 2026 09:44 +0000<br>Subject: Review<br>To: team@example.com;<br><br>Contact new@example.com tomorrow for approval.');
    expect(result.history[0].body).toBe('Contact new@example.com tomorrow for approval.');
    expect(result.history[0].recipients).not.toContain('new@example.com');
  });
  it('parses Apple-style comma-at and comma-sender attribution', () => {
    const result = parse('<p>Reply.</p><p>On Sep 8, 2026, at 09:44 AM, Alex &lt;alex@example.com&gt; wrote:</p><p>Original mobile message.</p>');
    expect(result.history).toHaveLength(1);
    expect(result.history[0].body).toBe('Original mobile message.');
    expect(result.history[0].sender.email).toBe('alex@example.com');
    expect(result.history[0].timestampEstimated).toBe(false);
  });
  it('parses an attribution wrapped across two plain-text lines', () => {
    const result = parse('Reply.<br>On Sep 8, 2026 at 09:44 AM UTC<br>Alex &lt;alex@example.com&gt; wrote:<br>Original wrapped message.');
    expect(result.history).toHaveLength(1);
    expect(result.history[0].body).toBe('Original wrapped message.');
  });
});

describe('A twenty-email thread that begins with unanswered follow-ups', () => {
  const people = [['Alice Smith', 'alice@example.com'], ['Bob Davis', 'bob@example.com'], ['Carol Jones', 'carol@example.com'], ['Dan Reed', 'dan@example.com']];
  // Alice writes twice with no reply, then four people reply to each other.
  const authors = [0, 0, 1, 2, 0, 1, 3, 2, 0, 1, 2, 3, 0, 1, 2, 0, 3, 1, 2, 0];
  const bodies = authors.map((_, i) => i === 1
    ? 'Following up on my note below since I have not heard back. We need the on-order and in-transit split confirmed before Thursday or the supplier will re-quote the whole order.'
    : `Message ${i + 1}: noting the position on line ${i} and confirming the revised totals for the depot so the reconciliation can be closed off properly this week.`);
  const times = authors.map((_, i) => Date.parse('2026-09-01T09:05:00Z') + i * 3600000);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** The quoting client writes its own wall clock, four and a half hours from
   * the provider header the reader sees. */
  function attribution(i: number): string {
    const shifted = new Date(times[i] - 4.5 * 3600000);
    const [name, email] = people[authors[i]];
    const clock = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
    return `<div class="gmail_attr">On ${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()} at ${clock}, ${name} &lt;<a href="mailto:${email}">${email}</a>&gt; wrote:<br></div>`;
  }
  function chain(upto: number): string {
    return upto < 0 ? '' : `<div class="gmail_quote">${attribution(upto)}<blockquote class="gmail_quote"><div dir="ltr">${bodies[upto]}</div>${chain(upto - 1)}</blockquote></div>`;
  }
  const parsed = authors.map((author, i) => {
    const [name, email] = people[author];
    const timestamp = new Date(times[i]).toISOString();
    const read = extractEmailBody(element(`<div dir="ltr">${bodies[i]}</div>${chain(i - 1)}`), 'alice@example.com', 'long', timestamp);
    return [...read.history, { id: `direct-${i}`, sender: buildSender(name, email), timestamp, body: read.body, bodyHtml: read.bodyHtml, source: 'direct' as const, index: i, isCurrentUser: false }];
  }).flat();

  it('recovers every quoted copy of every message', () => {
    expect(parsed).toHaveLength((authors.length * (authors.length + 1)) / 2);
  });
  it('reports each message exactly once, in order, from its own provider header', () => {
    const merged = mergeMessages(parsed);
    expect(merged.map(m => m.id)).toEqual(authors.map((_, i) => `direct-${i}`));
    expect(merged.map(m => m.timestamp)).toEqual(times.map(time => new Date(time).toISOString()));
    expect(merged.every(m => m.source === 'direct')).toBe(true);
    expect(merged.map(m => m.sender.name)).toEqual(authors.map(author => people[author][0]));
  });
  it('names the author of a recovered copy rather than repeating the address', () => {
    const recovered = extractEmailBody(element(chain(2)), 'alice@example.com', 'long', new Date(times[3]).toISOString()).history;
    expect(recovered.map(m => m.sender.name)).toEqual(['Alice Smith', 'Alice Smith', 'Bob Davis']);
    expect(recovered.map(m => m.sender.email)).toEqual(['alice@example.com', 'alice@example.com', 'bob@example.com']);
  });
});
