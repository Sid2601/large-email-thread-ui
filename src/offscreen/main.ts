import { parseBatch, dropTab } from './parser';
import type { SnapshotBatch } from '../shared/snapshots';
const queues = new Map<number, Promise<unknown>>();
chrome.runtime.onMessage.addListener((message: { type: string; tabId: number; batch: SnapshotBatch }, _sender, respond) => {
  if (message.type === 'PARSER_DROP') { dropTab(message.tabId); return false; }
  if (message.type !== 'PARSER_BATCH') return false;
  const task = (queues.get(message.tabId) ?? Promise.resolve()).catch(() => {}).then(() => parseBatch(message.tabId, message.batch));
  queues.set(message.tabId, task);
  task.then(data => respond({ data }), error => respond({ error: String(error) }));
  void task.finally(() => { if (queues.get(message.tabId) === task) queues.delete(message.tabId); }).catch(() => {});
  return true;
});
