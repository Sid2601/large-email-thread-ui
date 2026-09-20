import type { ParsedMessage, ThreadData } from '../types';

/** How many messages one IPC batch carries, so a replay reads a capture the way the reader sent it. */
export const SNAPSHOT_BATCH_LIMIT = 4;
export interface MessageSnapshot {
  message: ParsedMessage;
  html: string;
  imageSources: string[];
}
export interface SnapshotBatch {
  threadId: string;
  subject: string;
  client: ThreadData['client'];
  currentUserEmail: string;
  session: string;
  snapshots: MessageSnapshot[];
}
