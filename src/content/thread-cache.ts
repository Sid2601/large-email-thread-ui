import { mergeMessages, participationBoundary } from './message-reconciliation';
import type { ParsedMessage, Participant, ThreadData } from '../types';

interface CacheEntry {
  // Direct provider IDs and stable recovered-message IDs.
  messages: Map<string, ParsedMessage>;
  // Chronological reconciled messages.
  sortedMessages: ParsedMessage[];
  // Rebuilt after reconciliation to avoid counting quoted duplicates.
  participantMap: Map<string, Participant>;
}

class ThreadCache {
  private readonly store = new Map<string, CacheEntry>();

  private getOrCreate(threadId: string): CacheEntry {
    if (!this.store.has(threadId)) {
      this.store.set(threadId, {
        messages: new Map(),
        sortedMessages: [],
        participantMap: new Map(),
      });
    }
    return this.store.get(threadId)!;
  }

  /**
   * Merge incoming messages into the cache.
   * Returns true when bodies, attachments or message identities change.
   * Recovered duplicates yield to direct messages; quoted-only history survives.
   */
  update(threadId: string, incoming: ParsedMessage[]): boolean {
    const entry = this.getOrCreate(threadId);
    let changed = false;

    const merged = mergeMessages([...incoming, ...Array.from(entry.messages.values()).filter(old => !incoming.some(m => m.id === old.id))]);
    changed = JSON.stringify(merged) !== JSON.stringify(entry.sortedMessages);
    if (changed) {
      entry.messages = new Map(merged.map(m => [m.id, m]));
      entry.sortedMessages = merged;
      entry.participantMap.clear();
      for (const msg of merged) {
        const key = msg.sender.email;
        const participant = entry.participantMap.get(key);
        if (participant) participant.messageCount++;
        else entry.participantMap.set(key, { sender: msg.sender, messageCount: 1, firstSeen: msg.timestamp });
      }
    }

    return changed;
  }

  getThreadData(
    threadId: string,
    subject: string,
    client: 'gmail' | 'outlook',
    currentUserEmail = '',
  ): ThreadData | null {
    const entry = this.store.get(threadId);
    if (!entry || entry.sortedMessages.length === 0) return null;

    return {
      threadId,
      subject,
      client,
      currentUserEmail,
      participation: participationBoundary(entry.sortedMessages, currentUserEmail),
      scrapedAt: new Date().toISOString(),
      messages: entry.sortedMessages, // already sorted — no extra work
      participants: Array.from(entry.participantMap.values()).sort(
        (a, b) => b.messageCount - a.messageCount,
      ),
    };
  }

  messageCount(threadId: string): number {
    return this.store.get(threadId)?.messages.size ?? 0;
  }

  /** Drop the cache when the user navigates away from a thread entirely. */
  evict(threadId: string): void {
    this.store.delete(threadId);
  }
}

// Singleton — one cache instance shared across all scraper calls in this content script
export const threadCache = new ThreadCache();
