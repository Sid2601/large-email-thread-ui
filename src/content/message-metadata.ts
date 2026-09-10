import { parseEmailDate, recipientEmails } from './quoted-chain-parser';

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

/** A collapsed row labels the day only ("10:32", "Sep 8") while the full date
 * sits in an attribute, so read every candidate and keep the first that carries
 * a year. Without one the message would be dated now and sort to the end. */
export function readTimestamp(container: Element, selector: string, fallback: string) {
  let estimate: ReturnType<typeof parseEmailDate> | undefined;
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
    for (const raw of [el.getAttribute('datetime'), el.getAttribute('title'), el.getAttribute('data-tooltip'), el.textContent]) {
      if (!raw || !/\d/.test(raw)) continue;
      const date = parseEmailDate(raw, fallback);
      if (!date.timestampEstimated) return date;
      estimate ??= date;
    }
  }
  return estimate ?? parseEmailDate('', fallback);
}
