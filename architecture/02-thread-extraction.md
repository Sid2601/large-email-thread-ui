# 02 · Thread extraction — reading the mailbox without disturbing it

![Message lifecycle](diagrams/02-message-lifecycle.png)

**Source:** `src/content/incremental-reader.ts`, `src/content/gmail-scraper.ts`,
`src/content/outlook-scraper.ts`, `src/content/message-metadata.ts`,
`src/content/scraper-utils.ts`

The problem this layer solves: Gmail is a heavy single-page application that mutates its DOM
constantly, and the reader is scrolling through it while ThreadLens works. A naive scraper that
re-serialises the whole thread on every mutation makes an eighty-message conversation unusable.
So the reader is **incremental, idle-scheduled, interaction-aware and change-suppressed**.

---

## 1. The adapter contract

`incremental-reader.ts:13` defines what a provider must supply. Everything provider-specific
lives behind it, and `startReader(adapter)` supplies the entire loop.

```ts
interface ReaderAdapter {
  client: 'gmail' | 'outlook';
  messageSelector: string;   // what a message container looks like
  bodySelector: string;      // what a body looks like inside one
  threadId(): string;        // '' means "not in a conversation"
  subject(): string;
  currentUser(): string;     // the signed-in address, or ''
  messageElement?(target): HTMLElement | null;   // custom containment test
  snapshot(el, index, anchor, previous?, bodyDirty?, position?): MessageSnapshot | null;
  expand?(): void; collapse?(): void;
}
```

A `MessageSnapshot` (`src/shared/snapshots.ts`) is the contract with the parser:

```ts
{ message: ParsedMessage,   // metadata only — body is '' at this stage
  html: string,             // the body element's innerHTML
  imageSources: string[] }  // one resolved source per <img>, in DOM order
```

Splitting images into a parallel array matters: the parser runs in an inert document where
`img.currentSrc` would be meaningless, so the *resolved* address has to be captured in the page
where it is live (`incremental-reader.ts:194`).

---

## 2. The read loop

### 2.1 Observation and classification

`incremental-reader.ts:143`

One `MutationObserver` watches `document.body` with `childList`, `subtree`, `characterData`
and a **narrow attribute filter**: `src`, `srcset`, `data-src`, `email`, `data-email`,
`datetime`, `title`, `data-tooltip`, `data-message-id`, `data-unique-id`
(`incremental-reader.ts:167`). Watching all attributes would fire on every hover and focus ring
Gmail draws.

For each record the reader finds the owning message container and decides *how* dirty it is:

```ts
const replacedBody = record.type === 'childList' && [...record.addedNodes]
  .some(n => n.matches(bodySelector) || n.querySelector(bodySelector));
const bodyChanged  = replacedBody || (body && (body === el || body.contains(el)));
dirty.set(message, dirty.get(message) === true || bodyChanged || !known.has(message));
```

- `true` → the body must be re-read (expensive).
- `false` → only the header moved; the previously captured HTML and image sources are reused
  (`gmail-scraper.ts:117`), so a tooltip appearing costs almost nothing.

Mutations that belong to no message increment `stats.ignoredMutations`, and a `childList`
record that adds or removes a *container* triggers a fresh `discover()` scan.

### 2.2 Scheduling

- `schedule()` debounces at **250 ms** (`incremental-reader.ts:34`).
- `flush()` defers again if the reader interacted within the last 200 ms —
  `wheel` and `touchmove` are tracked as passive listeners (`incremental-reader.ts:57`, `170`).
- Each message is snapshotted inside `requestIdleCallback` with a 1 s timeout
  (`incremental-reader.ts:47`), so a long thread yields between emails.
- `running` + `requested` flags make `flush()` re-entrant-safe: a flush requested during a
  flush is coalesced into one follow-up (`incremental-reader.ts:54`, `98`).

### 2.3 Position is read once per pass

Before snapshotting, the reader records every container's index in the thread's own DOM order:

```ts
const positions = new Map<Element, number>();
document.querySelectorAll(messageSelector).forEach((el, at) => positions.set(el, at));
```

(`incremental-reader.ts:64`.) This matters because a lazily inserted older email shifts
everything after it. The mailbox's order is authoritative whenever a clock cannot be read — see
`placeUnread()` in [04](04-reconciliation-and-ordering.md).

### 2.4 Change suppression

A snapshot is discarded if its HTML, its serialised metadata and its image list are all
identical to the last one sent for that element (`incremental-reader.ts:79`). This is what makes
scrolling free: Gmail re-renders containers constantly without the content changing.

### 2.5 Batching and back-pressure

`SNAPSHOT_BATCH_LIMIT = 4` (`src/shared/snapshots.ts:4`). Four messages per IPC message keeps
each structured-clone small even when bodies carry large quoted histories, and gives the panel
something to show early in a long thread. Leftover dirty entries simply reschedule.

### 2.6 Failure handling

On any error (`incremental-reader.ts:91`): the failure counter increments, every element in the
failed batch is removed from `known` so it will be read again, and it is re-queued **only while
`failures ≤ 2`**. Three consecutive failures stop the retry loop rather than spinning against a
provider layout the adapter cannot read. Nothing partial is ever cached or displayed.

### 2.7 Navigation

`navigation()` (`incremental-reader.ts:39`) compares `adapter.threadId()` against the last one.
A change bumps `revision`, mints a new `session` id, resets the anchor timestamp, drops the
`WeakMap` and the dirty set, and — if the new id is empty (the reader went back to the inbox) —
sends `CLEAR_THREAD`. It is called from the observer, from `hashchange`, from `popstate` and at
the top of every flush, because Gmail navigates without any of those firing reliably on their
own.

---

## 3. The Gmail adapter

`src/content/gmail-scraper.ts`

| Concern | Implementation |
|---|---|
| Containers | `[data-message-id]` |
| Bodies | `.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]` |
| Thread id | last slash-separated segment of `location.hash`, accepted only if alphanumeric and ≥9 characters — this rejects `#inbox`, label names and search queries (`:19`) |
| Subject | `.hP, h2[data-legacy-thread-id]` |
| Sender | `.gD, [email]` → `name` attribute, then text, then a `mailto:` href; falls back to the previous snapshot's address before inventing `sender-N@unknown` |
| Signed-in user | `[data-ogsr-up] [data-email]`, else an address inside the account link's `title`/`aria-label` (`:7`) |
| Times | `.g3, time[datetime], .gH [title], .gH [data-tooltip], .xW [title], .xY [title]` (`:75`) |
| Attachments | `.aZo`, `.M2 .aQy`, `[data-tooltip*="."]` — first selector that matches wins (`:77`) |
| Message id | the provider's own `data-message-id`, so it is stable across re-reads |

**Expand / collapse** (`:40`, `:56`) prefer Gmail's own *Expand all* / *Collapse all* control and
fall back to clicking individual header rows (`.gE`, `.go`). Expansion is never automatic: it is
behind the *Read collapsed emails* button, because expanding forty emails in someone's mailbox
is a side effect they did not ask for. Collapsing reveals nothing new, so the reader does not
re-read after it (`incremental-reader.ts:176`) — everything already recovered stays in the panel
whether or not Gmail is still showing it.

---

## 4. The Outlook adapter

`src/content/outlook-scraper.ts`

Outlook Web's markup is far less stable than Gmail's and varies by tenant, so this adapter is
written as **ordered strategy lists** that fall through.

- Containers: `[data-unique-id]`, `[class*="ConversationItem"]`, `[role="option"]` (`:52`).
- Bodies: `.allowTextSelection`, `[data-block]`, `[role="document"]`, `.elementToProof` (`:107`).
- Sender, in order (`:62`): `[class*="Sender"] [title]` → `[data-pe-id]` (the SMTP address) →
  any `[title]` → any `[aria-label]`. Each candidate goes through `parseSenderTitle()` (`:17`),
  which understands `Name <addr>`, `Name (addr)`, a bare address, and an address embedded in
  other text.
- Two containment guards reject rows that only *look* like messages: the element must be inside
  the reading pane, and `messageElement(bodyEl)` must resolve back to the same container
  (`:181`–`:183`). Without them, nested `[role="option"]` elements produce phantom messages.

---

## 5. Cross-provider metadata

### 5.1 Timestamps — `message-metadata.ts:17`

A collapsed row usually shows only `10:32` or `Sep 8`, while the full date sits in an attribute.
`readTimestamp()` therefore walks every candidate element and, for each, tries `datetime`,
`title`, `data-tooltip` and finally the text — **returning the first value that carries a year**
and remembering the first estimate as a fallback. Without this, a collapsed email would be dated
"now" and sort to the end of the conversation.

`parseEmailDate()` (`quoted-chain-parser.ts:93`) does the parsing:

- normalises `", at "`, narrow/non-breaking spaces and a trailing `(3 days ago)`;
- if there is no four-digit year, injects the anchor's year into a month/day match — because
  `Date.parse('Sep 8')` silently yields **2001** in some engines;
- if the result then lands more than a day in the future, subtracts a year — the December quote
  read in January;
- returns `{ timestamp, timestampEstimated }`, where `timestampEstimated` is true whenever a
  year had to be inferred or nothing parsed.

### 5.2 Recipients — `message-metadata.ts:4`

Scoped strictly to header elements (`.hb [email]`, `.g2[email]`, `[data-recipient-email]`,
`[data-testid="recipient"]`, `[class*="Recipient"] [title]`) and **excluded if the element is
inside the body**. An address mentioned in prose is not a recipient, and treating it as one
would produce a false "You joined here" marker.

### 5.3 Sender identity — `scraper-utils.ts:23`

`buildSender()` normalises the address to lower case, falls back to the local part when no
display name exists, derives two-letter initials, and picks an avatar colour by hashing the
address across an eight-colour palette (`:14`). The same person therefore keeps the same colour
in every message, every export and every masked copy.

### 5.4 Stable message ids — `scraper-utils.ts:199`

`generateId(senderEmail, timestamp)` hashes only sender and time. The DOM index was deliberately
removed: Gmail reorders elements during progressive load, and including the index gave the same
message a different id on each scrape, which defeated cache deduplication entirely.

---

## 6. Performance characteristics

The reader keeps counters — `batches`, `snapshots`, `scans`, `snapshotMs`, `maxSnapshotMs`,
`ignoredMutations`, `pending` — exposed through `READER_STATS` (`incremental-reader.ts:178`) and
used by `scripts/benchmark-reader.mjs`. Measurements for a synthetic 40-message comparison are
in `artifacts/performance.json`.

What the design actually buys, in order of effect:

1. Parsing is not in the mail page at all.
2. An unchanged message costs one string comparison, not a re-serialisation.
3. A header-only change reuses the captured body wholesale.
4. Work yields between emails and pauses entirely while the reader scrolls.
5. Nothing is expanded, and therefore nothing is loaded, unless asked for.

This is a measured reduction in ThreadLens's own work on the mail page. It is not a promise
about a particular live mailbox's frame rate, and it is not a claim about total extension CPU.

**Next:** [03 · Message splitting](03-message-splitting.md)
