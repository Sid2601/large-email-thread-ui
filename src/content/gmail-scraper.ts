import type { ParsedMessage, ExtensionMessage } from '../types';
import { buildSender, stripQuotedText, debounce, generateId } from './scraper-utils';
import { threadCache } from './thread-cache';
import { parseQuotedChain } from './quoted-chain-parser';

// Set to true only during local development — never commit as true.
const DEBUG = false;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[ThreadLens]', ...args); };

// Retry schedule (ms) when initial parse returns 0 messages.
// Starts at 1200ms to avoid colliding with tryExpandAll's own 800ms timeout.
const RETRY_DELAYS = [1200, 2000, 3500];
let retryIndex = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

let activeThreadId = '';
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
  // The thread/message ID is always the last slash-separated segment.
  // Guard: alphanumeric only + ≥9 chars — rejects keywords, labels, and search queries.
  const parts = location.hash.split('/');
  const last = parts[parts.length - 1];
  return last && /^[A-Za-z0-9]{9,}$/.test(last) ? last : '';
}

function getSubject(): string {
  return document.querySelector('.hP, h2[data-legacy-thread-id]')
    ?.textContent?.trim() ?? 'Email Thread';
}

function tryExpandAll(): void {
  const expandBtn = document.querySelector<HTMLElement>(
    '[data-tooltip="Expand all"], [aria-label="Expand all"], button[title="Expand all"]'
  );
  if (expandBtn) {
    expandBtn.click();
    return;
  }
  // Click individual collapsed message headers using stable Gmail header-row classes
  document.querySelectorAll<HTMLElement>('[data-message-id]').forEach(container => {
    if (!container.querySelector('.a3s')) {
      (container.querySelector<HTMLElement>('.gE') ??
       container.querySelector<HTMLElement>('.go'))?.click();
    }
  });
}

function parseMessages(currentUserEmail: string): ParsedMessage[] {
  const seen = new Set<string>();
  const messages: ParsedMessage[] = [];

  const messageEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-id]')
  ).filter(el => {
    const id = el.getAttribute('data-message-id') ?? '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  log(`Found ${messageEls.length} message containers`);

  messageEls.forEach((el, index) => {
    // Use Gmail's own data-message-id directly as the stable ParsedMessage ID.
    // This is assigned by Gmail's server and is globally unique — eliminates the
    // same-sender/same-second collision risk that a derived hash cannot avoid.
    const domMessageId = el.getAttribute('data-message-id') ?? generateId(`fallback-${index}`, new Date().toISOString());

    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const senderName = senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? 'Unknown';
    let senderEmail = senderEl?.getAttribute('email') ?? '';
    if (!senderEmail) {
      const mailto = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
      senderEmail = mailto?.href.replace('mailto:', '') ?? `sender-${index}@unknown`;
    }

    const timeEl = el.querySelector<HTMLElement>('.g3, [data-tooltip]');
    const rawTime = timeEl?.getAttribute('data-tooltip') ?? timeEl?.textContent?.trim() ?? '';
    let timestamp: string;
    try {
      const parsed = new Date(rawTime);
      timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }

    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]');
    if (!bodyEl) return;

    const { body, quotedText } = stripQuotedText(bodyEl);
    if (!body) return;

    messages.push({
      id: domMessageId,
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

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryIndex >= RETRY_DELAYS.length) return;
  const delay = RETRY_DELAYS[retryIndex++];
  log(`Scheduling retry in ${delay}ms (attempt ${retryIndex})`);
  // Null retryTimer before calling scrapeAndSend so any future
  // `if (retryTimer !== null)` guard sees a clean state.
  retryTimer = setTimeout(() => { retryTimer = null; scrapeAndSend(); }, delay);
}

function onThreadChanged(newThreadId: string): void {
  // Evict the previous thread from cache only if navigating to a different thread
  if (activeThreadId && activeThreadId !== newThreadId) {
    threadCache.evict(activeThreadId);
  }
  activeThreadId = newThreadId;
  expandAttempted = false;
  retryIndex = 0;
  clearRetryTimer();
}

function scrapeAndSend(): void {
  const threadId = getThreadId();

  if (!threadId) {
    log('No thread ID in URL — not in a thread view');
    return;
  }

  // Detect thread navigation and reset state
  if (threadId !== activeThreadId) {
    onThreadChanged(threadId);
  }

  if (!expandAttempted) {
    expandAttempted = true;
    tryExpandAll();
    // Safety net: re-scrape after expand settles (separate from retry backoff)
    setTimeout(debouncedScrape, 800);
  }

  const currentUserEmail = getCurrentUserEmail();

  // Strategy A: parse [data-message-id] elements (all expanded messages)
  const domMessages = parseMessages(currentUserEmail);
  log(`Strategy A (DOM): ${domMessages.length} messages`);

  // Strategy B: parse quoted chain from the latest email only.
  // Only runs when Strategy A returned ≤1 message (i.e. expand-all hasn't settled
  // yet or all older messages are collapsed). Strategy A uses Gmail's server-assigned
  // data-message-id while Strategy B uses a hash — they never produce the same ID,
  // so merging both on a fully-expanded thread would duplicate every message in the UI.
  const latestBodyEl = domMessages.length <= 1
    ? document.querySelector('.a3s.aiL')
    : null;
  const chainMessages = latestBodyEl
    ? parseQuotedChain(latestBodyEl, currentUserEmail)
    : [];
  log(`Strategy B (quoted chain): ${chainMessages.length} messages (domMessages=${domMessages.length})`);

  // When Strategy A has all messages, chainMessages is empty and we send domMessages.
  // When Strategy A has ≤1, chainMessages fills in the thread history immediately.
  const incoming: ParsedMessage[] = [...chainMessages, ...domMessages];

  if (incoming.length === 0) {
    scheduleRetry();
    return;
  }

  // Retry is no longer needed — messages found
  clearRetryTimer();
  retryIndex = 0;

  // Update the cache — returns true only if new messages were found
  const changed = threadCache.update(threadId, incoming);
  if (!changed) {
    log('No new messages — skipping send');
    return;
  }

  const threadData = threadCache.getThreadData(threadId, getSubject(), 'gmail');
  if (!threadData) return;

  log(`Sending ${threadData.messages.length} messages to Side Panel`);

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrapeAndSend, 350);

// hashchange fires on every Gmail SPA navigation (inbox → thread → inbox etc.)
// More reliable than MutationObserver for detecting thread switches.
window.addEventListener('hashchange', () => {
  const newId = getThreadId();
  // Only reset if we actually moved to a different thread (not a label-vs-search hash prefix change)
  if (newId && newId !== activeThreadId) {
    log(`hashchange → new thread: ${newId}`);
    onThreadChanged(newId);
    debouncedScrape();
  }
});

// MutationObserver catches content changes within the current thread
const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

log('Content script loaded');
debouncedScrape();
