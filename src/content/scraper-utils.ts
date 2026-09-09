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
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
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

export function mimeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}

const ALLOWED_TAGS = new Set(['p','div','br','b','i','strong','em','u','s','a','ul','ol','li',
  'table','tr','td','th','thead','tbody','tfoot','pre','code','blockquote','span',
  'h1','h2','h3','h4','h5','h6','hr']);

const STYLE_PROPERTIES = new Set(['color', 'background-color', 'font-weight', 'font-style',
  'text-decoration', 'text-align', 'vertical-align', 'white-space', 'border', 'border-color',
  'border-width', 'border-style', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom']);

export function safeLink(raw: string): string {
  try {
    const url = new URL(raw);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function sanitizeEmailHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta,svg,math').forEach(el => el.remove());
  for (const el of Array.from(tmp.querySelectorAll('*')).reverse()) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      el.replaceWith(document.createTextNode(el.getAttribute('alt') ? `[Image: ${el.getAttribute('alt')}]` : '[Image]'));
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    const href = tag === 'a' ? safeLink(el.getAttribute('href') ?? '') : '';
    const styles: string[] = [];
    const style = (el as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const value = style.getPropertyValue(prop);
      if (STYLE_PROPERTIES.has(prop) && !/url|expression|var\(|@|[<>\\]/i.test(value)) styles.push(`${prop}:${value}`);
    }
    const spans = ['td', 'th'].includes(tag) ? ['colspan', 'rowspan'].map(attr => [attr, el.getAttribute(attr)]) : [];
    const start = tag === 'ol' ? el.getAttribute('start') : null;
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    if (styles.length) el.setAttribute('style', styles.join(';'));
    for (const [attr, value] of spans) if (value && /^\d{1,3}$/.test(value)) el.setAttribute(attr!, value);
    if (start && /^-?\d{1,5}$/.test(start)) el.setAttribute('start', start);
    if (href) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  }
  return tmp.innerHTML;
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
