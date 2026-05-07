/**
 * Quoted-chain parser — reconstructs full thread history from the latest
 * expanded email body (.a3s.aiL) without needing to expand collapsed messages.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Flat querySelectorAll('.gmail_attr') — finds attribution elements at ANY
 *    nesting depth. The previous recursive :scope walk silently failed when Gmail
 *    wrapped .gmail_attr inside gmail_quote_container or extra divs.
 *
 * 2. STABLE IDs via threadId+depth — NOT a hash of email+timestamp.
 *    The previous generateId(email, timestamp) produced different IDs on every call
 *    when the timestamp fallback used Date.now() (which changes each millisecond).
 *    ThreadCache saw "new" messages on every scrape cycle → infinite loop sending
 *    to the Side Panel 48-96 times.
 *
 * 3. ANCHOR-BASED timestamps — NOT Date.now()-based.
 *    The latest email's real timestamp is passed in as `anchorTimestamp`.
 *    Quoted messages get estimated timestamps BEFORE the anchor (depth × 6h),
 *    so they sort correctly: oldest first, latest last.
 *    Previous Date.now()-based fallback produced timestamps in May 2026 while the
 *    actual email thread was in April 2026 → latest email sorted first (wrong order).
 */

import type { ParsedMessage } from '../types';
import { buildSender, htmlToText, generateId } from './scraper-utils';

// ── helpers ──────────────────────────────────────────────────────────────────

function isQuoteBlock(el: Element): boolean {
  return el.classList.contains('gmail_quote');
}

function isAttrBlock(el: Element): boolean {
  return el.classList.contains('gmail_attr');
}

/**
 * Extracts sender name + email from a .gmail_attr element.
 * Primary: <a href="mailto:..."> anchor — locale-independent.
 * Fallback: email pattern from raw text.
 */
function extractSender(attrEl: Element): { name: string; email: string } {
  const anchor = attrEl.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
  if (anchor) {
    const email = anchor.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    const anchorText = anchor.textContent?.trim() ?? '';
    const name = anchorText.includes('@')
      ? email.split('@')[0]
      : anchorText || email.split('@')[0];
    return { name, email };
  }

  const text = attrEl.textContent ?? '';
  const emailMatch = text.match(/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    const beforeEmail = text.slice(0, text.indexOf(emailMatch[0])).trim();
    const name = beforeEmail
      .replace(/^.*?\d{1,2}:\d{2}\s*(?:AM|PM)\s*/i, '')
      .replace(/[<,]/g, '')
      .trim() || email.split('@')[0];
    return { name, email };
  }

  return { name: 'Unknown', email: 'unknown@unknown' };
}

/**
 * Extracts a timestamp from a .gmail_attr element.
 *
 * Strategy 1: explicit day+month pattern in text → V8 parses Gmail's date format.
 * Strategy 2: <time datetime="..."> element.
 * Strategy 3: ANCHOR-BASED fallback — `anchorTimestamp - (depth+1) × 6 hours`.
 *   Keeps quoted messages sorted BEFORE the latest email in chronological order.
 *   NEVER uses Date.now() — that changes every millisecond and makes generateId
 *   produce different IDs on every scrape cycle, causing an infinite update loop.
 */
function extractTimestamp(attrEl: Element, depth: number, anchorTimestamp: string): string {
  const text = (attrEl.textContent ?? '').trim();

  const datePattern =
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
  const match = text.match(datePattern);
  if (match) {
    try {
      const parsed = new Date(match[0]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* fall through */ }
  }

  const timeEl = attrEl.querySelector<HTMLElement>('time[datetime]');
  if (timeEl) {
    try {
      const parsed = new Date(timeEl.getAttribute('datetime') ?? '');
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* fall through */ }
  }

  // Anchor-based fallback: estimate BEFORE the latest email's real timestamp.
  // depth=0 = most recently quoted (6h before anchor)
  // depth=1 = 12h before anchor, etc.
  const anchorMs = new Date(anchorTimestamp).getTime();
  const MS_PER_6H = 6 * 60 * 60 * 1000;
  return new Date(anchorMs - (depth + 1) * MS_PER_6H).toISOString();
}

function extractBodyHtml(quoteEl: Element): string {
  const clone = quoteEl.cloneNode(true) as Element;
  clone.querySelector('.gmail_attr')?.remove();
  const inner = clone.querySelector('blockquote.gmail_quote') ?? clone.querySelector('.gmail_quote');
  inner?.remove();
  return clone.innerHTML;
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Parses full thread history from the always-expanded latest email.
 *
 * @param latestBodyEl  - the .a3s.aiL element (latest expanded email body)
 * @param currentUserEmail - to set isCurrentUser correctly
 * @param threadId     - used as ID seed so IDs are stable across scrape calls
 * @param anchorTimestamp - real timestamp of the latest email (for relative ordering)
 *
 * Returns messages in chronological order (oldest → newest).
 */
export function parseQuotedChain(
  latestBodyEl: Element,
  currentUserEmail: string,
  threadId: string,
  anchorTimestamp: string,
): ParsedMessage[] {
  const attrs = Array.from(latestBodyEl.querySelectorAll<Element>('.gmail_attr'));
  if (attrs.length === 0) return [];

  const messages: ParsedMessage[] = [];

  attrs.forEach((attr, depth) => {
    let sibling: Element | null = attr.nextElementSibling;
    while (sibling && !isQuoteBlock(sibling) && !isAttrBlock(sibling)) {
      sibling = sibling.nextElementSibling;
    }

    if (!sibling || isAttrBlock(sibling)) {
      const prev = attr.previousElementSibling;
      if (prev && isQuoteBlock(prev)) sibling = prev;
      else return;
    }

    const { name, email } = extractSender(attr);
    // Stable ID: threadId + depth is unique within a thread and never changes
    // between scrape calls — prevents the infinite-loop cache-miss bug.
    const id = generateId(`${threadId}-d${depth}`, 'quoted');
    const timestamp = extractTimestamp(attr, depth, anchorTimestamp);
    const body = htmlToText(extractBodyHtml(sibling)).trim();

    if (!body) return;

    messages.push({
      id,
      sender: buildSender(name, email),
      timestamp,
      body,
      isCurrentUser: currentUserEmail
        ? email.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      index: 0, // re-assigned after reverse()
    });
  });

  // DOM order = [most-recently-quoted → oldest] → reverse to chronological
  messages.reverse();
  // Assign final indices after reversing (oldest gets most-negative index)
  messages.forEach((m, i) => { m.index = -(messages.length - i); });
  return messages;
}
