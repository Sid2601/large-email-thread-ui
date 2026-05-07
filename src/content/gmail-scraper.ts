import type { ThreadData, ParsedMessage, Participant, ExtensionMessage } from '../types';
import { buildSender, stripQuotedText, debounce, generateId } from './scraper-utils';

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
  const match = location.href.match(/#[^/]+\/([a-f0-9]+)$/i);
  return match?.[1] ?? `thread-${Date.now()}`;
}

function getSubject(): string {
  return document.querySelector('.hP, h2[data-legacy-thread-id]')
    ?.textContent?.trim() ?? 'Email Thread';
}

// Clicks Gmail's expand-all button so all message bodies are in the DOM.
// Uses only stable, non-action selectors (.gE / .go are Gmail's header row classes)
// to avoid accidentally triggering Reply / Forward / More-options buttons.
function tryExpandAll(): void {
  const expandBtn = document.querySelector<HTMLElement>(
    '[data-tooltip="Expand all"], [aria-label="Expand all"], button[title="Expand all"]'
  );
  if (expandBtn) {
    expandBtn.click();
    return;
  }

  // Click individual collapsed message header rows.
  // Only target .gE (sender row) or .go (collapsed header), never [role="button"]
  // which is too broad and would match Reply / Forward / More-options controls.
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
    // .a3s matches both expanded (.a3s.aiL) and collapsed (.a3s without .aiL),
    // so all messages in the thread are parsed, not just the latest open one.
    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]');
    if (!bodyEl) return;

    const { body, quotedText } = stripQuotedText(bodyEl);
    if (!body) return;

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

  // Sort oldest → newest — latest message always appears at the bottom of the chat
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

  // Reset expand flag when the user navigates to a different thread
  if (threadId !== lastThreadId) expandAttempted = false;

  // On first visit to a thread, trigger expand-all so collapsed messages
  // become available. The resulting DOM mutations re-fire this function via
  // the MutationObserver, at which point expandAttempted is true and we parse.
  if (!expandAttempted) {
    expandAttempted = true;
    tryExpandAll();
    return;
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

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrapeAndSend, 350);

const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

debouncedScrape();
