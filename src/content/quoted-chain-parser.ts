/**
 * Quoted-chain parser — reconstructs full thread history from the latest
 * expanded email body (.a3s.aiL) without needing to expand collapsed messages.
 *
 * APPROACH: flat querySelectorAll, not recursive :scope walk.
 *
 * Gmail nests every quoted reply inside a blockquote.gmail_quote and marks each
 * attribution with a .gmail_attr div. Gmail can wrap these inside any number of
 * intermediate divs (gmail_quote_container, inline styles, etc.) — so :scope >
 * direct-child selectors break silently. querySelectorAll('.gmail_attr') finds
 * ALL attribution elements regardless of nesting depth.
 *
 * DOM structure inside .a3s.aiL (simplified):
 *
 *   [Ronak's new email text]
 *   .gmail_attr  →  "On Apr 29, Siddharth wrote:"
 *   blockquote.gmail_quote
 *     [Siddharth's text]
 *     .gmail_attr  →  "On Apr 6, Anand wrote:"
 *     blockquote.gmail_quote
 *       [Anand's text]
 *       .gmail_attr  →  "On Apr 6, Siddharth wrote:"
 *       blockquote.gmail_quote
 *         [Siddharth's original text]
 *
 * querySelectorAll('.gmail_attr') returns [attr0, attr1, attr2] in DOM order.
 * attr0.nextElementSibling → blockquote with Siddharth's text (most recently quoted)
 * attr1.nextElementSibling → blockquote with Anand's text
 * attr2.nextElementSibling → blockquote with original Siddharth text
 * After reverse() → [original, Anand, Siddharth] = chronological order.
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
 * Primary: <a href="mailto:..."> anchor inside the attr div — locale-independent.
 * Fallback: email address pattern from the raw text content.
 */
function extractSender(attrEl: Element): { name: string; email: string } {
  // Primary: Gmail always puts sender's email in a mailto: anchor
  const anchor = attrEl.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
  if (anchor) {
    const email = anchor.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    const anchorText = anchor.textContent?.trim() ?? '';
    // Anchor text is usually the display name; if it looks like an email address,
    // look for a display name in the surrounding text instead.
    const name = anchorText.includes('@')
      ? email.split('@')[0]
      : anchorText || email.split('@')[0];
    return { name, email };
  }

  // Fallback: extract email from raw text (e.g. "Siddharth Shah <s@x.com> wrote:")
  const text = attrEl.textContent ?? '';
  const emailMatch = text.match(/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    // Try to find a display name before the email address
    const beforeEmail = text.slice(0, text.indexOf(emailMatch[0])).trim();
    // Strip common prefixes like "On Mon, Apr 6, 2026 at 2:57 PM " before the name
    const name = beforeEmail
      .replace(/^.*?\d{1,2}:\d{2}\s*(?:AM|PM)\s*/i, '')
      .replace(/[<,]/g, '')
      .trim() || email.split('@')[0];
    return { name, email };
  }

  return { name: 'Unknown', email: `unknown-${Date.now()}@unknown` };
}

/**
 * Extracts a timestamp from a .gmail_attr element.
 *
 * Strategy 1: find a date pattern in the text — V8 parses Gmail's format natively.
 * Strategy 2: use a time[datetime] element if present.
 * Strategy 3: depth-based fallback so quoted messages sort BEFORE the latest email.
 *   (Using new Date() as fallback would put them AFTER the latest, which is wrong.)
 */
function extractTimestamp(attrEl: Element, depth: number): string {
  const text = (attrEl.textContent ?? '').trim();

  // Match date patterns: "Mon, Apr 6, 2026" or "Apr 6, 2026" with optional time
  // Using explicit day/month alternatives to avoid false-positive on body text.
  const datePattern =
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
  const match = text.match(datePattern);
  if (match) {
    try {
      const parsed = new Date(match[0]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* fall through */ }
  }

  // Strategy 2: <time datetime="...">
  const timeEl = attrEl.querySelector<HTMLElement>('time[datetime]');
  if (timeEl) {
    try {
      const parsed = new Date(timeEl.getAttribute('datetime') ?? '');
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* fall through */ }
  }

  // Strategy 3: depth-based fallback — offset from "now" so these messages
  // sort before the latest email in the ThreadCache sort (oldest → newest).
  // depth=0 = most recently quoted → small offset; deeper = larger offset.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return new Date(Date.now() - (depth + 1) * MS_PER_DAY).toISOString();
}

/**
 * Extracts the body HTML of a quoted blockquote, stripping only its own
 * FIRST nested attribution and blockquote so we don't include the chain
 * of older messages inside this message's bubble.
 */
function extractBodyHtml(quoteEl: Element): string {
  const clone = quoteEl.cloneNode(true) as Element;

  // Remove the first .gmail_attr (attribution for the next-older email)
  clone.querySelector('.gmail_attr')?.remove();

  // Remove the first nested blockquote.gmail_quote (content of next-older email)
  const inner = clone.querySelector('blockquote.gmail_quote')
    ?? clone.querySelector('.gmail_quote');
  inner?.remove();

  return clone.innerHTML;
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Parses the full thread history from the single always-expanded latest email.
 *
 * Returns messages in chronological order (oldest first) ready to be merged
 * into ThreadCache alongside Strategy A (DOM-scraped) messages.
 */
export function parseQuotedChain(
  latestBodyEl: Element,
  currentUserEmail: string,
): ParsedMessage[] {
  // Find ALL .gmail_attr elements regardless of nesting depth.
  // DOM order = [most-recently-quoted, ..., original-email-attr]
  const attrs = Array.from(latestBodyEl.querySelectorAll<Element>('.gmail_attr'));

  if (attrs.length === 0) return [];

  const messages: ParsedMessage[] = [];

  attrs.forEach((attr, depth) => {
    // Walk forward through siblings to find the paired blockquote.gmail_quote.
    // Skip over <br>, whitespace nodes, or stray inline elements.
    // Stop immediately if we hit another .gmail_attr (means we missed the quote).
    let sibling: Element | null = attr.nextElementSibling;
    while (sibling && !isQuoteBlock(sibling) && !isAttrBlock(sibling)) {
      sibling = sibling.nextElementSibling;
    }

    // Standard Gmail always places the blockquote AFTER the .gmail_attr.
    // Forwarded messages sometimes place it BEFORE — check one sibling back
    // as a fallback before giving up.
    if (!sibling || isAttrBlock(sibling)) {
      const prevSibling = attr.previousElementSibling;
      if (prevSibling && isQuoteBlock(prevSibling)) {
        sibling = prevSibling;
      } else {
        return; // no paired blockquote found in either direction
      }
    }

    const { name, email } = extractSender(attr);
    const timestamp = extractTimestamp(attr, depth);
    const bodyHtml = extractBodyHtml(sibling);
    const body = htmlToText(bodyHtml).trim();

    if (!body) return;

    messages.push({
      // Depth tiebreaker prevents same-sender same-timestamp collision
      // when timestamp parsing falls back to the depth-based estimate.
      id: generateId(`${email}-d${depth}`, timestamp),
      sender: buildSender(name, email),
      timestamp,
      body,
      isCurrentUser: currentUserEmail
        ? email.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      // Negative index so these sort before the latest message in the cache
      index: -(attrs.length - depth),
    });
  });

  // DOM order is [most-recently-quoted → oldest]; reverse for chat display
  messages.reverse();
  // Re-assign index values now that order is chronological (oldest=0 … newest=n-1)
  messages.forEach((m, i) => { m.index = -(messages.length - i); });
  return messages;
}
