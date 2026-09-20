# 04 · Reconciliation and ordering — one message, once, in the right place

![Reconciliation and ordering](diagrams/04-reconciliation-and-ordering.png)

**Source:** `src/content/message-reconciliation.ts`, `src/content/thread-cache.ts`

After [03](03-message-splitting.md), the thread is a pile of messages in which the same email
appears several times: once as the email the mailbox holds, and once inside each later reply
that quoted it — each copy trimmed differently, re-addressed differently, and stamped with a
different client's clock. This document is about turning that pile into a conversation.

`mergeMessages(messages)` (`message-reconciliation.ts:519`) is the whole pipeline:

```ts
const voted  = votedOffsets(messages);                       // 1
const first  = reconcile(messages, voted);                   // 2
const merged = first.observed.length                         // 3
  ? reconcile(messages, [...voted, ...first.observed]) : first;
return resolveNamedSenders(                                  // 6
         sequence(                                           // 5
           placeUnread(merged.result),                       // 4
           chainEdges(messages, merged.place)));
```

---

## 1. The governing principle

> **Merging two messages that are not the same message destroys information. Showing one
> message twice merely wastes space.**

Every threshold in this file is calibrated against that asymmetry. Where the evidence runs out,
copies stay separate and the reader is told why — under *Quoted copy differs* — rather than one
of them being silently discarded.

Three consequences follow immediately, and they are enforced at the top of `match()` (`:191`):

1. Two **direct** emails are never merged on content. Two identical approvals genuinely sent
   twice are two events.
2. Matching requires `sameAuthor()`.
3. Nothing merges without an explicit, named piece of evidence — never a similarity score.

---

## 2. What text is actually compared — `core(body)` at `:107`

Comparing raw bodies fails, because providers decorate copies differently. `core()` reduces a
body to the author's own words:

1. **`withoutProviderNoise()`** (`:94`) removes chrome one tenant adds and another does not:
   - `[Image: …]` and `[Image unavailable: …]` captions, "Image removed by sender";
   - `[External]`, `[CAUTION]`, `[Suspicious]` tags and the ⓘ ⚠ ❯ ▶ glyphs around them;
   - "External email" banners, which often arrive one word per line;
   - `CAUTION:` / `WARNING:` lines, and "This email originated from outside…" paragraphs;
   - "Do not click any links or open attachments…" blocks.
2. **Quote prefixes** (`> `) are stripped.
3. **Everything from the sign-off onward is cut** (`SIGN_OFF`, `:81`). Enterprise mail has more
   sign-offs than "Regards": `Thanks & Regards`, `Kindest regards`, `Many thanks`,
   `Best wishes`, `Sent from my iPhone`, and a bare `--`. A copy that keeps a different amount
   of the contact block below it is still the same message.
4. **`[Message clipped]` / "View entire message"** and the ellipsis before it are cut
   (`CLIPPED`, `:83`) — the provider's truncation notice is not the author's punctuation.
5. **Normalisation** (`:72`): NFKC, smart quotes and apostrophes folded to ASCII, whitespace
   collapsed, lower-cased.
6. If that leaves nothing — an image-only email — the normalised full body is used instead, and
   the picture and clock guards decide.

Results are memoised in a `WeakMap` (`:121`), because a long thread compares every pair
repeatedly and each body must only be reduced once.

**All of this noise is still displayed.** It is excluded from *comparison*, not from the message.

---

## 3. Pictures as evidence — `imageKeys()` at `:6`

Providers rewrite the same picture's address in every copy, so a raw `src` comparison is
useless. Each `<img>` reduces to a key that survives re-addressing:

| Source | Key | Why |
|---|---|---|
| proxy URL ending in `#https://original…` | the original URL | Gmail's proxy carries the real address |
| `data:` payload | the payload itself | the bytes *are* the identity |
| `cid:` reference | the content id, lower-cased | stable within a message |
| `blob:` handle, or a bare `googleusercontent.com/proxy/` token | `'?'` | minted per copy; names no picture, so it matches anything |
| anything else | `origin + pathname` | providers vary the query (message id, size, token) around one picture |

### Conflict is not inequality — `imagesConflict()` at `:40`

A quoting client keeps what it can. One copy of a signature arrives with seven logos, the next
with four. An unequal count is therefore **not** evidence of a different message. The copies
conflict only when the shorter list is not the longer list with some pictures missing — checked
by a subsequence walk where `'?'` matches anything.

And even a conflict can be outvoted: a run of word-for-word identical text at least
`SPECIFIC_ENOUGH` (40) characters long is far stronger evidence of one message than picture
addresses are (`:212`). Whichever copy differs is kept as an inspectable variant either way.

---

## 4. Timezones

The single hardest problem in the product.

A provider header is rendered in **the reader's** timezone. A quoted attribution — `On 9 Sept
2026 at 09:04 … wrote:` — was written by the **quoting author's** client, in **their** zone,
and records no offset. So the same email legitimately appears hours apart in two copies, and a
reply can read `09:04` above the `13:28` message it answers.

### 4.1 Vocabulary

| Term | Definition | Code |
|---|---|---|
| `anchoredTime` | provider-dated, timezone known, parseable | `:142` |
| `anchoredDirect` | anchored **and** held by the mailbox itself | `:147` |
| `SKEW` | 5 minutes — a quoted `Sent:` is the sender's machine, a header is the server | `:133` |
| `zoneShifted` | gap between 14 min and 14 h whose remainder modulo a quarter-hour is under `SKEW` | `:154` |

Real offsets are quarter-hour multiples, so minutes of clock skew can never turn one offset into
another. Anything closer than 14 minutes is not a timezone and is left to `sameTime()`.

### 4.2 Voting — `votedOffsets()` at `:307`

One quoting client wrote every copy in a thread, so it used **one** timezone. Word-for-word
copies vote on what that offset is:

1. Group messages by identical `core()` text of at least `EXACT_ENOUGH` (24) characters.
2. Within each group, every pair that has the same author, no picture conflict, and an
   offset-shaped gap casts a vote — banked to the nearest quarter hour.
3. A vote is **corroborated** only if two separate pairs agree, or one body of at least
   `LONG_ENOUGH` (160) characters proves it alone. *No pair may confirm the offset that would
   justify merging itself.*
4. The heaviest corroborated offset wins, and then dates the copies too short to prove anything.

Pass 3 of the pipeline re-runs reconciliation with any offset a long duplicate proved during
pass 1 (`:523`), so the short copies resolve too.

### 4.3 The thresholds — `match()` at `:191`

Once two copies are the same author and their gap is offset-shaped:

| Case | Minimum shared text |
|---|---|
| word-for-word, on an offset this thread already proved | `CONFIRMED_ENOUGH` = 12 |
| word-for-word, against an email the mailbox itself holds | `SPECIFIC_ENOUGH` = 40 |
| word-for-word, with no proven offset | `LONG_ENOUGH` = 160 |
| edited near-copy, one side anchored | 160, or 40 on a proven offset |

`nearCopy()` (`:175`) accepts only **insertions**: ≥160 characters, ≥85 % of the words shared in
order, and no added token that is a digit or one of
`no, not, never, cancel, cancelled, revoked, reject, rejected, instead, except`. A changed
number or a negation is never a near copy — that is the difference between "approved" and "not
approved".

---

## 5. Merging — `reconcile()` at `:337` and `combine()` at `:275`

`reconcile()` processes **direct messages first** (`:343`), so a quoted copy always merges *into*
the mailbox's own email and inherits its provider timestamp and attachments.

For each incoming message:

- same id → `combine()`;
- exactly one `match()` candidate → merge;
- **two or more candidates** → prefer the one whose gap is 0 or this thread's proven offset; if
  that still leaves more than one, **keep the message separate**. Two genuinely identical
  approvals in one thread stay two messages;
- a merge between two long bodies teaches the conversation a new offset (`:364`).

`combine()` decides what the surviving message looks like:

- **Display body**: the *richest* candidate — `richer()` (`:267`) prefers more identifiable
  pictures, and never replaces a complete body with a clipped one just for extra logos.
- **Variants**: every candidate whose `presentation()` genuinely differs is kept in
  `quotedVariants` for the reader to inspect. Formatting-only and caption-only differences are
  not variants (`samePresentation()`, `:264`).
- **Timestamp**: by `timeRank()` (`:242`) — a real instant beats an estimate, and a known offset
  beats a zoneless quoted clock.
- **Recipients and attachments**: unioned; attachments de-duplicated on name + size + URL. This
  is why an attachment chip that Gmail renders late is never lost.

---

## 6. Ordering

### 6.1 Messages with no readable clock — `placeUnread()` at `:373`

A collapsed row labelled only `10:32` may yield no usable date at all. Rather than let it drift
to the end of the thread, its **position** — read from the mailbox's own DOM order — is treated
as authoritative, and its time is linearly interpolated between the nearest neighbours whose
clocks were readable. The message stays flagged `timestampEstimated`: only the position is now
known, not the time.

### 6.2 The chain outranks the clocks — `sequence()` at `:418`

`chainEdges()` (`:405`) converts `quotedBy` into edges **after** reconciliation, using the
`place` map, so evidence gathered from separate copies constrains the single message they were
merged into.

`sequence()` is a topological sort with a chronological tie-break:

> Of the messages whose predecessors are all placed, the one with the earliest clock goes next.

Consequences worth knowing:

- A thread that quotes nothing produces **exactly** plain chronological order.
- Sibling forwards that never quoted each other stay in clock order.
- A cycle — which can only arise if copies were wrongly collapsed — does not stall the thread;
  the clock settles it (`:430`).
- Wherever the nesting overruled a clock, **both** messages are flagged `orderedByQuote`
  (`:437`), and the panel and the export say so: *"Placed by the quoted reply chain."* A time
  that looks out of sequence is explained rather than silently corrected.

---

## 7. One person, one identity — `resolveNamedSenders()` at `:472`

A quoted attribution routinely names an author without recording an address, so the parser
invents `unknown:sarah jones`. The same colleague then reaches the thread twice — once under
their real address, once under a name alone — and the participant bar lists them twice, in two
colours.

The resolver builds two indexes from evidence the thread itself provides:

- **strong**: the local part of every address seen, and every specific display name;
- **weak**: the first token of each of those.

Addresses come from senders *and* from To/Cc lines — an address in a recipient list names its
owner as surely as a sent email does (`:496`). A key that fits two different people maps to
`null` and resolves to nobody.

Then, for each name-only sender:

- a **full name** must match a full name or a whole address local part;
- a **lone first name** may match the opening of one — "Sarah" among the thread's people is a
  reference to one of them, but "Sarah Jones" and "Sarah Connor" are two people;
- names shorter than four characters, and generic ones (`unknown`, `sender`, `noreply`,
  `support`, …), are never resolved (`specificName()`, `:54`).

Only the *identity* is resolved. Which messages are copies of one another is still decided by
the evidence above — nothing is merged as a side effect. And `isCurrentUser` follows the
resolved person, so the reader's own messages sit on the right-hand side throughout.

---

## 8. Participation boundary — `participationBoundary()` at `:527`

The marker the panel draws in the middle of a thread, deciding where the reader joined:

| Evidence | Marker |
|---|---|
| the reader's address appears in the first message | none — they were there from the start |
| the first message that names them is one they wrote | **"You were participating by this message"** |
| the first message that names them has them as a recipient | **"You joined here · first visible inclusion"** |
| no recipient evidence anywhere, but recovered history precedes the first direct email | **"Your available mailbox history starts here"** |

The wording is deliberate. It is the first *visible* inclusion, not proof of when they were
originally added — because the only evidence available is the headers that survived in quoted
history.

---

## 9. The thread cache — `thread-cache.ts`

`update(threadId, incoming)` (`:32`) merges the incoming batch with everything already known,
re-runs `mergeMessages()` over the union, and returns whether anything changed — compared by
serialising the result, so an unchanged thread never triggers a re-render. Participants are
rebuilt from the *reconciled* set (`:41`), so quoted duplicates never inflate anybody's message
count.

The key is `tabId:session:threadId` (`offscreen/parser.ts:38`), and the previous session's entry
is evicted when it changes. Reconciliation is therefore always **whole-thread**: every batch
re-reconciles everything, which is what makes the result independent of the order the mailbox
happened to deliver its emails — a property the fidelity check in
[08](08-exports-and-diagnostics.md) verifies explicitly.

**Next:** [05 · Inline images](05-inline-images.md)
