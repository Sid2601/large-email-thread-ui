/** Recover included history without flattening the original message markup. */
import type { ParsedMessage } from '../types';
import { buildSender, htmlToText, generateId, sanitizeEmailHtml } from './scraper-utils';

import { mergeMessages, imageIdentity } from './message-reconciliation';
export { mergeMessages } from './message-reconciliation';

type TextRun = { start: number; end: number; node: Node; offset: number; image?: boolean };
type Header = { start: number; end: number; sender: ReturnType<typeof buildSender>; date: string; scopeEnd?: number; recipients?: string[] };
const BLOCK = /^(DIV|P|BLOCKQUOTE|TR|H[1-6]|LI|PRE|HR)$/;

// One DOM mapping per text run avoids allocating an object for every character.
// Range slices still preserve headers spread across spans, tables, and lists.
function project(root: Element) {
  const chunks: string[] = [];
  let length = 0;
  const runs: TextRun[] = [];
  const spans = new Map<Element, [number, number]>();
  function add(s: string, node: Node, offset: number, image = false) {
    if (!s) return;
    runs.push({ start: length, end: length + s.length, node, offset, image });
    chunks.push(s); length += s.length;
  }
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) { add(node.textContent ?? '', node, 0); return; }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'IMG' && node.parentNode) {
      add('\uFFFC', node.parentNode, Array.from(node.parentNode.childNodes).indexOf(node), true);
      return;
    }
    if (BLOCK.test(node.tagName) || node.tagName === 'BR') add('\n', node, 0);
    const start = length;
    node.childNodes.forEach(visit);
    spans.set(node, [start, length]);
    if (BLOCK.test(node.tagName)) add('\n', node, node.childNodes.length);
  }
  visit(root);
  const text = chunks.join('');
  function point(index: number, end = false) {
    let low = 0, high = runs.length - 1;
    while (low < high) { const mid = (low + high) >>> 1; if (runs[mid].end <= index) low = mid + 1; else high = mid; }
    const run = runs[low];
    return { node: run.node, offset: run.offset + (run.node.nodeType === Node.TEXT_NODE ? index - run.start + Number(end) : run.image && end ? 1 : 0) };
  }
  function slice(start: number, end: number) {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end) return '';
    const range = root.ownerDocument.createRange();
    const a = point(start), b = point(end - 1, true);
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const div = root.ownerDocument.createElement('div');
    div.append(range.cloneContents());
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode!;
    while (ancestor instanceof Element && ancestor !== root) {
      // Restore the formatting context omitted by cloneContents (notably a
      // single-cell table, bold span, or ordered list containing one item).
      // A quote wrapper enclosing the whole segment is not that: it is the
      // indent the quoting client put around the message, and a deep thread
      // restored one per reply, drawing a column of empty vertical rules
      // before every recovered message. An author's own quotation sits inside
      // the message and is cloned with it, so it is unaffected.
      if (!ancestor.matches('blockquote, .gmail_quote')) {
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
  const name = raw.replace(email, '').replace(/\[mailto:[^\]]*\]/gi, '').replace(/[<>"()]/g, '')
    // An attribution separates the date from the author with punctuation.
    .replace(/^[\s,;:·•-]+/, '').replace(/[\s,;:]+$/, '').trim();
  return buildSender(name || email.split('@')[0] || 'Unknown', email || `unknown:${name}`);
}

/** Attribution text written by a replying client carries that client's wall
 * clock. Without an explicit offset the same message reads hours away from the
 * provider header, which is rendered in the reader's own timezone. */
export function hasExplicitTimezone(raw: string): boolean {
  // A trailing ISO Z follows a digit, where a word boundary never appears.
  return /[+-]\d{2}:?\d{2}\b|\b(?:GMT|UTC|UT|Z)\b|\dZ$/i.test(raw);
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

const ADDRESSED_RECIPIENT = /(?:"[^"]*"|[^<>;,]+)?<?[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}>?/gi;
// A display name, not prose: capitalised words or initials, at most a few of
// them. Lower-case words mean the line is the message, not the header.
const TRAILING_NAME = /^[\p{Lu}\p{N}][\p{L}\p{N}.'\u2019-]*(?:[ \t]+[\p{Lu}\p{N}][\p{L}\p{N}.'\u2019-]*){0,4}$/u;
/** What a recipient line leaves behind once its addresses are removed. */
function recipientRemainder(line: string): string {
  return line.replace(ADDRESSED_RECIPIENT, '').replace(/[\s;,]+/g, ' ').trim();
}
/**
 * Outlook wraps a long To/Cc list at whatever column it reaches, including
 * between a display name and its own address, so a wrapped line can end with a
 * bare name and the next can begin with a lone address. Both are still the
 * header, and reading them as the message left recipient lists and the Subject
 * line stranded at the top of the body.
 */
function isRecipientContinuation(line: string): boolean {
  if (!recipientEmails(line).length) return false;
  const rest = recipientRemainder(line);
  return !rest || (rest.length <= 60 && TRAILING_NAME.test(rest));
}
/** The list is unfinished: it ends with a separator, or with a name whose
 * address wrapped onto the next line. */
function recipientsContinue(value: string): boolean {
  return /[,;]\s*$/.test(value) || !!recipientRemainder(value);
}

/**
 * A complete quoted header block still sitting inside an extracted body. One
 * provider shape can defeat the first pass — a wrapped recipient list, an
 * unexpected element between the fields — and the result is two emails shown
 * as one. Re-reading the extracted body catches it whatever the cause was,
 * because the second pass sees the rebuilt markup rather than the provider's.
 */
const UNSPLIT_HEADER = /^[ \t>]*(?:From|De|Von|Van):[ \t]*\S[^\n]*\n[\s\S]{0,800}?^[ \t>]*(?:Sent|Date|Envoyé|Gesendet|Verzonden):/im;
const MAX_RESCAN_DEPTH = 2;

export function extractEmailBody(bodyEl: Element, currentUserEmail: string, threadId: string, anchorTimestamp: string, carrierId = anchorTimestamp, depth = 0) {
  const inert = new DOMParser().parseFromString('', 'text/html');
  const root = inert.importNode(bodyEl, true) as Element;
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
    // Gmail links the address and leaves the display name in the text beside it.
    const labelled = sender(raw.slice(date.length + 3).replace(/wrote:\s*$/i, ''));
    const who = a ? buildSender(labelled.name && labelled.name !== address ? labelled.name : name || address, address) : labelled;
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
    let consumed = 0, date = '', evidence = false, fields = 0, stray = 0;
    const recipients: string[] = [];
    let previousField = '';
    let recipientContinuation = false;
    const scan = lines.slice(0, 24);
    const FIELD = /^[\s>]*(Sent|Date|Envoyé|Gesendet|Verzonden|To|À|An|Aan|Cc|Subject|Objet|Betreff):\s*(.*)$/i;
    const NEW_BLOCK = /^[\s>]*(?:From|De|Von|Van):/i;
    for (let i = 0; i < scan.length; i++) {
      const line = scan[i];
      const field = line.match(FIELD);
      if (!line.trim()) { consumed += line.length + 1; continue; }
      if (!field) {
        // Outlook wraps long To/Cc lists onto additional lines.
        if (/^(To|À|An|Aan|Cc)$/i.test(previousField) && recipientContinuation && isRecipientContinuation(line)) {
          recipients.push(...recipientEmails(line)); recipientContinuation = recipientsContinue(line); consumed += line.length + 1; continue;
        }
        // A short stray line inside the block — a hidden element the provider
        // left behind, an inline warning banner — used to reject the whole
        // header and show two emails as one. It is skipped while the fields
        // plainly continue underneath it.
        const ahead = scan.slice(i + 1, i + 4);
        const nextField = ahead.findIndex(next => FIELD.test(next));
        const nextBlock = ahead.findIndex(next => NEW_BLOCK.test(next));
        // Only inside this block: a field that belongs to the next email means
        // this line is the message between them, not stray header noise.
        if (stray < 2 && line.trim().length <= 80 && !NEW_BLOCK.test(line)
          && nextField >= 0 && (nextBlock < 0 || nextField < nextBlock)) {
          stray++; consumed += line.length + 1; continue;
        }
        break;
      }
      previousField = field[1];
      recipientContinuation = recipientsContinue(field[2]);
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
  /**
   * A header block whose fields wrapped in a shape the scanner stopped at
   * leaves its tail — the rest of a recipient list, the Subject line — at the
   * top of the message. Those lines belong to nobody's message, so a body is
   * started past them.
   */
  function skipStrandedHeader(start: number, end: number): number {
    let cursor = start, consumed = 0;
    while (cursor < end && consumed < 8) {
      const breakAt = p.text.indexOf('\n', cursor);
      const stop = breakAt < 0 || breakAt > end ? end : breakAt;
      const line = p.text.slice(cursor, stop);
      if (!line.trim()) { cursor = stop + 1; continue; }
      const field = /^[\s>]*(?:To|À|An|Aan|Cc|Bcc|Subject|Objet|Betreff|Sent|Date|Envoyé|Gesendet|Verzonden):/i.test(line);
      if (!field && !isRecipientContinuation(line)) break;
      cursor = stop + 1; consumed++;
    }
    return consumed ? Math.min(cursor, end) : start;
  }
  function content(rawStart: number, end: number) {
    const start = skipStrandedHeader(rawStart, end);
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
  const bodies = unique.map(h => content(h.end, h.scopeEnd!));
  const ids = unique.map((h, i) => generateId(`${threadId}:${h.sender.email}:${h.date}:${bodies[i].body.replace(/\s+/g, ' ').trim()}:${imageIdentity(bodies[i].bodyHtml)}`, 'chain'));
  // The innermost header enclosing this one belongs to the client that quoted
  // it, so that author replied to this message. Siblings enclose nothing and
  // stay unordered: only real nesting is evidence.
  const enclosing = unique.map(h => {
    for (let i = unique.length - 1; i >= 0; i--) if (unique[i].start < h.start && unique[i].scopeEnd! > h.start) return i;
    return -1;
  });
  const drafts = unique.map((h, i): ParsedMessage => {
    const body = bodies[i];
    const fallback = new Date((Date.parse(anchorTimestamp) || 0) - (i + 1) * 1000).toISOString();
    const date = parseEmailDate(h.date, fallback);
    // Only a clock we actually read from the header can be zone-shifted; an
    // unparsed date already falls back to the carrier's position in the thread.
    const zoneUnknown = date.timestamp !== fallback && !hasExplicitTimezone(h.date);
    return { id: ids[i], sender: h.sender, ...date, ...(zoneUnknown ? { timestampZoneUnknown: true } : {}), ...body, source: 'quoted', recipients: h.recipients,
      isCurrentUser: !!currentUserEmail && h.sender.email === currentUserEmail.toLowerCase(), index: -i - 1 };
  });
  const kept = drafts.map(m => !!(m.body || /<(?:table|img)\b/i.test(m.bodyHtml ?? '')));
  // An empty quote is dropped, so its children name the nearest surviving
  // quoter instead — still a message that was certainly sent after them.
  const quoter = (i: number): string => i < 0 ? carrierId : kept[i] ? ids[i] : quoter(enclosing[i]);
  const history = drafts.map((m, i) => ({ ...m, quotedBy: quoter(enclosing[i]) })).filter((_, i) => kept[i]);

  /** Re-reads one recovered body, replacing it with what it actually holds. */
  const rescan = (message: ParsedMessage): ParsedMessage[] => {
    if (!message.bodyHtml || !UNSPLIT_HEADER.test(message.body)) return [message];
    const holder = inert.createElement('div');
    holder.innerHTML = message.bodyHtml;
    const nested = extractEmailBody(holder, currentUserEmail, threadId, message.timestamp, message.id, depth + 1);
    if (!nested.history.length) return [message];
    const own = { ...message, body: nested.body, bodyHtml: nested.bodyHtml };
    // An envelope holding nothing but the emails it quoted is not a message;
    // what it quoted keeps its place under this one's own quoter.
    return own.body.trim() || /<(?:table|img)\b/i.test(own.bodyHtml)
      ? [own, ...nested.history]
      : nested.history.map(m => ({ ...m, quotedBy: m.quotedBy === message.id ? message.quotedBy : m.quotedBy }));
  };

  let own = content(0, p.text.length);
  let recovered = depth < MAX_RESCAN_DEPTH ? history.flatMap(rescan) : history;
  if (depth < MAX_RESCAN_DEPTH && own.bodyHtml && UNSPLIT_HEADER.test(own.body)) {
    const holder = inert.createElement('div');
    holder.innerHTML = own.bodyHtml;
    const nested = extractEmailBody(holder, currentUserEmail, threadId, anchorTimestamp, carrierId, depth + 1);
    if (nested.history.length) {
      own = { body: nested.body, bodyHtml: nested.bodyHtml };
      recovered = [...recovered, ...nested.history];
    }
  }
  return { ...own, history: mergeMessages(recovered) };
}

export function parseQuotedChain(body: Element, user: string, thread: string, anchor: string, carrier?: string): ParsedMessage[] {
  return extractEmailBody(body, user, thread, anchor, carrier).history;
}
