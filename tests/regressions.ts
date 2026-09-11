import { describe, it, expect } from 'vitest';
import { extractEmailBody, mergeMessages, parseEmailDate } from '../src/content/quoted-chain-parser';
import { sanitizeEmailHtml } from '../src/content/scraper-utils';
import { threadCache } from '../src/content/thread-cache';
import { highlightedEmailHtml } from '../src/side-panel/components/email-markup';
import { attachmentUrl, saveAttachment, MAX_FILE_BYTES } from '../src/side-panel/storage/attachments';
import { buildSender } from '../src/content/scraper-utils';
import type { ParsedMessage } from '../src/types';
import { parseSnapshot } from '../src/offscreen/parser';
import type { SnapshotBatch, MessageSnapshot } from '../src/shared/snapshots';
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
  // A sentence specific enough to be one message, quoted against the email the
  // mailbox itself holds, is the same message: the alternative is that its
  // author sent those exact words twice, in which case both would be here and
  // the ambiguity rule would keep them. Before this, a single reply from
  // another timezone duplicated every ordinary short email in the panel.
  it('merges a specific sentence quoted against the email the mailbox holds', () => {
    const history = parse(attribution(shortSentAt, 'kumar', SHORT)).history;
    const merged = mergeMessages([sent('short-id', 'kumar', shortSentAt, SHORT), ...history]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('short-id');
    expect(merged[0].timestamp).toBe(new Date(shortSentAt).toISOString());
  });
  it('still keeps a brief acknowledgement apart on that evidence alone', () => {
    const brief = 'Thanks, noted.';
    const history = parse(attribution(shortSentAt, 'kumar', brief)).history;
    expect(mergeMessages([sent('short-id', 'kumar', shortSentAt, brief), ...history])).toHaveLength(2);
  });
  it('keeps a specific sentence apart when no provider header dates either copy', () => {
    const [first] = parse(attribution(shortSentAt, 'kumar', SHORT)).history;
    const [second] = parse(attribution(shortSentAt - 2 * 3600 * 1000, 'kumar', SHORT)).history;
    expect(mergeMessages([first, { ...second, id: 'other-chain' }])).toHaveLength(2);
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
describe('Reply order across correspondents in different timezones', () => {
  // Sheffield North: the engineers write from IST and the finance team from
  // the UK, so every attribution clock is stamped in the quoting author's own
  // zone. Jodie's 13:28 is the message Jay answered at 09:04.
  const bodies: Record<string, string> = {
    jodieOpen: 'Hi all, can I confirm that I will be sent the 09/09 opening position for on-order and in-transit stock by PO for the northern site, to ensure we are all aligned?',
    jayConfirm: 'Hi Jodie, yes, I can confirm that the details for on-order and in-transit stock will be shared for the northern site once the cutover tasks complete.',
    premData: 'Hi Jodie, please find attached the details for on-order and in-transit stock for the northern site. Thanks, Prem.',
    jodieFlag: 'Hi Jay, as discussed I have run the closing stock position from the 8th and attached the data. I am seeing around 40,000 in transit but your file says nil.',
    jayExplain: 'Hi Jodie, by design the ledger holds unresolved in-transit rows for non-participating stores, because those stores have no feed to complete the receipting, so the closing position still lists them.',
    marieQuery: 'Hi Jay, I do not quite understand what has been done to in-transit at this point. The requirement is that the cutover leaves the position reflecting what is genuinely in transit to the store.',
  };
  const people: Record<string, string> = { jodie: 'Jodie Piwowar', jay: 'Jay Motka', prem: 'Prem Kumar', marie: 'Marie Rumble' };
  function attr(clock: string, who: string, quoted: string) {
    return `<div class="gmail_attr">On ${clock}, <a href="mailto:${who}@example.com">${people[who]}</a> wrote:</div><blockquote class="gmail_quote">${quoted}</blockquote>`;
  }
  // Jodie asked, Jay confirmed, Prem sent the data, Jodie flagged the gap, Jay
  // explained it, and Marie challenged Jay — each reply nesting the last.
  const opening =
    attr('Wed, 9 Sept 2026 at 13:28', 'jodie', `<p>${bodies.jodieFlag}</p>` +
    attr('Wed, 9 Sept 2026 at 05:10', 'prem', `<p>${bodies.premData}</p>` +
    attr('Tue, 8 Sept 2026 at 16:01', 'jay', `<p>${bodies.jayConfirm}</p>` +
    attr('Tue, 8 Sept 2026 at 15:14', 'jodie', `<p>${bodies.jodieOpen}</p>`))));
  const chain =
    attr('Wed, 9 Sept 2026 at 14:00', 'marie', `<p>${bodies.marieQuery}</p>` +
    attr('Wed, 9 Sept 2026 at 09:04', 'jay', `<p>${bodies.jayExplain}</p>` + opening));
  const REPLY = 'Hi Marie, I checked and it is an implementation issue at our end; two events are published where we expected one.';
  const order = ['jodieOpen', 'jayConfirm', 'premData', 'jodieFlag', 'jayExplain', 'marieQuery'];
  function read() {
    const el = document.createElement('div');
    el.innerHTML = `<p>${REPLY}</p>${chain}`;
    return extractEmailBody(el, 'me@example.com', 'sheffield', anchor, 'carrier');
  }
  function names(messages: ParsedMessage[]) {
    return messages.map(m => order.find(key => m.body.startsWith(bodies[key].slice(0, 40))) ?? 'carrier');
  }
  it('follows the quote nesting when zoneless clocks read out of order', () => {
    expect(names(read().history)).toEqual(order);
  });
  it('marks only the pair whose clocks contradict the reply order', () => {
    expect(names(read().history.filter(m => m.orderedByQuote))).toEqual(['jodieFlag', 'jayExplain']);
  });
  it('keeps the carrier after everything it quotes', () => {
    const { body, history } = read();
    // The carrier's provider header reads 04:00, earlier than the 14:00 quote
    // it encloses, because the two clocks are in different timezones.
    const carrier: ParsedMessage = { id: 'carrier', sender: buildSender('Sid', 'me@example.com'), timestamp: '2026-09-09T04:00:00Z', body, source: 'direct', index: 0, isCurrentUser: true };
    expect(names(mergeMessages([...history, carrier]))).toEqual([...order, 'carrier']);
  });
  it('stays put when merged again, and through the thread cache', () => {
    const history = read().history;
    const merged = mergeMessages(history);
    expect(JSON.stringify(mergeMessages(merged))).toBe(JSON.stringify(merged));
    threadCache.evict('sheffield');
    threadCache.update('sheffield', history);
    expect(names(threadCache.getThreadData('sheffield', 'Stock', 'gmail')!.messages)).toEqual(order);
  });
  it('joins the chains of two of my own emails through their shared message', () => {
    const batch = { threadId: 'sheffield', currentUserEmail: 'me@example.com' } as SnapshotBatch;
    function snapshot(id: string, html: string, timestamp: string, index: number): MessageSnapshot {
      return { message: { id, sender: buildSender('Sid', 'me@example.com'), timestamp, body: '', source: 'direct', index, isCurrentUser: true }, html, imageSources: [] };
    }
    // Neither email quotes the whole thread; only the copies of Jodie's flag
    // they share can join the older half of the chain to the newer.
    const early = parseSnapshot(snapshot('early', `<p>Thanks Jodie, I am looking at the figures you attached now.</p>${opening}`, '2026-09-09T09:00:00Z', 0), batch);
    const late = parseSnapshot(snapshot('late', `<p>${REPLY}</p>${chain}`, '2026-09-10T11:05:00Z', 1), batch);
    expect(names(mergeMessages([...early, ...late]))).toEqual([...order, 'carrier', 'carrier']);
  });
  it('leaves sibling quotes, which prove no order, to their clocks', () => {
    const el = document.createElement('div');
    // Two branches forwarded side by side: neither encloses the other, so the
    // nesting says nothing about which was sent first.
    el.innerHTML = `<p>Compare these.</p>${attr('Wed, 9 Sept 2026 at 13:28', 'jodie', `<p>${bodies.jodieFlag}</p>`)}${attr('Wed, 9 Sept 2026 at 09:04', 'jay', `<p>${bodies.jayExplain}</p>`)}`;
    const history = extractEmailBody(el, 'me@example.com', 'siblings', anchor, 'carrier').history;
    expect(names(history)).toEqual(['jayExplain', 'jodieFlag']);
    expect(history.some(m => m.orderedByQuote)).toBe(false);
  });
});
describe('HTML and attachment boundaries', () => {
  it('removes active content, tracking requests and layout takeover while preserving formatting', () => {
    const html = sanitizeEmailHtml('<script>alert(1)</script><img src="https://tracker.test/x" width="1" height="1"><div id="app" onclick="evil()" style="position:fixed;background-image:url(https://tracker.test);color:red"><a href="javascript:evil()">bad</a><a href="https://example.com">good</a><table><tr><td rowspan="2">Cell</td></tr></table></div>');
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

describe('Thread order without opening every email', () => {
  const sender = buildSender('Alice', 'alice@example.com');
  /** A collapsed row shows "10:32" only, so its clock cannot be read and the
   * scraper dates it from the moment the panel discovered it. */
  function unread(index: number): ParsedMessage {
    return { id: `u${index}`, sender, timestamp: new Date(Date.parse('2026-09-09T15:00:00Z') + index * 1000).toISOString(),
      timestampEstimated: true, body: `Collapsed ${index}`, source: 'direct', index, isCurrentUser: false };
  }
  function read(index: number, timestamp: string): ParsedMessage {
    return { id: `r${index}`, sender, timestamp, body: `Opened ${index}`, source: 'direct', index, isCurrentUser: false };
  }
  it('keeps unreadable clocks in their mailbox position instead of at the end', () => {
    const merged = mergeMessages([read(0, '2026-09-08T09:00:00Z'), unread(1), unread(2), read(3, '2026-09-08T17:00:00Z'), read(4, '2026-09-09T08:00:00Z')]);
    expect(merged.map(m => m.id)).toEqual(['r0', 'u1', 'u2', 'r3', 'r4']);
    const times = merged.map(m => Date.parse(m.timestamp));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[1]).toBeGreaterThan(Date.parse('2026-09-08T09:00:00Z'));
    expect(times[2]).toBeLessThan(Date.parse('2026-09-08T17:00:00Z'));
    // The time itself is still unknown and stays labelled as an estimate.
    expect(merged[1].timestampEstimated).toBe(true);
  });
  it('places messages before the first and after the last readable clock', () => {
    const merged = mergeMessages([unread(0), read(1, '2026-09-08T09:00:00Z'), unread(2)]);
    expect(merged.map(m => m.id)).toEqual(['u0', 'r1', 'u2']);
  });
  it('leaves a thread alone when every clock was readable', () => {
    const messages = [read(0, '2026-09-08T09:00:00Z'), read(1, '2026-09-08T10:00:00Z')];
    expect(mergeMessages(messages).map(m => m.timestamp)).toEqual(messages.map(m => m.timestamp));
  });
  it('orders equal and unparsable clocks by mailbox position', () => {
    const same = [read(1, '2026-09-08T09:00:00Z'), read(0, '2026-09-08T09:00:00Z')];
    expect(mergeMessages(same).map(m => m.id)).toEqual(['r0', 'r1']);
    const broken = [{ ...read(1, 'not a date'), timestampEstimated: undefined }, read(0, '2026-09-08T09:00:00Z')];
    expect(mergeMessages(broken).map(m => m.id)).toEqual(['r0', 'r1']);
  });
});
describe('Duplicate copies in long multi-person threads', () => {
  const SHIFT = 4.5 * 3600 * 1000;
  const LONG = 'By design StockMaster will have some unresolved inTransit for non-UCP stores because those stores will not have ISL to complete the actual receipting sent to SM, so the closing position shows orphaned records.';
  const FOLLOW_UP = 'Any update on the on-order split for Sheffield North?';
  function direct(id: string, name: string, email: string, timestamp: string, body: string, bodyHtml?: string): ParsedMessage {
    return { id, sender: buildSender(name, email), timestamp, body, bodyHtml: bodyHtml ?? `<div>${body}</div>`, source: 'direct', index: 0, isCurrentUser: false };
  }
  /** The same message as a later email quoted it: the attribution clock is the
   * sender's wall time, so it reads a whole timezone from the provider header. */
  function copy(id: string, name: string, email: string, timestamp: string, body: string, bodyHtml?: string): ParsedMessage {
    return { ...direct(id, name, email, new Date(Date.parse(timestamp) - SHIFT).toISOString(), body, bodyHtml),
      timestampZoneUnknown: true, source: 'quoted', index: -1 };
  }
  it('assigns each copy of two identical follow-ups to the right message', () => {
    const merged = mergeMessages([
      direct('first', 'Alice', 'a@example.com', '2026-09-08T09:00:00Z', FOLLOW_UP),
      direct('second', 'Alice', 'a@example.com', '2026-09-08T15:00:00Z', FOLLOW_UP),
      copy('q-first', 'Alice', 'a@example.com', '2026-09-08T09:00:00Z', FOLLOW_UP),
      copy('q-second', 'Alice', 'a@example.com', '2026-09-08T15:00:00Z', FOLLOW_UP),
    ]);
    expect(merged.map(m => m.id)).toEqual(['first', 'second']);
  });
  it('merges a copy whose attribution named its author without an address', () => {
    const merged = mergeMessages([
      direct('sent', 'Prem Kumar', 'prem.kumar@example.com', '2026-09-09T04:10:00Z', LONG),
      copy('quoted', 'Prem Kumar', 'unknown:Prem Kumar', '2026-09-09T04:10:00Z', LONG),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sender.email).toBe('prem.kumar@example.com');
  });
  it('still separates copies whose only identity is a placeholder name', () => {
    const merged = mergeMessages([
      direct('sent', 'Unknown', 'unknown:Unknown', '2026-09-09T04:10:00Z', LONG),
      copy('quoted', 'Unknown', 'unknown:Unknown', '2026-09-09T04:10:00Z', LONG),
    ]);
    expect(merged).toHaveLength(2);
  });
  it('merges a copy whose inline picture was re-addressed by the provider', () => {
    const merged = mergeMessages([
      direct('sent', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://ci3.googleusercontent.com/proxy/AAA"></div>`),
      copy('quoted', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="blob:https://mail.google.com/9f1c"></div>`),
    ]);
    expect(merged).toHaveLength(1);
  });
  // Each client re-addresses the pictures it passes on, so a different address
  // cannot outvote word-for-word identical text. The copy that differs is kept.
  it('merges word-for-word copies whose pictures are addressed differently, keeping both copies', () => {
    const merged = mergeMessages([
      direct('sent', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://mail.google.com/one.png"></div>`),
      copy('quoted', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://mail.google.com/two.png"></div>`),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quotedVariants).toHaveLength(1);
  });
  it('keeps copies apart when the pictures differ and the wording only resembles', () => {
    const edited = LONG.replace('orphaned records', 'orphaned records for the northern region');
    const merged = mergeMessages([
      direct('sent', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://mail.google.com/one.png"></div>`),
      copy('quoted', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', edited, `<div>${edited}<img src="https://mail.google.com/two.png"></div>`),
    ]);
    expect(merged).toHaveLength(2);
  });
  it('ignores a query the provider varies around one picture', () => {
    const merged = mergeMessages([
      direct('sent', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://mail.google.com/mail/u/0?attid=0.1&permmsgid=msg-f:1"></div>`),
      copy('quoted', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', LONG, `<div>${LONG}<img src="https://mail.google.com/mail/u/0?attid=0.1&permmsgid=msg-f:2"></div>`),
    ]);
    expect(merged).toHaveLength(1);
  });
  it('resolves short copies from an offset two separate copies agree on', () => {
    const merged = mergeMessages([
      direct('long', 'Bob', 'b@example.com', '2026-09-09T08:04:00Z', LONG),
      copy('q-long', 'Bob', 'b@example.com', '2026-09-09T08:04:00Z', LONG),
      direct('short', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', 'Thanks, noted.'),
      copy('q-short', 'Alice', 'a@example.com', '2026-09-09T04:10:00Z', 'Thanks, noted.'),
    ]);
    expect(merged.map(m => m.id)).toEqual(['short', 'long']);
  });
});

describe('Deeply nested enterprise threads and provider-dropped copies', () => {
  const SHIFT = 4.5 * 3600 * 1000;
  const header = (level: number) =>
    `<div><b>From:</b> Person${level} &lt;person${level}@example.com&gt;<br><b>Sent:</b> 0${level} September 2026 10:00 +0000<br><b>To:</b> me@example.com<br><b>Subject:</b> Warehouse transfers</div>`;
  /** Outlook indents each reply in a plain blockquote, so an eight-reply thread
   * nests the oldest message eight wrappers deep. */
  function nested(levels: number): string {
    let chain = '';
    for (let level = 1; level <= levels; level++) {
      chain = `<blockquote style="padding-top:0cm;padding-left:6pt">${header(level)}<p>Message ${level}.</p>${chain}</blockquote>`;
    }
    return chain;
  }
  it('keeps a deeply nested message free of the indent wrappers that quoted it', () => {
    const result = parse(`<p>Latest reply.</p>${nested(8)}`);
    expect(result.body).toBe('Latest reply.');
    expect(result.history).toHaveLength(8);
    const oldest = result.history[0];
    expect(oldest.body).toContain('Message 1.');
    // Every recovered message renders its own words, not a column of the empty
    // indent rules the quoting clients wrapped around them.
    for (const message of result.history) expect(message.bodyHtml ?? '').not.toContain('<blockquote');
  });
  it('still keeps a quotation the author wrote inside their own message', () => {
    const result = parse('<p>Requirement:</p><blockquote>Use the approved spec.</blockquote>' + quote('Earlier note'));
    expect(result.bodyHtml).toContain('<blockquote>');
    expect(result.body).toContain('approved spec');
  });
  it('drops a quote shell left empty by the split without touching one with content', () => {
    expect(sanitizeEmailHtml('<p>Reply</p><blockquote> <br> </blockquote>')).toBe('<p>Reply</p>');
    expect(sanitizeEmailHtml('<blockquote><blockquote> </blockquote></blockquote>')).toBe('');
    expect(sanitizeEmailHtml('<blockquote>Quoted line</blockquote>')).toContain('Quoted line');
  });

  const NOTE = 'Hi Person 1, I have checked and currently there are no in-progress warehouse transfers.';
  const sentAt = Date.parse('2026-09-05T18:36:00Z');
  function direct(id: string, body: string, bodyHtml: string, extra: Partial<ParsedMessage> = {}): ParsedMessage {
    return { id, sender: buildSender('Dana', 'dana@example.com'), timestamp: new Date(sentAt).toISOString(), body, bodyHtml, source: 'direct', index: 0, isCurrentUser: false, ...extra };
  }
  /** Gmail does not repeat a message's attachments or all of its pictures when
   * a later reply quotes it, and the attribution clock carries no offset. */
  function quoted(id: string, body: string, bodyHtml: string, shift = SHIFT): ParsedMessage {
    return { ...direct(id, body, bodyHtml), id, timestamp: new Date(sentAt - shift).toISOString(), source: 'quoted', timestampZoneUnknown: true, index: -1 };
  }
  it('merges the email the mailbox holds with the copy a reply quoted without its attachments', () => {
    const merged = mergeMessages([
      direct('provider', NOTE, `<div>${NOTE}</div>`, { attachments: [
        { name: 'image005.png', mimeType: 'image/png', sizeLabel: '12 KB', downloadUrl: 'https://mail.google.com/?view=att&attid=5' },
        { name: 'image006.png', mimeType: 'image/png', sizeLabel: '9 KB', downloadUrl: 'https://mail.google.com/?view=att&attid=6' },
      ] }),
      quoted('in-quote', NOTE, `<div>${NOTE}</div>`),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('provider');
    expect(merged[0].attachments?.map(a => a.name)).toEqual(['image005.png', 'image006.png']);
    expect(merged[0].timestamp).toBe(new Date(sentAt).toISOString());
  });
  const logos = (ids: number[]) => ids.map(id => `<img src="cid:logo${id}@corp">`).join('');
  it('merges copies whose quoted signature kept fewer of the same pictures', () => {
    const full = `<div>${NOTE}<br>Regards${logos([0, 1, 2, 3, 4, 5, 6])}</div>`;
    const partial = `<div>${NOTE}<br>Regards${logos([0, 3, 6])}</div>`;
    const merged = mergeMessages([quoted('full', NOTE, full, 0), quoted('partial', NOTE, partial, 0)]);
    expect(merged).toHaveLength(1);
    // Dropped logos are presentation loss, not changed content.
    expect(merged[0].quotedVariants ?? []).toHaveLength(0);
    expect(merged[0].bodyHtml).toBe(full);
  });
  it('keeps a differing picture as a variant rather than as a second message', () => {
    const mine = `<div>${NOTE}<br>Regards${logos([0, 1, 2])}</div>`;
    const theirs = `<div>${NOTE}<br>Regards${logos([0, 9, 2])}</div>`;
    const merged = mergeMessages([quoted('mine', NOTE, mine, 0), quoted('theirs', NOTE, theirs, 0)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quotedVariants).toHaveLength(1);
  });
  it('keeps a brief copy apart when its one picture differs', () => {
    const brief = 'Noted, thanks.';
    const mine = `<div>${brief}${logos([0])}</div>`;
    const theirs = `<div>${brief}${logos([9])}</div>`;
    expect(mergeMessages([quoted('mine', brief, mine, 0), quoted('theirs', brief, theirs, 0)])).toHaveLength(2);
  });
});

describe('Provider-trimmed copies of one message', () => {
  const sender = buildSender('Dana', 'dana@example.com');
  const NOTE = 'Hi Person 5, can you please help prioritise the analysis of the below topic? Hours can be allocated from our recurring SOW.';
  const copy = (id: string, body: string): ParsedMessage =>
    ({ id, sender, timestamp: '2026-08-07T06:45:00Z', body, bodyHtml: `<div>${body}</div>`, source: 'quoted', index: -1, isCurrentUser: false });
  it('treats "Thanks & Regards" as the end of the message when matching copies', () => {
    const full = `${NOTE}\n\nThanks & Regards\n\nDana\n\nProduct Delivery Manager\n\nVision House | Colonial Way | Watford | WD24 4JL\n\ndana@example.com`;
    const shorter = `${NOTE}\n\nThanks & Regards\n\nDana\n\nProduct Delivery Manager`;
    expect(mergeMessages([copy('full', full), copy('shorter', shorter)])).toHaveLength(1);
  });
  const WHOLE = `${NOTE}\n\nThe reconciliation covers twelve stores across the northern region, and the opening position for each of them is set out in the attached workbook.`;
  it('merges a copy Gmail clipped into the complete one, and shows the complete words', () => {
    const clipped = `${NOTE}\n\n…\n\n[Message clipped]  View entire message`;
    const merged = mergeMessages([copy('clipped', clipped), copy('whole', WHOLE)]);
    expect(merged).toHaveLength(1);
    // The message reads as it was written, without a redundant clipped variant.
    expect(merged[0].body).toContain('attached workbook');
    expect(merged[0].quotedVariants ?? []).toHaveLength(0);
  });
  it('does not treat a clipped copy as any message that merely starts the same way', () => {
    const other = `Hi Person 5, could you confirm the opening position for the southern region before Friday? The reconciliation workbook is attached for reference.`;
    const clipped = `${NOTE}\n\n…\n\n[Message clipped]  View entire message`;
    expect(mergeMessages([copy('clipped', clipped), copy('other', other)])).toHaveLength(2);
  });
  it('needs the provider own notice, not merely a body that stops earlier', () => {
    expect(mergeMessages([copy('shorter', NOTE), copy('whole', WHOLE)])).toHaveLength(2);
  });
});

describe('Header blocks the first pass could not read', () => {
  it('consumes a recipient list that wrapped between a name and its address', () => {
    const result = parse('<p>Latest reply.</p><div><b>From:</b> Alex &lt;alex@example.com&gt;<br>'
      + '<b>Sent:</b> 10 August 2026 16:45 +0000<br>'
      + '<b>To:</b> Dana &lt;dana@example.com&gt;<br>'
      + '<b>Cc:</b> Rae &lt;rae@example.com&gt;; Kim &lt;kim@example.com&gt;;<br>'
      + ' Lou &lt;lou@example.com&gt;; Nils<br>'
      + '&lt;nils@example.com&gt;<br>'
      + '<b>Subject:</b> RE: Warehouse transfers</div><p>The opening position is attached.</p>');
    expect(result.history).toHaveLength(1);
    // Neither the rest of the list nor the Subject line is part of the message.
    expect(result.history[0].body).toBe('The opening position is attached.');
    expect(result.history[0].recipients).toEqual(expect.arrayContaining(['lou@example.com', 'nils@example.com']));
  });
  it('starts a message past a header remnant left stranded at the top of a body', () => {
    const stranded = quote('Kim &lt;kim@example.com&gt;; Lou &lt;lou@example.com&gt;<br>Subject: RE: Warehouse transfers<br>Hi Dana,<br>We are looking at it today.');
    const result = parse(`<p>Thanks.</p>${stranded}`);
    expect(result.history[0].body.startsWith('Hi Dana,')).toBe(true);
    expect(result.history[0].body).not.toContain('Subject:');
  });
  it('splits a quoted email whose header the provider broke with hidden content', () => {
    // Gmail leaves hidden nodes inside a quoted header; they break the field
    // lines on the first read and are gone once the body has been rebuilt.
    const header = '<div><b>From:</b> Bob &lt;bob@example.com&gt;<div style="display:none">tracking</div>'
      + '<br><b>Sent:</b> 8 September 2026 09:00 +0000<br><b>To:</b> alice@example.com<br><b>Subject:</b> Hi</div>';
    const result = parse('<p>Latest.</p>' + quote(`<p>Alice text.</p>${header}<p>Bob wrote the earlier message.</p>`));
    expect(result.history.map(m => m.sender.email)).toEqual(['bob@example.com', 'alice@example.com']);
    expect(result.history.map(m => m.body)).toEqual(['Bob wrote the earlier message.', 'Alice text.']);
    // The recovered messages hold their own words, not each other's headers.
    for (const message of result.history) expect(message.body).not.toMatch(/^[ \t]*Sent:/m);
  });
});

describe('Clock skew, tenant banners and reply order across timezones', () => {
  const OFFSET = 4.5 * 3600 * 1000, SKEW = 4 * 60000;
  const QUESTION = 'Morning, what is your availability for the rest of the week for a quick call on the reconciliation?';
  const ANSWER = 'I am available anytime Thursday and Friday.';
  const questionAt = Date.parse('2026-08-12T09:40:00Z'), answerAt = Date.parse('2026-08-12T10:51:00Z');
  const wall = (ms: number) => {
    const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  /** The quoting client writes its own clock, set a few minutes from the server's. */
  const attribution = (ms: number, who: string, body: string) =>
    `<div class="gmail_attr">On ${wall(ms - OFFSET - SKEW)}, <a href="mailto:${who}@example.com">${who}</a> wrote:</div><blockquote class="gmail_quote">${body}</blockquote>`;
  const banner = '<div>ⓘ</div><div>External</div><div>email</div><div>❯</div>';

  it('merges copies whose clocks differ by an offset plus a few minutes of skew', () => {
    const history = parse(attribution(questionAt, 'pat', `<p>${QUESTION}</p>`)).history;
    const direct: ParsedMessage = { id: 'provider', sender: buildSender('pat', 'pat@example.com'), timestamp: new Date(questionAt).toISOString(),
      body: QUESTION, bodyHtml: `<p>${QUESTION}</p>`, source: 'direct', index: 0, isCurrentUser: false };
    const merged = mergeMessages([direct, ...history]);
    expect(merged).toHaveLength(1);
    expect(merged[0].timestamp).toBe(new Date(questionAt).toISOString());
  });
  it('ignores a tenant external-sender banner stamped on only one copy', () => {
    const history = parse(attribution(questionAt, 'pat', `<p>${QUESTION}</p>`)).history;
    const direct: ParsedMessage = { id: 'provider', sender: buildSender('pat', 'pat@example.com'), timestamp: new Date(questionAt).toISOString(),
      body: `ⓘ\nExternal\nemail\n❯\n${QUESTION}`, bodyHtml: `${banner}<p>${QUESTION}</p>`, source: 'direct', index: 0, isCurrentUser: false };
    const merged = mergeMessages([direct, ...history]);
    expect(merged).toHaveLength(1);
    // The banner is ignored for matching, not deleted from what is shown.
    expect(merged[0].body).toContain('External');
  });
  it('never places an answer before the message it quoted, and says why', () => {
    // A later email quotes the answer, which quotes the question: the question
    // was therefore sent first, whatever the two zoneless clocks read.
    const chain = attribution(answerAt, 'sam', `<p>${ANSWER}</p>${attribution(questionAt, 'pat', `<p>${QUESTION}</p>`)}`);
    const history = parse(`<p>Thanks both.</p>${chain}`).history;
    const direct: ParsedMessage = { id: 'provider', sender: buildSender('pat', 'pat@example.com'), timestamp: new Date(questionAt).toISOString(),
      body: QUESTION, bodyHtml: `<p>${QUESTION}</p>`, source: 'direct', index: 0, isCurrentUser: false };
    const merged = mergeMessages([direct, ...history]);
    const question = merged.findIndex(m => m.body.includes('availability'));
    const answer = merged.findIndex(m => m.body.includes('Thursday and Friday'));
    expect(question).toBeGreaterThanOrEqual(0);
    expect(question).toBeLessThan(answer);
    // The answer's own clock reads earlier, so both are marked as chain-placed.
    expect(Date.parse(merged[answer].timestamp)).toBeLessThan(Date.parse(merged[question].timestamp));
    expect(merged[answer].orderedByQuote).toBe(true);
    expect(merged[question].orderedByQuote).toBe(true);
  });
});

describe('An email that adds no words of its own', () => {
  const batch = { threadId: 'forwarded', currentUserEmail: 'me@example.com' } as SnapshotBatch;
  const quoted = '<div class="gmail_attr">On Sun, Sep 6, 2026 at 10:00 AM <a href="mailto:alice@example.com">Alice</a> wrote:</div><blockquote class="gmail_quote"><p>The opening position is attached.</p></blockquote>';
  function carrier(recipients?: string[]): ParsedMessage[] {
    const message: ParsedMessage = { id: 'fwd', sender: buildSender('Sid', 'me@example.com'), timestamp: '2026-09-09T09:00:00Z',
      body: '', source: 'direct', index: 0, isCurrentUser: true, ...(recipients ? { recipients } : {}) };
    return parseSnapshot({ message, html: quoted, imageSources: [] }, batch);
  }
  it('says who passed the conversation on and to whom', () => {
    const envelope = carrier(['dana@example.com', 'rae@example.com']).find(m => m.id === 'fwd')!;
    expect(envelope.historyCarrier).toBe(true);
    expect(envelope.body).toBe('Sid passed this conversation on to dana@example.com, rae@example.com without adding a message. Everything below was quoted from the thread.');
  });
  it('names a long recipient list without listing all of it', () => {
    const envelope = carrier(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']).find(m => m.id === 'fwd')!;
    expect(envelope.body).toContain('a@example.com, b@example.com and 2 others');
  });
  it('still records the event when no recipients were readable', () => {
    const envelope = carrier().find(m => m.id === 'fwd')!;
    expect(envelope.body).toBe('Sid passed this conversation on without adding a message. Everything below was quoted from the thread.');
    // The quoted history is still recovered as messages in its own right.
    expect(carrier().some(m => m.body === 'The opening position is attached.')).toBe(true);
  });
  it('keeps an email that did add words as an ordinary message', () => {
    const message: ParsedMessage = { id: 'reply', sender: buildSender('Sid', 'me@example.com'), timestamp: '2026-09-09T09:00:00Z',
      body: '', source: 'direct', index: 0, isCurrentUser: true, recipients: ['dana@example.com'] };
    const parsed = parseSnapshot({ message, html: `<p>Please see below.</p>${quoted}`, imageSources: [] }, batch).find(m => m.id === 'reply')!;
    expect(parsed.historyCarrier).toBeFalsy();
    expect(parsed.body).toBe('Please see below.');
  });
});
