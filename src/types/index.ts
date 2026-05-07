export interface Sender {
  name: string;
  email: string;
  initials: string;
  avatarColor: string;
}

export interface ParsedMessage {
  id: string;
  sender: Sender;
  timestamp: string;
  body: string;
  quotedText?: string;
  isCurrentUser: boolean;
  index: number;
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
}

export type ExtensionMessage =
  | { type: 'THREAD_PARSED'; data: ThreadData }
  | { type: 'THREAD_UPDATED'; data: ThreadData }
  | { type: 'REQUEST_THREAD' }
  | { type: 'SCRAPE_THREAD' }
  | { type: 'SIDE_PANEL_READY' };
