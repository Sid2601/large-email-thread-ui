import type { ParsedMessage, Participant, ThreadData } from '../types';

interface CacheEntry {
  // Map key = stable message ID (email + timestamp hash — no DOM index)
  messages: Map<string, ParsedMessage>;
  // Pre-sorted array, rebuilt only when a new message is inserted
  sortedMessages: ParsedMessage[];
  // Participant counts maintained incrementally — no full recount on update
  participantMap: Map<string, Participant>;
  isDirty: boolean;
}

class ThreadCache {
  private readonly store = new Map<string, CacheEntry>();

  private getOrCreate(threadId: string): CacheEntry {
    if (!this.store.has(threadId)) {
      this.store.set(threadId, {
        messages: new Map(),
        sortedMessages: [],
        participantMap: new Map(),
        isDirty: false,
      });
    }
    return this.store.get(threadId)!;
  }

  /**
   * Merge incoming messages into the cache.
   * Returns true if at least one new message was added (caller should re-send).
   * O(n) over incoming messages, O(1) per dedup check via Map.
   */
  update(threadId: string, incoming: ParsedMessage[]): boolean {
    const entry = this.getOrCreate(threadId);
    let changed = false;

    for (const msg of incoming) {
      if (entry.messages.has(msg.id)) continue;

      entry.messages.set(msg.id, msg);
      changed = true;
      entry.isDirty = true;

      // Increment participant count without rebuilding the whole participant list
      const { email } = msg.sender;
      if (!entry.participantMap.has(email)) {
        entry.participantMap.set(email, {
          sender: msg.sender,
          messageCount: 0,
          firstSeen: msg.timestamp,
        });
      }
      entry.participantMap.get(email)!.messageCount++;
    }

    // Sort only when new messages arrived — not on every MutationObserver tick
    if (entry.isDirty) {
      entry.sortedMessages = Array.from(entry.messages.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      entry.isDirty = false;
    }

    return changed;
  }

  getThreadData(
    threadId: string,
    subject: string,
    client: 'gmail' | 'outlook',
  ): ThreadData | null {
    const entry = this.store.get(threadId);
    if (!entry || entry.sortedMessages.length === 0) return null;

    return {
      threadId,
      subject,
      client,
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
