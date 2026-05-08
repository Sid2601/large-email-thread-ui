import type { Sender } from '../types';

export function extractInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '??';
}

export function hashColor(email: string): string {
  const colors = ['#4F86C6','#E07B54','#5BAD8F','#9B6DC5','#D4A843','#C85C8E','#4EAAA1','#E05454'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) % colors.length;
  }
  return colors[Math.abs(hash)];
}

export function buildSender(name: string, email: string): Sender {
  const cleanName = name.trim() || email.split('@')[0];
  return {
    name: cleanName,
    email: email.toLowerCase().trim(),
    initials: extractInitials(cleanName),
    avatarColor: hashColor(email.toLowerCase()),
  };
}

/**
 * Strips all HTML tags and returns plain text.
 * Used for quoted/collapsed content where formatting doesn't matter.
 */
export function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').trim();
}

/**
 * Converts HTML to readable plain text while preserving the original
 * paragraph structure, line breaks, and list items.
 * Used for message bodies so the text looks as the sender wrote it.
 */
export function htmlToText(html: string): string {
  const processed = html
    // Block elements → double newline (paragraph break)
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/blockquote>/gi, '\n')
    // Line breaks → single newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Div closes → newline (Gmail wraps paragraphs in divs)
    .replace(/<\/div>/gi, '\n')
    // List items
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    // Only convert &nbsp; to regular space here — all other entities (&lt;, &gt;,
    // &amp;, etc.) must stay encoded so the subsequent innerHTML assignment does
    // not re-parse "<alice@example.com>" as an HTML tag.  textContent on the
    // final div decodes the remaining entities correctly.
    .replace(/&nbsp;/gi, ' ');

  const div = document.createElement('div');
  div.innerHTML = processed;
  const text = div.textContent ?? div.innerText ?? '';

  // Collapse 3+ consecutive newlines to 2 (max one blank line between paragraphs)
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function stripQuotedText(bodyEl: Element): { body: string; quotedText: string | undefined } {
  const clone = bodyEl.cloneNode(true) as Element;
  const quotedParts: string[] = [];

  // Gmail wraps quoted replies in blockquote.gmail_quote
  clone.querySelectorAll<Element>('blockquote.gmail_quote, .gmail_quote').forEach(q => {
    const text = stripHtml(q.innerHTML).trim();
    if (text) quotedParts.push(text);
    q.remove();
  });

  // Standard blockquotes (Outlook-style replies forwarded through Gmail)
  clone.querySelectorAll<Element>('blockquote').forEach(q => {
    const text = stripHtml(q.innerHTML).trim();
    if (text) quotedParts.push(text);
    q.remove();
  });

  // Gmail attribution line: "On Mon, Apr 6, 2026 at 2:57 PM Siddharth Shah wrote:"
  clone.querySelectorAll<Element>('.gmail_attr').forEach(el => el.remove());

  // "Hide quoted text" / "Show trimmed content" toggle button
  clone.querySelectorAll<Element>('u.q, [class*="elided"]').forEach(el => el.remove());

  // Hidden content blocks
  clone.querySelectorAll<HTMLElement>('[style*="display:none"], [style*="display: none"]').forEach(el => el.remove());

  // Use htmlToText (not stripHtml) so the body keeps its paragraph breaks and spacing
  const body = htmlToText(clone.innerHTML);
  const quotedText = quotedParts.join('\n---\n').trim() || undefined;
  return { body, quotedText };
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Stable message ID: keyed on sender email + timestamp only (no DOM index).
 * DOM index was previously included but changes if Gmail reorders elements
 * during progressive load, causing the same message to get different IDs
 * across scrapes and breaking the cache deduplication.
 */
export function generateId(senderEmail: string, timestamp: string): string {
  const raw = `${senderEmail}-${timestamp}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  return `msg-${Math.abs(hash).toString(36)}`;
}
