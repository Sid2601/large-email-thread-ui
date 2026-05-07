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

export function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').trim();
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

  // Standard blockquotes (e.g. Outlook-style replies forwarded through Gmail)
  clone.querySelectorAll<Element>('blockquote').forEach(q => {
    const text = stripHtml(q.innerHTML).trim();
    if (text) quotedParts.push(text);
    q.remove();
  });

  // Gmail attribution line: "On Mon, Apr 6, 2026 at 2:57 PM Siddharth Shah wrote:"
  // Removed via class selector — avoids the false-positive risk of a body-content regex.
  clone.querySelectorAll<Element>('.gmail_attr').forEach(el => el.remove());

  // Gmail's "Hide quoted text" / "Show trimmed content" toggle button
  clone.querySelectorAll<Element>('u.q, [class*="elided"]').forEach(el => el.remove());

  // Hidden content blocks (display:none divs Gmail inserts for trimmed content)
  clone.querySelectorAll<HTMLElement>('[style*="display:none"], [style*="display: none"]').forEach(el => el.remove());

  const body = stripHtml(clone.innerHTML);
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

export function generateId(senderEmail: string, timestamp: string, index: number): string {
  const raw = `${index}-${senderEmail}-${timestamp}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  return `msg-${Math.abs(hash).toString(36)}`;
}
