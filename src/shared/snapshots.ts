import type { ParsedMessage, ThreadData } from '../types';
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
