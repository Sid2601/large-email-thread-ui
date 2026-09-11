import type { MessageSnapshot, SnapshotBatch } from '../shared/snapshots';
import type { ThreadData } from '../types';
import { imageResponse, safeImageSource } from '../shared/images';

export interface ReaderAdapter {
  client: ThreadData['client'];
  messageSelector: string;
  bodySelector: string;
  threadId(): string;
  subject(): string;
  currentUser(): string;
  messageElement?(target: Element): HTMLElement | null;
  /** `position` is the message's place in the mailbox's own order, which is authoritative when a clock cannot be read. */
  snapshot(el: HTMLElement, index: number, anchor: number, previous?: MessageSnapshot, bodyDirty?: boolean, position?: number): MessageSnapshot | null;
  expand?(): void;
}
/** Only DOM snapshots run here. Parsing/reconciliation run in the extension document. */
export function startReader(adapter: ReaderAdapter) {
  let session = '', threadId = '', anchor = Date.now(), timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, requested = false, lastInteraction = 0, revision = 0;
  let known = new WeakMap<Element, MessageSnapshot>();
  let failures = 0;
  const dirty = new Map<HTMLElement, boolean>();
  const stats = { batches: 0, snapshots: 0, scans: 0, snapshotMs: 0, maxSnapshotMs: 0, ignoredMutations: 0 };
  function schedule() { if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 250); }
  function discover() {
    stats.scans++;
    document.querySelectorAll<HTMLElement>(adapter.messageSelector).forEach(el => { if (!known.has(el)) dirty.set(el, true); });
  }
  function navigation() {
    const next = adapter.threadId();
    if (next === threadId) return false;
    revision++; threadId = next; session = `${Date.now()}:${Math.random()}`; anchor = Date.now();
    known = new WeakMap(); dirty.clear(); failures = 0;
    if (!next) { void chrome.runtime.sendMessage({ type: 'CLEAR_THREAD' }).catch(() => {}); return true; }
    discover(); schedule(); return true;
  }
  async function idle() {
    await new Promise<void>(resolve => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
      else setTimeout(resolve, 0);
    });
  }
  async function flush() {
    if (running) { requested = true; return; }
    navigation();
    if (!threadId || !dirty.size) return;
    if (performance.now() - lastInteraction < 200) { schedule(); return; }
    running = true; const token = revision;
    const collected: HTMLElement[] = [];
    try {
      const snapshots: MessageSnapshot[] = [];
      // The provider renders a thread in order, so read each message's place in
      // it once per pass: a lazily inserted email shifts the ones after it.
      const positions = new Map<Element, number>();
      document.querySelectorAll<HTMLElement>(adapter.messageSelector).forEach((el, at) => positions.set(el, at));
      for (const [el, bodyDirty] of Array.from(dirty)) {
        if (token !== revision) return;
        dirty.delete(el);
        if (!el.isConnected) continue;
        await idle();
        if (token !== revision) return;
        const previous = known.get(el);
        const start = performance.now();
        const snapshot = adapter.snapshot(el, stats.snapshots, anchor, previous, bodyDirty, positions.get(el) ?? previous?.message.index ?? stats.snapshots);
        const elapsed = performance.now() - start;
        stats.snapshotMs += elapsed; stats.maxSnapshotMs = Math.max(stats.maxSnapshotMs, elapsed);
        if (!snapshot) continue;
        // Compare only a dirty message; never serialize/reparse the entire thread on scroll.
        if (previous && snapshot.html === previous.html && JSON.stringify(snapshot.message) === JSON.stringify(previous.message) && snapshot.imageSources.join('\n') === previous.imageSources.join('\n')) continue;
        known.set(el, snapshot); snapshots.push(snapshot); collected.push(el); stats.snapshots++;
        // Bound each IPC batch, including conversations with large quoted bodies.
        if (snapshots.length >= 4) break;
      }
      if (!snapshots.length || token !== revision) return;
      stats.batches++;
      const batch: SnapshotBatch = { threadId, subject: adapter.subject(), client: adapter.client, currentUserEmail: adapter.currentUser(), session, snapshots };
      const result = await chrome.runtime.sendMessage({ type: 'SNAPSHOT_BATCH', batch });
      if (result?.error || !result?.data) throw new Error(result?.error || 'Parser returned no thread.');
      if (token === revision && result?.data) await chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: result.data });
      failures = 0;
    } catch (error) {
      if (token === revision) {
        failures++;
        collected.forEach(el => { known.delete(el); if (failures <= 2 && el.isConnected) dirty.set(el, true); });
      }
      console.warn('[ThreadLens] Could not update thread:', error);
    }
    finally { running = false; if (dirty.size || requested) { requested = false; schedule(); } }
  }
  const observer = new MutationObserver(records => {
    if (navigation()) return;
    let structural = false;
    for (const record of records) {
      const el = record.target instanceof Element ? record.target : record.target.parentElement;
      const message = el && (adapter.messageElement ? adapter.messageElement(el) : el.closest<HTMLElement>(adapter.messageSelector));
      if (message) {
        const body = message.querySelector(adapter.bodySelector);
        const replacedBody = record.type === 'childList' && Array.from(record.addedNodes).some(node =>
          node instanceof Element && (node.matches(adapter.bodySelector) || !!node.querySelector(adapter.bodySelector)));
        const bodyChanged = replacedBody || (!!body && (body === el || body.contains(el)));
        dirty.set(message, dirty.get(message) === true || bodyChanged || !known.has(message));
        continue;
      }
      if (record.type === 'childList') {
        for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
          if (node instanceof Element && (node.matches(adapter.messageSelector) || node.querySelector(adapter.messageSelector))) { structural = true; break; }
        }
      }
      stats.ignoredMutations++;
    }
    if (structural) discover();
    if (dirty.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'data-src', 'email', 'data-email', 'datetime', 'title', 'data-tooltip', 'data-message-id', 'data-unique-id'] });
  window.addEventListener('hashchange', () => { navigation(); schedule(); });
  window.addEventListener('popstate', () => { navigation(); schedule(); });
  document.addEventListener('wheel', () => { lastInteraction = performance.now(); }, { passive: true });
  document.addEventListener('touchmove', () => { lastInteraction = performance.now(); }, { passive: true });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'SCRAPE_THREAD') { navigation(); discover(); schedule(); }
    if (message.type === 'EXPAND_THREAD') { adapter.expand?.(); discover(); schedule(); }
    if (message.type === 'READER_STATS') { respond({ ...stats, pending: dirty.size }); }
    if (message.type === 'READ_BLOB_IMAGE') {
      const url = safeImageSource(message.url ?? '');
      const included = url.startsWith(`blob:${location.origin}/`) && Array.from(document.querySelectorAll(adapter.bodySelector)).some(body =>
        Array.from(body.querySelectorAll<HTMLImageElement>('img')).some(img => (img.currentSrc || img.src) === url));
      if (!included) { respond({ error: 'Image is not present in the original email.' }); return false; }
      void fetch(url, { signal: AbortSignal.timeout(15000) }).then(imageResponse).then(data => respond({ data }), () => respond({ error: 'Original inline image is no longer available.' }));
      return true;
    }
    return false;
  });
  navigation();
  return { stats, disconnect: () => { observer.disconnect(); if (timer) clearTimeout(timer); } };
}

export function imageSources(body: Element): string[] {
  return Array.from(body.querySelectorAll<HTMLImageElement>('img')).map(img => img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '');
}
