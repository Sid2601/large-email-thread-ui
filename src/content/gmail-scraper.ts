import type { ThreadData, ParsedMessage, Participant, ExtensionMessage } from '../types';
import { buildSender, stripQuotedText, debounce, generateId } from './scraper-utils';

// Set to true only during local development — never ship with DEBUG = true
// as log statements can expose partial URL fragments from location.hash.
const DEBUG = false;
const log = (...args: unknown[]) => { if (DEBUG) log('[ThreadLens]', ...args); };

let lastThreadId = '';
let lastMessageCount = 0;
let expandAttempted = false;

function getCurrentUserEmail(): string {
  const accountEl = document.querySelector<HTMLElement>('[data-email]');
  if (accountEl) return accountEl.getAttribute('data-email') ?? '';

  const profileLink = document.querySelector<HTMLAnchorElement>('a[href*="myaccount.google.com"]');
  if (profileLink) {
    const match = (profileLink.getAttribute('title') ?? '').match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (match) return match[0];
  }
  return '';
}

function getThreadId(): string {
  // Gmail URL hash formats:
  //   Inbox:  #inbox/18e1234567890abc
  //   Search: #search/gym/KtbxLvHcHtqRLdDVGPXKWRLTwVsXTzjxNq
  //   Label:  #label/Work/18e1234567890abc
  // The thread/message ID is always the LAST slash-separated segment.
  const parts = location.hash.split('/');
  const last = parts[parts.length - 1];
  // Alphanumeric-only and ≥9 chars distinguishes a real Gmail ID from
  // keywords ("inbox"), label names, and search queries (which contain
  // colons, dots, @-signs, spaces, etc.).
  return last && /^[A-Za-z0-9]{9,}$/.test(last) ? last : `thread-${Date.now()}`;
}

function getSubject(): string {
  return document.querySelector('.hP, h2[data-legacy-thread-id]')
    ?.textContent?.trim() ?? 'Email Thread';
}

// Triggers Gmail's expand-all so collapsed messages become available in the DOM.
// Only targets stable header-row classes (.gE / .go) — never [role="button"]
// which would risk clicking Reply / Forward / More-options controls.
function tryExpandAll(): void {
  const expandBtn = document.querySelector<HTMLElement>(
    '[data-tooltip="Expand all"], [aria-label="Expand all"], button[title="Expand all"]'
  );
  if (expandBtn) {
    expandBtn.click();
    return;
  }

  document.querySelectorAll<HTMLElement>('[data-message-id]').forEach(container => {
    if (!container.querySelector('.a3s')) {
      (container.querySelector<HTMLElement>('.gE') ??
       container.querySelector<HTMLElement>('.go'))
        ?.click();
    }
  });
}

function parseMessages(currentUserEmail: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  const seen = new Set<string>();
  const messageEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-id]')
  ).filter(el => {
    const id = el.getAttribute('data-message-id') ?? '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  log(`[ThreadLens] Found ${messageEls.length} message containers`);

  messageEls.forEach((el, index) => {
    // ── Sender ──────────────────────────────────────────────────────────────
    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const senderName = senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? 'Unknown';
    let senderEmail = senderEl?.getAttribute('email') ?? '';
    if (!senderEmail) {
      const mailto = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
      senderEmail = mailto?.href.replace('mailto:', '') ?? `sender-${index}@unknown`;
    }

    // ── Timestamp ────────────────────────────────────────────────────────────
    const timeEl = el.querySelector<HTMLElement>('.g3, [data-tooltip]');
    const rawTime = timeEl?.getAttribute('data-tooltip') ?? timeEl?.textContent?.trim() ?? '';
    let timestamp: string;
    try {
      const parsed = new Date(rawTime);
      timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }

    // ── Body ─────────────────────────────────────────────────────────────────
    // .a3s matches both expanded (.a3s.aiL) and collapsed messages.
    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]');
    if (!bodyEl) {
      log(`[ThreadLens] Message ${index}: no body element found — collapsed or stub`);
      return;
    }

    const { body, quotedText } = stripQuotedText(bodyEl);
    if (!body) {
      log(`[ThreadLens] Message ${index}: body empty after quote stripping`);
      return;
    }

    messages.push({
      id: generateId(senderEmail, timestamp, index),
      sender: buildSender(senderName, senderEmail),
      timestamp,
      body,
      quotedText,
      isCurrentUser: currentUserEmail
        ? senderEmail.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      index,
    });
  });

  log(`[ThreadLens] Parsed ${messages.length} messages successfully`);

  // Sort oldest → newest so the latest message is always at the bottom
  return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function buildParticipants(messages: ParsedMessage[]): Participant[] {
  const map = new Map<string, Participant>();
  for (const msg of messages) {
    const key = msg.sender.email;
    if (!map.has(key)) {
      map.set(key, { sender: msg.sender, messageCount: 0, firstSeen: msg.timestamp });
    }
    map.get(key)!.messageCount++;
  }
  return Array.from(map.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function scrapeAndSend(): void {
  const threadId = getThreadId();
  log(`[ThreadLens] scrapeAndSend — threadId: ${threadId}`);

  // Reset expand flag when the user navigates to a different thread
  if (threadId !== lastThreadId) expandAttempted = false;

  if (!expandAttempted) {
    expandAttempted = true;
    tryExpandAll();
    // Do NOT return — parse immediately with whatever is already in the DOM.
    // If tryExpandAll caused DOM changes, MutationObserver fires again and we
    // re-parse with the now-expanded messages. The setTimeout below is a
    // safety net for cases where expansion doesn't trigger MutationObserver.
    setTimeout(debouncedScrape, 800);
  }

  const currentUserEmail = getCurrentUserEmail();
  const messages = parseMessages(currentUserEmail);
  if (messages.length === 0) return;
  if (threadId === lastThreadId && messages.length === lastMessageCount) return;

  lastThreadId = threadId;
  lastMessageCount = messages.length;

  const threadData: ThreadData = {
    threadId,
    subject: getSubject(),
    client: 'gmail',
    scrapedAt: new Date().toISOString(),
    messages,
    participants: buildParticipants(messages),
  };

  log(`[ThreadLens] Sending ${messages.length} messages to Side Panel`);

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrapeAndSend, 350);

const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

log('[ThreadLens] Content script loaded — watching for email threads');
debouncedScrape();
