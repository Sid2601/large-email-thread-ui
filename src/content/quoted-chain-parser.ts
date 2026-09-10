/** Recover included history without flattening the original message markup. */
import type { ParsedMessage } from '../types';
import { buildSender, htmlToText, generateId, sanitizeEmailHtml } from './scraper-utils';

import { mergeMessages } from './message-reconciliation';
export { mergeMessages } from './message-reconciliation';

type Point = { node: Node; offset: number };
type Header = { start: number; end: number; sender: ReturnType<typeof buildSender>; date: string; scopeEnd?: number; recipients?: string[] };
const BLOCK = /^(DIV|P|BLOCKQUOTE|TR|H[1-6]|LI|PRE|HR)$/;

// A text projection with a DOM point per character lets us split even headers
// spread across spans/bold tags, while cloning tables and lists intact.
function project(root: Element) {
  let text = '';
  const points: Point[] = [];
  const spans = new Map<Element, [number, number]>();
  function add(s: string, node: Node, offset: number) {
    for (let i = 0; i < s.length; i++) {
      text += s[i];
      points.push({ node, offset: node.nodeType === Node.TEXT_NODE ? offset + i : offset });
    }
  }
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) { add(node.textContent ?? '', node, 0); return; }
    if (!(node instanceof Element)) return;
    if (BLOCK.test(node.tagName) || node.tagName === 'BR') add('\n', node, 0);
    const start = text.length;
    node.childNodes.forEach(visit);
    spans.set(node, [start, text.length]);
    if (BLOCK.test(node.tagName)) add('\n', node, node.childNodes.length);
  }
  visit(root);
  function slice(start: number, end: number) {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end) return '';
    const range = document.createRange();
    const a = points[start], b = points[end - 1];
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset + (b.node.nodeType === Node.TEXT_NODE ? 1 : 0));
    const div = document.createElement('div');
    div.append(range.cloneContents());
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode!;
    while (ancestor instanceof Element && ancestor !== root) {
      // Restore the formatting context omitted by cloneContents (notably a
      // single-cell table, bold span, or ordered list containing one item).
      if (!ancestor.matches('.gmail_quote, blockquote.gmail_quote')) {
        const wrapper = ancestor.cloneNode(false) as Element;
        wrapper.append(...Array.from(div.childNodes));
        div.append(wrapper);
      }
      ancestor = ancestor.parentNode!;
    }
    return sanitizeEmailHtml(div.innerHTML);
  }
  return { text, spans, slice };
}

function sender(raw: string) {
  const email = raw.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? '';
  const name = raw.replace(email, '').replace(/\[mailto:[^\]]*\]/gi, '').replace(/[<>"()]/g, '').trim();
  return buildSender(name || email.split('@')[0] || 'Unknown', email || `unknown:${name}`);
}

/** Attribution text written by a replying client carries that client's wall
 * clock. Without an explicit offset the same message reads hours away from the
 * provider header, which is rendered in the reader's own timezone. */
export function hasExplicitTimezone(raw: string): boolean {
  return /[+-]\d{2}:?\d{2}\b|\b(?:GMT|UTC|UT|Z)\b/i.test(raw);
}

export function parseEmailDate(raw: string, fallback: string) {
  let normalized = raw.replace(/,?\s+at\s+/i, ' ').replace(/\u202f|\u00a0/g, ' ').replace(/\s*\([^)]*ago\)\s*$/i, '').trim();
  const anchor = new Date(fallback);
  const hasYear = /\b(?:19|20)\d{2}\b/.test(normalized);
  if (!hasYear) {
    // JS Date.parse silently assigns 2001 to some month/day-only strings.
    const monthDay = normalized.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)/i);
    if (monthDay && Number.isFinite(anchor.getTime())) normalized = normalized.replace(monthDay[0], `${monthDay[0]} ${anchor.getFullYear()}`);
    else return { timestamp: fallback, timestampEstimated: true };
  }
  let ms = Date.parse(normalized);
  // A December quote seen in early January usually belongs to the prior year.
  if (!hasYear && Number.isFinite(ms) && ms > anchor.getTime() + 86400000) {
    const inferred = new Date(ms); inferred.setFullYear(inferred.getFullYear() - 1); ms = inferred.getTime();
  }
  return { timestamp: Number.isFinite(ms) ? new Date(ms).toISOString() : fallback, timestampEstimated: !hasYear || !Number.isFinite(ms) };
}

export function recipientEmails(raw: string): string[] {
  return Array.from(new Set((raw.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []).map(email => email.toLowerCase())));
}

function isRecipientContinuation(line: string): boolean {
  const email = /(?:[^<>;,]+<)?[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}>?/gi;
  return recipientEmails(line).length > 0 && !line.replace(email, '').replace(/[\s;,]/g, '');
}

export function extractEmailBody(bodyEl: Element, currentUserEmail: string, threadId: string, anchorTimestamp: string) {
  const root = bodyEl.cloneNode(true) as Element;
  root.querySelectorAll('script,style,iframe,object,form,u.q').forEach(el => el.remove());
  // Collapsed quote history may already be loaded but hidden by the provider.
  // Keep it for extraction; sanitization removes hidden/display attributes.
  const p = project(root);
  const headers: Header[] = [];
  // Gmail DOM attribution is authoritative, including names without addresses.
  root.querySelectorAll('.gmail_attr').forEach(el => {
    const span = p.spans.get(el)!;
    const raw = el.textContent?.trim() ?? '';
    const match = raw.match(/^On\s+([\s\S]+?)\s+(.+?)\s+wrote:\s*$/i);
    const a = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    if (!/wrote:\s*$/i.test(raw)) return;
    const address = a?.getAttribute('href')?.slice(7).split('?')[0] ?? '';
    const name = a?.textContent?.trim() ?? '';
    // Date precedes the sender; stop at the time (plus optional timezone).
    const date = raw.match(/^On\s+(.+?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s*(?:[+-]\d{4}|GMT|UTC))?)/i)?.[1] ?? match?.[1] ?? '';
    const who = a ? buildSender(name || address, address) : sender(raw.slice(date.length + 3).replace(/wrote:\s*$/i, ''));
    let quote = el.nextElementSibling;
    while (quote && !quote.matches('blockquote, .gmail_quote, .gmail_attr')) quote = quote.nextElementSibling;
    const enclosing = el.closest('blockquote, .gmail_quote');
    const scope = quote?.matches('blockquote, .gmail_quote') ? quote : enclosing;
    headers.push({ start: span[0], end: span[1], sender: who, date, scopeEnd: scope ? p.spans.get(scope)?.[1] : undefined });
  });
  // Outlook/forward headers: require a date and recipient/subject to avoid
  // interpreting ordinary prose containing "From:" as a new message.
  const re = /^[ \t>]*(?:From|De|Von|Van):[ \t]*([^\n]+)\n/igm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p.text))) {
    const rest = p.text.slice(m.index + m[0].length);
    const lines = rest.split('\n');
    let consumed = 0, date = '', evidence = false, fields = 0;
    const recipients: string[] = [];
    let previousField = '';
    let recipientContinuation = false;
    for (const line of lines.slice(0, 24)) {
      const field = line.match(/^[\s>]*(Sent|Date|Envoyé|Gesendet|Verzonden|To|À|An|Aan|Cc|Subject|Objet|Betreff):\s*(.*)$/i);
      if (!line.trim()) { consumed += line.length + 1; continue; }
      if (!field) {
        // Outlook wraps long To/Cc lists onto additional lines.
        if (/^(To|À|An|Aan|Cc)$/i.test(previousField) && recipientContinuation && isRecipientContinuation(line)) {
          recipients.push(...recipientEmails(line)); recipientContinuation = /[,;]\s*$/.test(line); consumed += line.length + 1; continue;
        }
        break;
      }
      previousField = field[1];
      recipientContinuation = /[,;]\s*$/.test(field[2]);
      if (/^(To|À|An|Aan|Cc)$/i.test(field[1])) recipients.push(...recipientEmails(field[2]));
      fields++;
      if (/^(Sent|Date|Envoyé|Gesendet|Verzonden)$/i.test(field[1])) date = field[2];
      else evidence = true;
      consumed += line.length + 1;
    }
    if (!date || !evidence || fields < 2) continue;
    let start = m.index;
    const prefix = p.text.slice(0, start);
    const separator = prefix.match(/(?:[-─—]{5,}\s*(?:Forwarded message|Original Message)\s*[-─—]{5,})\s*$/i);
    if (separator) start = separator.index!;
    headers.push({ start, end: m.index + m[0].length + consumed, sender: sender(m[1]), date, recipients });
  }
  // Plain-text "On ... wrote:" replies, including those forwarded from mobile.
  const onRe = /^[ \t>]*On[ \t]+([^\n]+(?:\n[ \t>]*[^\n]+){0,2}?)\s+wrote:[ \t]*$/igm;
  while ((m = onRe.exec(p.text))) {
    if (headers.some(h => m!.index >= h.start && m!.index < h.end)) continue;
    const d = m[1].replace(/\n[ \t>]*/g, ' ').match(/^(.+?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s*(?:[+-]\d{4}|GMT|UTC))?)[,\s]+(.+)$/i);
    if (d) headers.push({ start: m.index, end: m.index + m[0].length, sender: sender(d[2]), date: d[1] });
  }
  headers.sort((a, b) => a.start - b.start);
  const unique = headers.filter((h, i) => !i || h.start >= headers[i - 1].end);
  // Finite Gmail quote scopes keep trailing outer signatures/replies with
  // their author instead of appending them to the oldest nested message.
  for (const header of unique) {
    if (header.scopeEnd === undefined) {
      header.scopeEnd = Math.min(p.text.length, ...unique.filter(parent => parent !== header && parent.start < header.start && parent.scopeEnd !== undefined && parent.scopeEnd > header.end).map(parent => parent.scopeEnd!));
    }
  }
  function content(start: number, end: number) {
    const exclusions = unique.filter(header => header.start >= start && header.start < end)
      .map(header => [header.start, Math.min(header.scopeEnd!, end)]);
    let cursor = start;
    const html: string[] = [];
    const append = (from: number, to: number) => {
      const footer = p.text.slice(from, to).search(/(?:this e-?mail and any attachments|this message contains information that is confidential|agreements binding|e-?mail transmissions are not secure)/i);
      if (footer >= 0) to = from + footer;
      html.push(p.slice(from, to));
    };
    for (const [from, to] of exclusions) {
      if (from > cursor) append(cursor, from);
      cursor = Math.max(cursor, to);
    }
    if (cursor < end) append(cursor, end);
    const bodyHtml = html.filter(Boolean).join('<br>');
    return { bodyHtml, body: htmlToText(bodyHtml) };
  }
  const history = unique.map((h, i): ParsedMessage => {
    const body = content(h.end, h.scopeEnd!);
    const fallback = new Date((Date.parse(anchorTimestamp) || 0) - (i + 1) * 1000).toISOString();
    const date = parseEmailDate(h.date, fallback);
    // Only a clock we actually read from the header can be zone-shifted; an
    // unparsed date already falls back to the carrier's position in the thread.
    const zoneUnknown = date.timestamp !== fallback && !hasExplicitTimezone(h.date);
    const key = `${threadId}:${h.sender.email}:${h.date}:${body.body.replace(/\s+/g, ' ').trim()}`;
    return { id: generateId(key, 'chain'), sender: h.sender, ...date, ...(zoneUnknown ? { timestampZoneUnknown: true } : {}), ...body, source: 'quoted', recipients: h.recipients,
      isCurrentUser: !!currentUserEmail && h.sender.email === currentUserEmail.toLowerCase(), index: -i - 1 };
  }).filter(m => m.body || /<table/i.test(m.bodyHtml ?? ''));
  return { ...content(0, p.text.length), history: mergeMessages(history) };
}

export function parseQuotedChain(body: Element, user: string, thread: string, anchor: string): ParsedMessage[] {
  return extractEmailBody(body, user, thread, anchor).history;
}
