// Outlook Web scraper — stub required because manifest.json registers this content script.
// Full implementation ships in feature/outlook-scraper.
import type { ExtensionMessage, ThreadData, ParsedMessage, Participant } from '../types';
import { buildSender, stripHtml, debounce, generateId } from './scraper-utils';

let lastThreadId = '';

function scrape(): void {
  // Outlook reading pane carries data-convid on the focused conversation
  const pane = document.querySelector<HTMLElement>('[data-convid]');
  if (!pane) return;

  const threadId = pane.getAttribute('data-convid') ?? '';
  if (!threadId || threadId === lastThreadId) return;
  lastThreadId = threadId;

  // Minimal parse so the Side Panel shows something on Outlook too
  const itemEls = Array.from(pane.querySelectorAll<HTMLElement>('[role="option"]'));
  if (itemEls.length === 0) return;

  const messages: ParsedMessage[] = [];
  itemEls.forEach((el, index) => {
    const nameEl = el.querySelector<HTMLElement>('[title]');
    const senderName = nameEl?.getAttribute('title') ?? 'Unknown';
    const senderEmail = nameEl?.getAttribute('data-pe-id') ?? `outlook-${index}@unknown`;
    const timeEl = el.querySelector<HTMLElement>('time[datetime]');
    const timestamp = timeEl?.getAttribute('datetime') ?? new Date().toISOString();
    const bodyEl = el.querySelector<HTMLElement>('[data-block]');
    const body = bodyEl ? stripHtml(bodyEl.innerHTML) : '';
    if (!body) return;

    messages.push({
      id: generateId(senderEmail, timestamp, index),
      sender: buildSender(senderName, senderEmail),
      timestamp,
      body,
      isCurrentUser: false,
      index,
    });
  });

  if (messages.length === 0) return;

  const participantMap = new Map<string, Participant>();
  for (const msg of messages) {
    const key = msg.sender.email;
    if (!participantMap.has(key)) {
      participantMap.set(key, { sender: msg.sender, messageCount: 0, firstSeen: msg.timestamp });
    }
    participantMap.get(key)!.messageCount++;
  }

  const threadData: ThreadData = {
    threadId,
    subject: document.title.replace(' - Outlook', '').trim(),
    client: 'outlook',
    scrapedAt: new Date().toISOString(),
    messages,
    participants: Array.from(participantMap.values()),
  };

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrape, 400);
const observer = new MutationObserver(debouncedScrape);
observer.observe(document.body, { childList: true, subtree: true });
debouncedScrape();
