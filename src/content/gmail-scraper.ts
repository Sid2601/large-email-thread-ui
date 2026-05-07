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

// Clicks Gmail's "Expand all" button so every message body is in the DOM.
function tryExpandAll(): void {
  // Gmail's expand-all button has various attribute forms depending on version
  const expandBtn = document.querySelector<HTMLElement>(
    '[data-tooltip="Expand all"], [aria-label="Expand all"], [data-action-type="expand_all"], ' +
    'button[title="Expand all"]'
  );
  if (expandBtn) {
    expandBtn.click();
    return;
  }

  // Fallback: click individual collapsed message headers.
  // Collapsed messages lack a visible .a3s body — their container has [data-message-id]
  // but the inner content wrapper (.adn) does NOT have the .ads class (ads = expanded).
  document.querySelectorAll<HTMLElement>('[data-message-id]').forEach(container => {
    const isExpanded = !!container.querySelector('.a3s');
    if (!isExpanded) {
      // The clickable header row is .gE (sender bar) or first [role="button"] descendant
      const header = container.querySelector<HTMLElement>('.gE, .go, [role="button"]');
      header?.click();
    }
  });
}

function parseMessages(currentUserEmail: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  // Deduplicate by data-message-id
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
    // .gD is Gmail's sender span — carries name= and email= attributes
    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const senderName = senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? 'Unknown';
    let senderEmail = senderEl?.getAttribute('email') ?? '';

    if (!senderEmail) {
      const mailto = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
      senderEmail = mailto?.href.replace('mailto:', '') ?? `sender-${index}@unknown`;
    }

    // ── Timestamp ────────────────────────────────────────────────────────────
    // .g3 holds the relative time; its data-tooltip contains the full datetime string
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
    // .a3s exists in both expanded (.a3s.aiL) and collapsed (.a3s without .aiL) messages.
    // Removing the .aiL requirement gives us all messages, not just the latest.
    // Broader fallbacks cover Gmail DOM variations across versions.
    const bodyEl = el.querySelector(
      '.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]'
    );
    if (!bodyEl) return; // message is a stub with no body at all — skip

    const { body, quotedText } = stripQuotedText(bodyEl);
    if (!body) return; // body was entirely quoted text — skip

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

  // Sort oldest → newest so the chat reads top-to-bottom chronologically
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
  const currentUserEmail = getCurrentUserEmail();

  // On first detection of a new thread, trigger expand-all so collapsed
  // messages become available for parsing. The resulting DOM mutations will
  // re-fire this function via the MutationObserver, picking up all messages.
  if (threadId !== lastThreadId) {
    expandAttempted = false;
  }
  if (!expandAttempted) {
    expandAttempted = true;
    tryExpandAll();
    // Let the DOM settle — MutationObserver fires again after expansion
    return;
  }

  const messages = parseMessages(currentUserEmail);
  if (messages.length === 0) return;

  // Short-circuit if nothing changed
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

// Observe only the main content area — avoids firing on Gmail sidebar mutations
const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

debouncedScrape();
