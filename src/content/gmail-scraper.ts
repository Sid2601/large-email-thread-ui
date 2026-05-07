import type { ThreadData, ParsedMessage, Participant, ExtensionMessage } from '../types';
import { buildSender, stripQuotedText, debounce, generateId } from './scraper-utils';

let lastThreadId = '';
let lastMessageCount = 0;

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

function parseMessages(currentUserEmail: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  const messageEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-id]')
  );

  // Deduplicate by data-message-id
  const seen = new Set<string>();
  const dedupedEls = messageEls.filter(el => {
    const id = el.getAttribute('data-message-id') ?? '';
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  dedupedEls.forEach((el, index) => {
    // Sender name and email — Gmail puts these on the .gD span
    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const senderName = senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? 'Unknown';
    let senderEmail = senderEl?.getAttribute('email') ?? '';

    if (!senderEmail) {
      const mailtoEl = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
      senderEmail = mailtoEl?.href.replace('mailto:', '') ?? `sender-${index}@unknown`;
    }

    // Timestamp — Gmail's .g3 span has a data-tooltip with full datetime
    const timeEl = el.querySelector<HTMLElement>('.g3, [data-tooltip]');
    const rawTime = timeEl?.getAttribute('data-tooltip') ?? timeEl?.textContent?.trim() ?? '';
    let timestamp: string;
    try {
      const parsed = new Date(rawTime);
      timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }

    // .a3s.aiL and .a3s are obfuscated Gmail classes — they can change on redeploy.
    // Broader fallback selectors below reduce breakage risk.
    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt div, [data-message-text]');
    if (!bodyEl) return; // collapsed message — skip

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

  return messages;
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

// Observe the main content area, not the whole body, to avoid firing on
// every sidebar mutation (chat widget, autocomplete, ads, etc.).
const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

debouncedScrape();
