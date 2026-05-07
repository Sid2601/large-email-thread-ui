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

  // 1. Collect quoted content before removing it
  const quotedParts: string[] = [];

  // Gmail wraps quoted replies in blockquote.gmail_quote or .gmail_quote
  clone.querySelectorAll<Element>('blockquote.gmail_quote, .gmail_quote').forEach(q => {
    const text = stripHtml(q.innerHTML).trim();
    if (text) quotedParts.push(text);
    q.remove();
  });

  // Standard HTML blockquotes (Outlook-style replies pasted into Gmail)
  clone.querySelectorAll<Element>('blockquote').forEach(q => {
    const text = stripHtml(q.innerHTML).trim();
    if (text) quotedParts.push(text);
    q.remove();
  });

  // 2. Remove Gmail-specific chrome injected into .a3s
  // Attribution line: "On Mon, Apr 6, 2026 at 2:57 PM Siddharth Shah wrote:"
  clone.querySelectorAll<Element>('.gmail_attr').forEach(el => el.remove());

  // "Hide quoted text" / "Show trimmed content" toggle button Gmail injects
  clone.querySelectorAll<Element>('u.q, [class*="elided"], [class*="toggle"]').forEach(el => el.remove());

  // Hidden content blocks Gmail uses for trimmed content (display:none divs)
  clone.querySelectorAll<HTMLElement>('[style*="display:none"], [style*="display: none"]').forEach(el => el.remove());

  // 3. Clean up the remaining body text
  let body = stripHtml(clone.innerHTML);

  // Remove leading/trailing "On ... wrote:" lines that weren't in a .gmail_attr element
  body = body.replace(/^On .+? wrote:\s*/s, '').trim();

  // Remove email signature separator lines
  body = body.replace(/\n--\s*\n[\s\S]*$/, '').trim();

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
