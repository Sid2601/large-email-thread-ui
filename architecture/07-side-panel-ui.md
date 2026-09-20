# 07 · The side panel — showing a conversation honestly

![System architecture](diagrams/01-system-architecture.png)

**Source:** `src/side-panel/**`

The panel's job is narrow: take a `ThreadData`, render it as a chat, and never overstate what
is known. Almost all of its complexity is in the second half of that sentence.

---

## 1. Subscribing to the thread — `hooks/useThreadData.ts`

```
mount / tab activated  →  REQUEST_THREAD  →  { data, tabId } | null
live                   →  THREAD_UPDATED | THREAD_CLEARED
```

Three guards, all of which exist because a side panel outlives the tab it was opened on:

1. **`tabId` must match.** The panel resolves the active tab itself and ignores any broadcast
   for another one (`:22`), so switching tabs never shows the previous tab's mail.
2. **`revision` guards the async gap.** A `REQUEST_THREAD` in flight when the reader switches
   tabs is discarded rather than applied (`:9`, `:16`).
3. **`active` guards unmount.** Nothing sets state after teardown.

`chrome.tabs.onActivated` re-runs the whole refresh, and `REQUEST_THREAD` also nudges the mail
tab to re-scrape (`service-worker.ts:57`), so a panel opened long after a thread was read still
gets current data.

---

## 2. Filtering and search

Two composed hooks, applied in a fixed order (`App.tsx:24`):

```
threadData.messages → useParticipantFilter → useSearch → <ChatThread>
```

- **`useParticipantFilter`** filters on `sender.email` and resets when the thread id changes.
  The chips come from `ThreadData.participants`, which is rebuilt from *reconciled* messages, so
  counts are not inflated by quoted duplicates. Each chip carries the participant's avatar
  colour and initials — the same colour that message's bubble uses, because both come from
  `hashColor(email)`.
- **`useSearch`** matches, case-insensitively, against the body, **every quoted variant's**
  body, the sender's name and the sender's address (`useSearch.ts:11`). Searching the variants
  matters: a phrase may survive only in the copy that was trimmed differently.

Both filters are display-only. The export deliberately ignores them (see
[08](08-exports-and-diagnostics.md)) — a filtered export would be a quietly incomplete record.

### Highlighting without destroying the message — `components/email-markup.ts:4`

`highlightedEmailHtml(html, query)` sanitises first, then walks **text nodes only** with a
`TreeWalker`, wrapping matches in `<mark>`. It never touches markup, so highlighting a word that
happens to appear inside a table cell or a link leaves the table and the link intact. Plain-text
bodies use the simpler `highlightText()` in `MessageBubble.tsx:24`.

---

## 3. Rendering a message — `components/MessageBubble.tsx`

Three shapes, chosen by what the message actually is:

| Shape | When | Appearance |
|---|---|---|
| **Carrier notice** (`:56`) | `historyCarrier` — a forward with no words of its own | one centred pill: *"↪ Dana passed this conversation on to … without adding a message"* |
| **Own message** (`:66`) | `isCurrentUser` | right-aligned blue bubble, no avatar |
| **Other** (`:91`) | otherwise | left-aligned white bubble with a coloured initials avatar; the sender's name is shown only when it differs from the previous message's (`ChatThread.tsx:59`) |

Body rendering prefers `bodyHtml` through `RichBody` and falls back to pre-wrapped plain text.

### Telling the truth about time — `:38`–`:52`

```
timestampEstimated          → "Time unavailable · approximate order"
timestampZoneUnknown        → tooltip: read from quoted text, which records no timezone
orderedByQuote              → tooltip: placed by the quoted reply chain, not by this clock
source === 'quoted'         → the label "From quoted history · " before the time
```

Four different kinds of uncertainty, four different disclosures. None of them is a dialog or a
warning icon — they are quiet, adjacent to the thing they qualify, and available on hover.

### Quoted variants — `:13`

When reconciliation kept more than one wording for a message, a `<details>` disclosure reads
*"Quoted copy differs (n)"* and contains each copy rendered in full. This is the visible half of
the principle in [04](04-reconciliation-and-ordering.md): a near-match is preserved for
inspection, never discarded.

### Attachments — `:78`, `:111`

Rendered under the bubble on both sides; see [06](06-attachments.md).

---

## 4. The thread view — `components/ChatThread.tsx`

- Messages are keyed by `msg.id`, which is stable across re-reads, so React reuses DOM nodes as
  a thread grows instead of remounting bubbles (and restarting image loads).
- The **participation marker** is rendered inline, immediately before the message it refers to
  (`:64`), as a labelled `<section>` — not as a banner at the top, because *where* the reader
  joined is a position in the conversation.
- New messages scroll the view to the bottom smoothly (`:41`).
- **Jump buttons** (`:80`): a floating ↑ and ↓ appear only when there is somewhere to go,
  tracked by a scroll handler with a 40 px edge tolerance (`EDGE`, `:13`). A long thread is
  mostly quoted history, so both ends are worth one tap.
- Filtering to a participant with no messages produces an explicit empty state rather than a
  blank pane (`:46`).

---

## 5. Header controls — `App.tsx`

- Subject, message count and the build version; the title reads **ThreadLens Dev** in the
  development build (`:42`).
- A standing caveat, always visible: *"Includes history quoted in the emails available here.
  Earlier messages or files omitted by the sender cannot be recovered."* (`:65`).
- **Gmail only**: *Read collapsed emails* and *Collapse emails again* (`:61`). Both are sent to
  the mail tab by id, and a failure — usually a tab that has since been reloaded — surfaces as
  an inline `role="alert"` telling the reader exactly what to do (`:18`).
- **Development build only**: `<DevDownloads>` (see [08](08-exports-and-diagnostics.md)).

---

## 6. Keyboard and accessibility

`hooks/useKeyboardShortcuts.ts`

| Key | Action |
|---|---|
| `Ctrl`/`Cmd` + `F` | focus the search box (the browser's own find is suppressed) |
| `Escape` | clear the search; also blurs the box when it has focus (`SearchBar.tsx:14`) |
| `J` / `↓`, `K` / `↑` | scroll the thread by 80 px |
| `Home` / `End` | jump to the first or latest message |
| `Alt`+`Shift`+`T` | open the panel (a Chrome command, `manifest.json`) |

`j`/`k` are suppressed while an input has focus. Beyond that: images are focusable buttons with
labels, the viewer is a native `<dialog>` (so focus trapping and `Escape` are the platform's),
busy states use `role="status"`, errors use `role="alert"`, and the participation marker is a
labelled `<section>` (exported messages are labelled `<article>`s).

---

## 7. Presentation of email HTML — `styles/index.css`

Email markup is rendered inside `.email-body`, which imposes what a panel 400 px wide needs:

- tables collapse, get cell borders, and are allowed to exceed the panel width inside a
  horizontally scrolling body — so a wide financial table stays readable instead of being
  crushed;
- `overflow-wrap: anywhere` for the reference numbers and URLs enterprise mail is full of;
- images are block-level, max-width constrained, `cursor: zoom-in`;
- **a placeholder box** for an image that has not loaded yet
  (`img[data-tl-image-src]:not([src])`), so the thread does not jump as pictures arrive;
- `mark` for search hits; muted borders for quotations; monospace backgrounds for code.
- Dark mode throughout, driven by Tailwind's `dark:` variants against the system theme.

---

## 8. States before a thread exists

- **`LoadingState`** — three skeleton bubbles, alternating sides.
- **`EmptyState`** — what to do, plus a short self-diagnosis list (open the thread, check the
  console for `[ThreadLens]`, reload the extension) for the case where the content script did
  not attach.

---

## 9. What the panel deliberately does *not* do

- It does not parse. Every string it renders was produced in the offscreen document.
- It does not write to the mailbox, beyond the two explicit Gmail expand/collapse clicks.
- It does not persist anything except attachments the reader saved.
- It does not hide uncertainty to look tidier.

**Next:** [08 · Exports and diagnostics](08-exports-and-diagnostics.md)
