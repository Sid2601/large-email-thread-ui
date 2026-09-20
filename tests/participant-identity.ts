/**
 * Synthetic cases for one person reaching a thread under two identities.
 *
 * A quoted attribution names an author but rarely records an address, so the
 * same colleague arrives once as `sarah.jones@…` and once as a name alone. They
 * are different messages rather than copies, so nothing merged them, and the
 * panel drew one person twice — two chips, two colours, two of everything.
 */
import { describe, expect, it } from 'vitest';
import { mergeMessages } from '../src/content/message-reconciliation';
import { threadCache } from '../src/content/thread-cache';
import { buildSender } from '../src/content/scraper-utils';
import { conversationHtml } from '../src/side-panel/export/conversation';
import { IdentityMasker, maskThread } from '../src/side-panel/export/mask';
import type { ParsedMessage } from '../src/types';

let sequence = 0;
function message(sender: ReturnType<typeof buildSender>, body: string, options: Partial<ParsedMessage> = {}): ParsedMessage {
  return { id: `m${++sequence}`, sender, timestamp: '2026-09-08T09:00:00Z', body, source: 'quoted', index: 0, isCurrentUser: false, ...options };
}
/** What a quoted attribution leaves behind: a name, and no address at all. */
const named = (name: string) => buildSender(name, `unknown:${name.toLowerCase()}`);
const addressed = (name: string, email: string) => buildSender(name, email);
const senders = (messages: ParsedMessage[]) => messages.map(m => m.sender.email);
const people = (messages: ParsedMessage[]) => new Set(messages.map(m => m.sender.email)).size;

describe('One person, one identity', () => {
  it('gives a name-only copy the address that person writes from', () => {
    const merged = mergeMessages([
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'The transfer schedule is attached.', { source: 'direct' }),
      message(named('Sarah Jones'), 'Have been off Thursday and Friday. We are looking at it today.'),
    ]);
    expect(merged).toHaveLength(2);
    expect(people(merged)).toBe(1);
    expect(senders(merged).every(email => email === 'sarah.jones@warehouse.example')).toBe(true);
    // One address means one colour and one set of initials, everywhere.
    expect(new Set(merged.map(m => m.sender.avatarColor)).size).toBe(1);
    expect(new Set(merged.map(m => m.sender.initials)).size).toBe(1);
  });

  it('does so whichever copy the mailbox happens to deliver first', () => {
    const first = message(named('Sarah Jones'), 'We are looking at it today.');
    const second = message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' });
    expect(people(mergeMessages([first, second]))).toBe(1);
    expect(people(mergeMessages([second, first]))).toBe(1);
  });

  it('recognises the person when the provider recorded no display name for them', () => {
    // Gmail gives only the address, so the sender is named after its local part.
    const merged = mergeMessages([
      message(addressed('sarah.jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' }),
      message(named('Sarah Jones'), 'We are looking at it today.'),
    ]);
    expect(people(merged)).toBe(1);
  });

  it('uses an address the thread has been writing to when the person never sent from it', () => {
    const merged = mergeMessages([
      message(addressed('Ada Lovelace', 'ada@warehouse.example'), 'Adding the depot team.', { source: 'direct',
        recipients: ['sarah.jones@warehouse.example', 'depot@warehouse.example'] }),
      message(named('Sarah Jones'), 'We are looking at it today.'),
    ]);
    expect(people(merged)).toBe(2);
    expect(senders(merged)).toContain('sarah.jones@warehouse.example');
    expect(senders(merged).some(email => email.startsWith('unknown:'))).toBe(false);
  });

  it('treats the reader as themselves under either identity', () => {
    const merged = mergeMessages([
      message(addressed('Sam Patel', 'sam@warehouse.example'), 'Confirmed on my side.', { source: 'direct', isCurrentUser: true }),
      message(named('Sam Patel'), 'I will pick this up on Monday and report back to the depot team.'),
    ]);
    expect(merged.every(m => m.isCurrentUser)).toBe(true);
  });
});

describe('A first name on its own', () => {
  it('belongs to the one person in the thread who has it', () => {
    const merged = mergeMessages([
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' }),
      message(named('Sarah'), 'We are looking at it today and will send it on.'),
    ]);
    expect(people(merged)).toBe(1);
    expect(senders(merged)).toEqual(['sarah.jones@warehouse.example', 'sarah.jones@warehouse.example']);
  });

  it('belongs to nobody when the thread has two of them', () => {
    const merged = mergeMessages([
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Northern depot is clear.', { source: 'direct' }),
      message(addressed('Sarah Connor', 'sarah.connor@haulage.example'), 'Southern depot is not.', { source: 'direct' }),
      message(named('Sarah'), 'Both depots are being reviewed this week by the operations team.'),
    ]);
    expect(people(merged)).toBe(3);
    expect(senders(merged)).toContain('unknown:sarah');
  });

  it('does not let a full name match a different person who shares it in part', () => {
    const merged = mergeMessages([
      message(addressed('Sarah Connor', 'sarah.connor@haulage.example'), 'Southern depot is not clear.', { source: 'direct' }),
      message(named('Sarah Jones'), 'The northern depot schedule is attached for review.'),
    ]);
    expect(people(merged)).toBe(2);
    expect(senders(merged)).toContain('unknown:sarah jones');
  });
});

describe('Never inventing a link between two colleagues', () => {
  it('leaves a name that fits two different people exactly as it found it', () => {
    const merged = mergeMessages([
      message(addressed('Chris Baker', 'chris.baker@warehouse.example'), 'Northern depot is clear.', { source: 'direct' }),
      message(addressed('Chris Baker', 'chris.baker@haulage.example'), 'Southern depot is not.', { source: 'direct' }),
      message(named('Chris Baker'), 'Both depots are being reviewed this week by the operations team.'),
    ]);
    expect(merged).toHaveLength(3);
    expect(senders(merged)).toContain('unknown:chris baker');
  });

  it('resolves nothing from a nickname or a placeholder too short to identify anybody', () => {
    const merged = mergeMessages([
      message(addressed('Dhruv Joshi', 'dhruv.joshi@warehouse.example'), 'Approved, thanks.', { source: 'direct' }),
      message(named('DJ'), 'Thanks for the analysis, the numbers look right to me now.'),
      message(named('Unknown'), 'Please keep me copied on the next update from the depot.'),
    ]);
    expect(people(merged)).toBe(3);
    expect(senders(merged)).toContain('unknown:dj');
  });

  it('resolves an identity without merging two distinct messages by that person', () => {
    const merged = mergeMessages([
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'First note about the transfer.', { source: 'direct' }),
      message(named('Sarah Jones'), 'Second, entirely different note about the putaway.', { timestamp: '2026-09-08T11:00:00Z' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(people(merged)).toBe(1);
  });

  it('stays where it settled when the thread is reconciled again', () => {
    const input = [
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' }),
      message(named('Sarah Jones'), 'We are looking at it today.'),
    ];
    const once = mergeMessages(input);
    expect(mergeMessages(once)).toEqual(once);
    expect(mergeMessages([...once, ...input])).toEqual(once);
  });
});

describe('What the panel and the export then show', () => {
  it('lists one participant with one message count, not one person twice', () => {
    const id = `identity-${++sequence}`;
    threadCache.update(id, [
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' }),
      message(named('Sarah Jones'), 'We are looking at it today.'),
      message(named('Sarah Jones'), 'One more note on the putaway adjustment.', { timestamp: '2026-09-08T12:00:00Z' }),
    ]);
    const thread = threadCache.getThreadData(id, 'Warehouse transfers', 'gmail', 'sam@warehouse.example')!;
    threadCache.evict(id);
    expect(thread.participants).toHaveLength(1);
    expect(thread.participants[0].messageCount).toBe(3);
    expect(thread.participants[0].sender.email).toBe('sarah.jones@warehouse.example');
  });

  it('says an address was never recorded rather than printing one that does not exist', () => {
    const thread = {
      threadId: 't', subject: 'Warehouse transfers', client: 'gmail' as const, scrapedAt: '2026-09-08T09:00:00Z',
      participants: [], messages: [message(named('DJ'), 'Thanks for the analysis, the numbers look right to me.')],
    };
    const html = conversationHtml(thread, new Date('2026-09-08T09:00:00Z'));
    expect(html).not.toContain('unknown:dj');
    expect(html).toContain('address not recorded');
  });
});

describe('A masked copy of a thread with a name-only author', () => {
  const thread = {
    threadId: 't', subject: 'Warehouse transfers', client: 'gmail' as const, scrapedAt: '2026-09-08T09:00:00Z',
    currentUserEmail: 'sam@warehouse.example', participants: [],
    messages: [
      message(addressed('Sarah Jones', 'sarah.jones@warehouse.example'), 'Schedule attached.', { source: 'direct' }),
      message(named('Sarah Jones'), 'We are looking at it today and will send it on.'),
      message(named('DJ'), 'Thanks, the numbers look right to me now.'),
    ],
  };

  it('never invents an address for an author who never gave one', () => {
    const masked = maskThread(thread);
    // The first two are one person under two identities, exactly as the real thread holds them:
    // one placeholder name, and the copy that carried no address still carrying none.
    expect(masked.messages[0].sender.email).toMatch(/@/);
    expect(masked.messages[1].sender.email).toMatch(/^unknown:/);
    expect(masked.messages[1].sender.email).not.toMatch(/@/);
    expect(masked.messages[1].sender.name).toBe(masked.messages[0].sender.name);
    // The nickname is nobody the thread identifies, so it stays a person of its own.
    expect(masked.messages[2].sender.email).toMatch(/^unknown:/);
    expect(masked.messages[2].sender.name).not.toBe(masked.messages[0].sender.name);
  });

  it('groups the masked copy exactly as the real thread groups', () => {
    const masked = maskThread(thread);
    expect(people(mergeMessages(masked.messages))).toBe(people(mergeMessages(thread.messages)));
    expect(conversationHtml(masked, new Date('2026-09-08T09:00:00Z'), { masked: true })).toContain('address not recorded');
  });

  it('does not read the word "unknown" in a message as somebody\'s name', () => {
    const masker = new IdentityMasker();
    masker.person('unknown:sarah jones', 'Sarah Jones');
    expect(masker.text('The unknown quantity is the putaway adjustment.')).toBe('The unknown quantity is the putaway adjustment.');
  });
});
