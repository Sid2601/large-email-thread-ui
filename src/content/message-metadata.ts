import { recipientEmails } from './quoted-chain-parser';

/** Only inspect header recipients; addresses mentioned in the body aren't recipients. */
export function readRecipients(container: Element, body: Element): string[] {
  const result = new Set<string>();
  container.querySelectorAll('.hb [email], .g2[email], [data-recipient-email], [data-recipient-type] [email], [data-testid="recipient"], [class*="Recipient"] [title]').forEach(el => {
    if (body.contains(el)) return;
    const raw = el.getAttribute('data-recipient-email') || el.getAttribute('email') || el.getAttribute('title') || el.textContent || '';
    for (const email of recipientEmails(raw)) result.add(email);
  });
  return [...result];
}
