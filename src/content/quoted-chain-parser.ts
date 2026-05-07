/**
 * Quoted-chain parser — reconstructs full thread history from the latest
 * expanded email only.
 *
 * Gmail nests every quoted reply inside a `blockquote.gmail_quote` and marks
 * each attribution line with a `.gmail_attr` div containing an
 * `<a href="mailto:...">` anchor. Both are stable internal CSS classes that
 * do NOT change with Gmail locale — making this approach locale-independent
 * and not reliant on "On ... wrote:" text patterns.
 *
 * Structure inside .a3s.aiL:
 *   [latest body]
 *   <div class="gmail_attr">        ← identifies who wrote the next block
 *     On ..., <a href="mailto:s@x.com">Sender Name</a> wrote:
 *   </div>
 *   <blockquote class="gmail_quote">
 *     [previous email body]
 *     <div class="gmail_attr">...</div>   ← next-older attribution
 *     <blockquote class="gmail_quote">    ← next-older body
 *       ...
 *     </blockquote>
 *   </blockquote>
 */

import type { ParsedMessage } from '../types';
import { buildSender, htmlToText, generateId } from './scraper-utils';

interface RawQuotedMessage {
  name: string;
  email: string;
  timestamp: string;
  bodyHtml: string;
  depth: number;
}

/**
 * Extracts sender name + email from a .gmail_attr element.
 * Uses the mailto: anchor — locale-independent (no text regex needed).
 */
function extractSenderFromAttr(attrEl: Element): { name: string; email: string } {
  const anchor = attrEl.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
  if (anchor) {
    const email = anchor.href.replace('mailto:', '').trim();
    const name = anchor.textContent?.trim() ?? email.split('@')[0];
    return { name, email };
  }

  // Fallback: no anchor present — try to extract email from raw text
  // e.g. "On Mon, Apr 6, 2026, Siddharth Shah <s@x.com> wrote:"
  const text = attrEl.textContent ?? '';
  const emailMatch = text.match(/<?([\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,})>?/);
  if (emailMatch) {
    const email = emailMatch[1];
    const namePart = text.split(emailMatch[0])[0].trim();
    // Remove leading "On ... at ... " prefix from name part
    const name = namePart.replace(/^On\s+.+?(at|,)\s+\d+:\d+\s*(?:AM|PM)\s+/i, '').trim()
      || email.split('@')[0];
    return { name, email };
  }

  return { name: 'Unknown', email: `unknown-${Date.now()}@unknown` };
}

/**
 * Extracts a timestamp from a .gmail_attr element.
 * V8 (Chrome's engine) natively parses Gmail's "Mon, Apr 6, 2026 at 2:57 PM" format.
 */
function extractTimestampFromAttr(attrEl: Element): string {
  const text = attrEl.textContent ?? '';

  // Capture everything between "On " and " wrote:" (or end of string)
  const datePart = text.match(/On\s+(.+?)\s+wrote:/i)?.[1]
    // Strip the sender portion — keep only the date+time segment
    // Format: "Mon, Apr 6, 2026 at 2:57 PM Siddharth Shah"
    // We want: "Mon, Apr 6, 2026 at 2:57 PM"
    ?.replace(/\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*(?:<[^>]+>)?\s*$/, '')
    .trim();

  if (datePart) {
    try {
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* fall through */ }
  }

  return new Date().toISOString();
}

/**
 * Recursively walks the nested blockquote.gmail_quote tree.
 * Returns messages from outermost (most recent quoted) to innermost (oldest).
 */
function walkQuotes(container: Element, depth: number, results: RawQuotedMessage[]): void {
  // Find the DIRECT child attribution + quote pair within this container.
  // Using :scope so we don't accidentally pick up deeper nested pairs.
  const directAttr = container.querySelector<Element>(':scope > .gmail_attr');
  const directQuote = container.querySelector<Element>(':scope > blockquote.gmail_quote');

  if (!directAttr || !directQuote) {
    // Some email clients wrap blockquote inside a div — try one level deeper
    const wrapper = container.querySelector<Element>(':scope > div > .gmail_attr');
    const wrapperQuote = container.querySelector<Element>(':scope > div > blockquote.gmail_quote');
    if (!wrapper || !wrapperQuote) return;

    const { name, email } = extractSenderFromAttr(wrapper);
    const timestamp = extractTimestampFromAttr(wrapper);

    // Body = blockquote content minus its OWN nested quote and attribution
    const bodyClone = wrapperQuote.cloneNode(true) as Element;
    bodyClone.querySelector('.gmail_attr')?.remove();
    bodyClone.querySelector('blockquote.gmail_quote')?.remove();

    results.push({ name, email, timestamp, bodyHtml: bodyClone.innerHTML, depth });
    walkQuotes(wrapperQuote, depth + 1, results);
    return;
  }

  const { name, email } = extractSenderFromAttr(directAttr);
  const timestamp = extractTimestampFromAttr(directAttr);

  // Body of this quoted message = blockquote content minus its own nested attribution+quote
  const bodyClone = directQuote.cloneNode(true) as Element;
  bodyClone.querySelector(':scope > .gmail_attr')?.remove();
  bodyClone.querySelector(':scope > blockquote.gmail_quote')?.remove();
  bodyClone.querySelector(':scope > div > .gmail_attr')?.remove();
  bodyClone.querySelector(':scope > div > blockquote.gmail_quote')?.remove();

  results.push({ name, email, timestamp, bodyHtml: bodyClone.innerHTML, depth });

  // Recurse into the nested quote for older messages
  walkQuotes(directQuote, depth + 1, results);
}

/**
 * Parses the full thread history from the single latest expanded email body.
 *
 * Returns messages in chronological order (oldest first, newest last).
 * The LATEST email itself is NOT included here — it is parsed by the main
 * gmail-scraper using [data-message-id] DOM attributes for accurate sender info.
 * These results are merged via ThreadCache which deduplicates by message ID.
 */
export function parseQuotedChain(
  latestBodyEl: Element,
  currentUserEmail: string,
): ParsedMessage[] {
  const raw: RawQuotedMessage[] = [];
  walkQuotes(latestBodyEl, 0, raw);

  if (raw.length === 0) return [];

  // raw[0] = most recently quoted (second-newest), raw[last] = original email
  // Reverse so we return oldest → newest (matches ThreadCache sort expectation)
  const result: ParsedMessage[] = [];
  raw.reverse().forEach((msg, index) => {
    const body = htmlToText(msg.bodyHtml);
    if (!body) return;

    result.push({
      id: generateId(msg.email, msg.timestamp),
      sender: buildSender(msg.name, msg.email),
      timestamp: msg.timestamp,
      body,
      isCurrentUser: currentUserEmail
        ? msg.email.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      index: -(raw.length - index), // negative so they sort before the latest message
    });
  });
  return result;
}
