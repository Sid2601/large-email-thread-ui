export interface Sender {
  name: string;
  email: string;
  initials: string;
  avatarColor: string;
}

export interface Attachment {
  name: string;
  mimeType: string;
  sizeLabel: string;
  downloadUrl: string;
}

export interface ParsedMessage {
  id: string;
  sender: Sender;
  timestamp: string;
  body: string;
  quotedText?: string;
  isCurrentUser: boolean;
  index: number;
  attachments?: Attachment[];
  bodyHtml?: string;
  source?: 'direct' | 'quoted';
  timestampEstimated?: boolean;
  /** Wall clock taken from quoted text with no offset; the instant may be shifted by a whole timezone. */
  timestampZoneUnknown?: boolean;
  recipients?: string[];
  historyCarrier?: boolean;
  quotedVariants?: { body: string; bodyHtml?: string }[];
}

export interface Participant {
  sender: Sender;
  messageCount: number;
  firstSeen: string;
}

export interface ThreadData {
  threadId: string;
  subject: string;
  client: 'gmail' | 'outlook';
  scrapedAt: string;
  messages: ParsedMessage[];
  participants: Participant[];
  currentUserEmail?: string;
  sourceTabId?: number;
  participation?: { messageId: string; kind: 'recipient' | 'authored' | 'available'; title: string; detail: string };
}

export type ExtensionMessage =
  | { type: 'THREAD_PARSED'; data: ThreadData }
  | { type: 'THREAD_UPDATED'; data: ThreadData; tabId?: number }
  | { type: 'CLEAR_THREAD' }
  | { type: 'THREAD_CLEARED'; tabId: number }
  | { type: 'REQUEST_THREAD' }
  | { type: 'SCRAPE_THREAD' }
  | { type: 'SIDE_PANEL_READY' };
