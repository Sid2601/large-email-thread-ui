# ThreadLens project context

Updated 2026-09-14. Current source version: **1.7.2**.

## Goal

Turn a long enterprise email conversation into chronological chat messages, including history quoted in emails received after joining a conversation. Preserve useful email formatting and offer local attachment copies. This document supersedes the earlier session/task status in this file; PLAN.md and TASKS.md are historical notes, not the current implementation contract.

## What changed

- Every expanded Gmail email is parsed for direct content AND included history, regardless of how many direct messages exist. Expanding more messages no longer evicts earlier quoted-only history.
- A shared DOM-aware parser recognizes Gmail attribution blocks, English `On … wrote:` text, forward separators, and Outlook From/Sent/To/Subject blocks. Selected French, German and Dutch header labels are also recognized; date parsing still depends on browser support.
- Text offsets map back to DOM positions. Each segment clones its own HTML range with formatting ancestors restored, preserving tables (including cell spans), lists, emphasis, paragraphs, code and allowlisted styles.
- Short replies are retained. Message identities use full normalized content and header dates rather than only the first 300 characters. Distinct direct provider IDs are never content-deduplicated against one another.
- Reconciliation prefers direct messages over matching quoted copies, retains missing older history, and updates existing messages when attachments/formatting change. Missing-year dates are inferred from the conversation anchor (including December/January rollover) and marked approximate; exact dated copies can resolve them. Unknown dates remain visibly labeled.
- Attachment chips keep visible metadata even if no direct link is accessible. Open in email, Save locally, Choose downloaded file, Download saved file, and Remove local copy are available as appropriate.
- Files use extension-origin IndexedDB, explicitly saved by the user, with a 20 MB per-file and 100 MB total limit. Authenticated direct downloads are attempted only for supported mail hosts, with timeout, response checks and streamed size enforcement. A downloaded-file picker is the fallback when provider authentication or URLs prevent direct saving.
- Mail bodies use `chrome.storage.session`, keyed by source tab; the old global persistent currentThread entry is removed. Switching tabs requests that tab's data, and Gmail inbox navigation clears the displayed thread. The side panel opens from the extension action, not every automatic scrape.
- Reply order follows the quote nesting, not the quoted clocks. A quoting client encloses the email it answers, so nesting is first-hand evidence of order, while every attribution clock is stamped in the quoting author's own timezone with no offset recorded. Correspondents an offset apart therefore read out of sequence and were being reordered; they no longer are.
- Rich-text search highlights text nodes without destroying tables. Conversation subjects, recovery labels and full dates are visible.

## Source map

- `src/content/quoted-chain-parser.ts`: text projection, header recognition, HTML range extraction, date parsing, direct/quoted reconciliation. `extractEmailBody` returns `{ body, bodyHtml, history }`; `parseQuotedChain` remains compatible with original tests.
- `src/content/gmail-scraper.ts`: message container extraction, expanding Gmail, attachments, navigation and mutation observation.
- `src/content/outlook-scraper.ts`: reading-pane/selected-conversation selectors, shared parser and visible attachment anchors. More tenant-specific live verification is needed.
- `src/content/scraper-utils.ts`: text projection helpers and HTML/style/link allowlists. Active content, tracking image loads, arbitrary CSS and unsafe protocols are removed. Safe inline images retain their source and placement; unavailable images have explicit captions.
- `src/content/message-reconciliation.ts`: conservative exact/near quote matching, variant preservation, metadata merging and evidence-based participation boundaries.
- `src/content/message-metadata.ts`: recipient extraction scoped to provider header elements, excluding the message body.
- `src/content/thread-cache.ts`: reconciles progressively available messages and recomputes participants.
- `src/shared/capture.ts`: the thread-source capture format, and the picture fold that drops payload bytes while keeping picture identity.
- `src/shared/capture-replay.ts`: replays a capture through the real parser and cache, reduces a thread to an identity-independent shape, and compares an original capture with its masked copy.
- `src/side-panel/export/capture.ts`: masks a capture, checks it against the original and saves either copy.
- `src/side-panel/export/download.ts`: the panel's own file save, shared by both exports.
- `src/background/service-worker.ts`: tab-scoped session storage and panel routing.
- `src/side-panel/storage/attachments.ts`: IndexedDB, limits and authenticated attachment retrieval.
- `src/side-panel/components/AttachmentChip.tsx`: attachment operations and visible errors.
- `src/side-panel/components/email-markup.ts`: safe HTML search highlighting.
- `tests/verify.ts`: original 35 assertions against supplied fixtures.
- `tests/enterprise-cases.ts`: 37 synthetic enterprise regressions for duplicates, changed quotes, signature scopes, forwards, recipient evidence, missing years and 40-message reconstruction across five direct emails.
- `tests/regressions.ts`: 22 additional regressions, including 40-message history, short replies, same-prefix content, HTML tables, dates, reconciliation and unsafe markup.
- `scripts/smoke-extension.mjs`: real unpacked Chromium extension test using entirely synthetic mail and a temporary browser profile.

## Build and validation

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Or `npm run release` for all four in order, stopping at the first failure.

`package.json` drives the generated manifest/UI version. Load `dist/` as an unpacked Chrome extension, or the `releases/threadlens-<version>/` folder the release command extracts. A ZIP of the same contents, its SHA-256 and `INSTALL.txt` are written beside it. `scripts/release.mjs` re-runs itself on an nvm-installed Node 22 when the shell's default node is older than the test runner needs.

Browser smoke test requires an available Playwright installation and its Chromium browser:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/smoke-extension.mjs
```

Validation on 2026-09-09: typecheck, 88 automated assertions, production build, and real Chromium smoke testing. The smoke covers direct plus recovered messages, table rendering, rich search, direct file saving, manual file import, persistence after reload, downloading/removing local copies, active-tab isolation, and inbox clearing. Screenshot: `artifacts/threadlens-smoke.png`. It does not use or authenticate to a live enterprise mailbox.

## Important limits / follow-up

1. The extension only sees mail and quotes present in the rendered page. Earlier messages not included by a sender cannot be recovered through parsing; attachments mentioned in quoted text do not contain file bytes. Provider API access would be a separate integration requiring authentication and enterprise approval.
2. DOM selectors vary by mail provider, language and tenant. Validate real Gmail and Outlook examples locally after loading. Prefer anonymized HTML fixtures containing exact wrappers when reporting parser gaps.
3. Arbitrary imported layouts, inline replies interleaved inside older messages, fully localized dates, stripped attribution headers and sender-edited quotations can remain ambiguous. Fallbacks should retain readable content and avoid guessing identities.
4. Formatting is structurally preserved, not pixel-identical: active content and arbitrary fonts/layout CSS are excluded; available inline images are retained. Email text or attachments are never sent to an application backend.
5. Direct attachment links may expire or require provider-specific authentication. Save locally while accessible, or download in email and choose that file. HTML attachment responses are not automatically cached because they may be login pages; manual import remains available.
6. Local files persist across browser restarts until removed, browser storage is cleared, or the extension is uninstalled. Chrome storage is not additional application-level encryption. Copies are keyed by message ID/name/size, so renamed or refreshed provider message identities may require reselecting a file. Removing the extension removes its cache.
7. No live-client production guarantee was made. The browser test intercepts synthetic Gmail responses; Outlook selectors and real attachment authentication remain the primary next manual checks.

## References

- Chrome extension storage: https://developer.chrome.com/docs/extensions/reference/api/storage
- Extension storage / IndexedDB: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- DOM range cloning: https://developer.mozilla.org/en-US/docs/Web/API/Range/cloneContents

## 1.1.1 preload fix

Disabled Vite `build.modulePreload` after Chrome reported a cross-world extension resource mismatch for the shared scraper-utils chunk. The generated side panel previously emitted a modulepreload link for that file. Normal ES module imports remain enabled; no permissions or execution-world changes are needed. The browser smoke now checks the generated HTML and Chrome log entries for this regression.

## 1.2.0 conversation export

The button below the subject exports `threadData` as one standalone HTML document, independent of search/participant filters. `src/side-panel/export/conversation.ts` handles chronological ordering, escaped metadata, sanitized body markup, printable styling, filenames and Blob downloads. It includes all currently recovered message bodies, senders, dates, recovery/estimated-time labels, optional extra quotes and attachment names. No attachment bytes or expiring provider URLs are embedded. There are no scripts or remote style dependencies, and the document sets a restrictive CSP. Four export tests cover ordering/formatting, unsafe input, estimated timestamps and filenames. The real extension smoke downloads during an active search, verifies all four messages, and opens the HTML from disk. Example artifacts contain synthetic data only.

## 1.3.0 enterprise reply/forward cleanup

Investigated the user's supplied exported HTML locally without treating document text as instructions or committing private message contents. The export contained six entries: an original with an apparent 2001 missing-year parsing artifact and a quoted version with a small site-name insertion plus extra signatures. Replaying that missing-year scenario with corrected inference reconciled it to five entries, preserving the differing copy under the original. The original Downloads file was not modified. Synthetic fixtures reproduce the structure rather than retaining customer mail.

Changes:
- Quote regions now respect finite Gmail blockquote scopes. Text after a nested quote belongs to its enclosing sender, rather than leaking into the oldest message. Ordinary blockquotes with no attribution remain intact.
- Reconciliation ignores formatting/signature noise only for matching. Direct provider IDs stay authoritative; separate direct emails never collapse merely because their bodies match. Ambiguous matches are retained.
- Near-copy matching requires the same sender, compatible time evidence, long similar content and only a small word insertion. Changed quantities, negations and substitutions remain separate. Any differing full copy, including signature changes, is retained as a quoted variant. This is conservative heuristic matching, not message-ID proof; users can inspect variants.
- Explicit recipient headers (including wrapped Outlook To/Cc lists) feed participation markers. Addresses inside message bodies are excluded. First known authorship has its own label. Unknown recipients/Bcc/distribution-list membership use a mailbox-availability marker rather than a guessed join date.
- Pure forwards retain a labeled receiving-envelope message so the first visible inclusion can be placed correctly even without introductory text.
- Conversation exports apply the same reconciliation and include variant details and participation boundaries; attachment behavior is unchanged.
- Browser smoke adds duplicate quotes across several direct emails, a missing-year near-copy reproduction, evidence-backed joining, and forwarding without introductory text. Unit suite: 88 tests.

Known limits remain: omitted/unreceived earlier mail and inaccessible file bytes cannot be reconstructed; localized/custom headers, provider DOM changes, ambiguous timestamps, sender-edited quotations and interleaved inline responses require case-specific handling. Do not replace conservative matching with broad fuzzy deletion. See TEST_COVERAGE.md before adding fixtures.

## Recovery audit, 2026-09-10

Fresh main at 1048d56 includes the 1.3.1 timezone fixes plus quoted-history parsing, enterprise deduplication/variants, participation markers, HTML export, IndexedDB attachments and the modulepreload fix. Generated releases were ignored rather than lost source fixes. `npm run package` now regenerates a validated local ZIP from committed sources. The unfinished 1.4.0 inline-image/offscreen-parser changes were not in main and are being restored separately from local task edit records.

## 1.4.0 inline images and mail-page performance

The user-supplied Warehouse Transfer export was inspected read-only. It has image placeholders but no image elements/URLs or bytes, so it cannot itself be repaired. The original mail must be refreshed and re-exported. Customer content has not been copied into fixtures.

- `src/content/incremental-reader.ts` owns mutation filtering, navigation generations, per-message snapshots, idle scheduling, four-message IPC batches and bounded retries. Scrolling/toolbar updates do not reparse known messages; body replacements and image-source changes do. Gmail expansion is explicit, not automatic.
- `src/shared/snapshots.ts` defines snapshot payloads. The service worker ensures `src/offscreen/index.html` exists using the DOM_PARSER reason; its parser processes snapshots and reconciles in tab/session-specific caches. This requires Chrome 116+ and the offscreen permission.
- Range extraction uses one mapping per text run instead of one object per character. Image markers preserve leading, trailing, image-only and table-cell images and their quoted author. Parsing uses inert documents so image URLs do not load during extraction. Existing 1.3.1 timezone reconciliation is preserved.
- `src/shared/images.ts` validates source protocols, raster responses and the 8 MB fetch limit. HTTPS images render lazily. Mail-origin blob URLs resolve through the original content script only if the image is still present in that tab. Gmail proxy host permission supports authenticated image fetches. Script handlers, unsafe URLs, srcset and explicit tiny tracking images are removed. HTTPS rendering still contacts source hosts.
- `RichBody.tsx` keeps formatted content/search, lazy image resolution, keyboard/click full-size viewing and visible failure captions. `src/side-panel/media/images.ts` limits fetch concurrency to two and keeps a small session cache. The export embeds accessible raster bytes with a 50 MB encoded-image limit, marks failures and retains usable HTTPS sources. Separate attachment saving is unchanged.
- The test environment is jsdom. happy-dom 20.9.0 silently returned empty Range slices for nodes in DOMParser documents because its Range was tied to window.document. The same production parser passed Chromium and all 121 checks pass under jsdom; no test expectations were weakened to mask empty parsing.

Verification includes actual Chromium HTTPS/blob images, image ownership/placement, full-size dialogs, offline image bytes, one-message updates, body-node replacement, existing enterprise history/export/attachment workflows and cross-world preload checks. `scripts/benchmark-reader.mjs` compares a synthetic 40-message ~1 MB nested thread against the saved 1.3.1 build, including unrelated toolbar/scroll mutations. See `artifacts/performance.json` for raw measurements. Results measure mail-page work only; parsing still consumes extension CPU and live Gmail/Outlook tenant behavior requires user verification.

Source constraints: omitted history, sender-removed pictures, unresolved cid references, expired/auth-blocked image links cannot be recreated. Collapsed Gmail bodies absent from the DOM need explicit expansion. The image export limits protect memory and can leave very large images online-only with a notice.

Reference: https://developer.chrome.com/docs/extensions/reference/api/offscreen

Final recovery validation (2026-09-10): 121 tests pass, production packaging passes, and Chromium verifies HTTPS and source-tab blob rendering, full-size viewing and offline image exports. The previously failing blob case was caused by rejecting extension pages opened in a browser tab; the service worker now validates the exact extension panel URL, and the content script validates that the requested blob belongs to an included image. Outlook fallback IDs stay stable on edits, and nested item selectors resolve to one authoritative container.

Synthetic performance result: 40 messages / 1,043,271 input HTML bytes. The recorded mail-page script time during five toolbar/scroll changes fell from 2353.896 ms (1.3.1) to 1.212 ms; no additional message snapshots occurred. Initial capture work was 84.1 ms total, at most 2.7 ms for one snapshot. Total scenario elapsed time increased from 8.3 s to 11.8 s because parsing is deliberately paced outside the mail page; this is not an end-to-end speed or FPS claim. The benchmark source and raw JSON are committed.

## 1.5.1 reply order across timezones

A Sheffield North export placed Jay's `09:04` explanation before the `13:28` message it answered. Both times were read from quoted attributions, and neither records an offset: Jay's was written by Marie's UK client and Jodie's by Jay's IST client, so `13:28 IST` really preceded `09:04 BST`. The absolute instants are not recoverable — no message appears twice in that thread for the existing offset voting to calibrate against — but the order is, because the chain nests it.

- `quoted-chain-parser.ts` records `quotedBy` on each recovered message: the id of the innermost enclosing header, or the carrier's id at the top level. Only real enclosure counts; sibling forwards prove no order and get no link. A dropped empty quote hands its children the nearest surviving quoter.
- `message-reconciliation.ts` sorts topologically instead of by clock alone: `reconcile` now reports where each copy landed, so links read from separate emails constrain the one message they merged into, and two of the user's own emails can join their partial chains through a shared message. Of the messages whose predecessors are placed, the earliest clock goes next, so a thread that quotes nothing is ordered exactly as before. A cycle — reachable only if two messages were wrongly collapsed — falls back to the clock rather than stalling.
- Where nesting overrules the clocks, both messages carry `orderedByQuote`; the panel tooltip and the export label them **Placed by the quoted reply chain**, since a `13:28` shown above an `09:04` otherwise reads as a new defect.

Displayed times are unchanged and remain the raw quoted clocks in mixed zones. Ordering is now correct; the instants stay unrecoverable unless a message appears in two chains, which the existing offset voting already handles.

## 1.6.0 identity-masked export

A third export button, **Masked copy (share-safe)**, writes the conversation with its identities replaced so a thread can be handed to someone diagnosing a parsing problem without disclosing who it is about.

- `src/side-panel/export/mask.ts` holds `IdentityMasker` and `maskThread`. Header identities are seeded from senders, recipients, participants and the signed-in address before any body is read, so a name mentioned in prose resolves to the person whose header it belongs to. One real value always maps to one placeholder: `Person 1`, `person1@company1.example`, `Company 2`, `[phone-1]`, `[number-1]`, `image-1.png`, `masked-1`.
- Masked: sender names and addresses, addresses found anywhere in text, learned name phrases and their parts, employer domains taken from correspondents' own addresses, phone and long reference numbers, link hosts/paths (query strings dropped), image sources, attachment names, message ids and the thread id. A capitalised opening of a known name — `Sid`, `Elevation` — is masked case-sensitively, which catches greetings and run-together domains while leaving ordinary lowercase words readable. Consumer mail hosts stay as they are; they identify nobody.
- Unmasked by design: message wording, formatting, tables, order, timestamps, timezone/recovery labels, quoted variants and participation notes. The masked copy must still reproduce the problem it was exported for, so dates and quantities are protected from the phone-number heuristic.
- No image bytes are ever written: a picture can show a face, a signature or a letterhead. Every image becomes a positioned neutral placeholder, attachment URLs are cleared, and `sourceTabId` is dropped so the copy can fetch nothing from the mail tab. The placeholder map lives only in the `IdentityMasker` instance and is never serialized into the file.
- `conversationHtml(thread, exportedAt, { masked: true })` adds a visible banner; `downloadConversation(thread, { mask: true })` masks, forces the no-image path and saves `ThreadLens-<subject>-<date>-masked.html` from the masked subject.
- `tests/masked-export.ts` adds 11 checks: no real name/address/domain/phone/token/id survives, one person maps to one placeholder across headers and bodies, structure/dates/labels are preserved, ids are renumbered with their references intact, images and attachment URLs are absent, body-only addresses are masked, capitalised short forms are masked while lowercase words are not, dates and quantities are not treated as phone numbers, a company written run-together as one word is still masked, and the download is named as a masked copy. The Chromium smoke exports a masked copy and asserts no synthetic identity survives it.

Limits: masking is a strong default, not a guarantee. A nickname sharing no opening letters with the real name, an identity visible only inside a picture, and a company named in prose but never in an address or domain can survive. The file should be read before it is sent anywhere.

## 1.6.1 deep nesting and provider-trimmed duplicates

Diagnosed from the user's identity-masked export of a fourteen-entry enterprise thread (`manual_test/`, read locally; nothing from it was copied into fixtures). Two reported symptoms turned out to have four distinct causes, each fixed where it arises.

### 1. A column of vertical rules before deeply nested messages

**Cause.** `slice()` in `quoted-chain-parser.ts` restores the ancestors `Range.cloneContents()` drops, so a single-cell table or a bold span survives extraction. Outlook indents each reply in a plain `<blockquote style="padding-left:6pt">` with no `gmail_quote` class, and only `.gmail_quote` was excluded from that restoration. An eight-reply thread therefore rebuilt eight quote wrappers around the oldest message, and both the panel and the export draw a left rule on every `blockquote` — the stack of empty vertical lines in the screenshot. The mail's own blockquotes carried only padding; the rules came from ThreadLens's stylesheets.

**Method.** Exclude every `blockquote`/`.gmail_quote` ancestor from restoration, not just Gmail's. A wrapper enclosing the *whole* extracted segment is the indent the quoting client added; an author's own quotation sits inside their message and is cloned with the range, so it is untouched. `sanitizeEmailHtml` additionally drops, innermost-first, any `blockquote` holding no text and no picture — the shell a split leaves behind when a segment ends at a nested quote.

### 2. One email appearing twice, once with attachments

Four separate rules were keeping copies of one message apart. All four were relaxed with evidence, not loosened generally.

- **Unequal picture counts.** `imagesConflict` treated a different number of inline pictures as different pictures, and a quoted copy routinely keeps fewer signature logos than the original (7 against 3 in this thread). It now conflicts only when the copies actually disagree about a picture: the shorter list must be the longer one with some pictures missing, where `'?'` (a per-copy blob or proxy handle that names no picture) matches anything. Genuinely different pictures still keep copies apart.
- **A sign-off it did not recognise.** `core()` trims the signature before matching, but its pattern knew `Regards`, `Kind regards`, `Many thanks` and `Thanks` — not `Thanks & Regards`, the house style in this thread. The whole contact block was therefore part of the compared text, so copies that kept different amounts of it never matched. The pattern now covers `many/kind/kindest/best/warm/warmest/with` and `thanks &|and` before `regards|thanks|wishes|thank you`.
- **Gmail's own truncation.** Gmail clips a long quoted body and writes `[Message clipped] View entire message` into the message. That notice and its trailing ellipsis are no longer compared as the author's words, and a copy carrying the notice may match a longer copy that *starts with* it — the provider is stating the copy is the beginning of that message. Only the provider's notice licenses this: a body that merely stops earlier still does not match. When such copies merge, the complete wording is displayed and the clipped copy is kept as an inspectable variant.
- **A short email quoted from another timezone.** A word-for-word copy whose gap from its counterpart is offset-shaped previously needed 160 characters, or an offset already proven by another pair in the thread. The reported email — *"I've checked and currently there are no in-progress warehouse transfers"*, 85 characters, quoted 4.5 hours away by a UK client and read in IST — met neither, so it showed twice: once from the mailbox with its two attachments, once from the quote without them. A copy quoted against an email the mailbox itself holds (`source !== 'quoted'` with a provider header) and specific enough to be one message (40 characters) is now accepted. The reasoning: a second email repeating those words exactly would be in this same mailbox, and when it is, the existing ambiguity rule keeps both. Copies with no provider-dated counterpart, and brief acknowledgements below 40 characters, are unchanged.

Attachments were never compared, so the attachment asymmetry was a symptom rather than a cause; `combine` already unions attachments, and the surviving entry keeps `image005.png` and `image006.png` with the provider's own timestamp.

**Verification.** The masked export was replayed through reconciliation locally: the fourteen entries reduce to twelve, the two reported pairs collapse, the note keeps both attachments and its provider clock, and no other message merged. Twelve synthetic regressions cover the same shapes in `tests/regressions.ts` — eight-deep Outlook nesting, an author's own quotation, empty quote shells, dropped signature logos, a genuinely different picture, attachments across a zone-shifted merge, `Thanks & Regards`, a clipped copy and its boundaries, and a brief acknowledgement that must stay separate. The suite is 173 tests. `scripts/smoke-extension.mjs` was not extended for these cases and its 1.6.0 masked-export step remains unrun here: Playwright is not installed on this machine.

Limits unchanged: where two copies address the same picture differently *and* identify it (distinct `cid:` values in both), an unequal count still reads as different pictures. A clipped copy that Gmail truncated mid-word does not prefix-match. Identical short emails genuinely sent twice, where only one is in the mailbox, can now merge.

## 1.6.2 provider chrome, unread header blocks and reply order

Diagnosed from the user's second identity-masked export of the same thread (25 entries after expanding collapsed emails; read locally, nothing copied into fixtures). Three reported symptoms — messages still duplicated, two emails shown as one, and an answer placed before its question — came from five causes.

### 1. Copies of one email still shown twice

Each cause was found by replaying the real export through reconciliation and reading what actually differed between the copies.

- **Pictures decided it.** The same seven-picture signature reached the thread three ways: seven proxied URLs, seven `Image removed by sender` placeholders, and six of those URLs plus one re-rendered copy. Any difference in count or address counted as different pictures, which kept three copies of one email apart. Pictures are now weak evidence: they cannot outvote a run of word-for-word identical text of at least 40 characters, but they still separate copies whose wording only resembles each other, and whichever copy differs is kept as an inspectable variant.
- **Clock skew on top of the offset.** A quoted `Sent:` line is the sending client's own clock and a provider header is the server's, so copies sat 4 h 34 m apart — a 4½-hour timezone offset plus four minutes of skew. Offset-shaped gaps now tolerate up to five minutes of skew (real offsets are quarter-hour multiples, so minutes never turn one offset into another), and word-for-word copies whose clocks differ only by minutes are matched as the same time.
- **A tenant banner on one copy only.** The external-sender warning (`ⓘ External email ❯`, laid out one word to a line) is stamped on the copy that arrived from outside but not on the copy its author quoted. That banner, `[EXTERNAL]` tags, caution/originated-outside notices and `[Image unavailable: …]` captions are now ignored when comparing bodies. They are still shown; only the comparison ignores them.

### 2. Two emails shown as one, and header lines stranded on top of a message

- **Wrapped recipient lists.** Outlook wraps a long To/Cc list at any column, including between a display name and its own address. The scanner stopped at the first line it could not read, so the rest of the list and the `Subject:` line were left at the top of the message body — and a body polluted that way never matches its clean copy either. A continuation line is now accepted when its remainder is a display name (capitalised words, not prose), and the list is known to continue when a line ends with a separator *or* with a name whose address wrapped.
- **Stray lines inside a header block.** One unreadable line — a hidden element the provider left behind, an inline banner — rejected the whole block, so the quoted email stayed inside its parent and two emails appeared as one. Up to two short stray lines are now skipped while the fields plainly continue beneath them, and never when the next field belongs to the following email.
- **A second pass.** Whatever the provider shape, a recovered body that still holds a complete `From:`/`Sent:` block is read again — the second pass sees the rebuilt, sanitised markup rather than the provider's. On the real export this recovered four emails that had been hidden inside other messages, including one that appeared nowhere else in the thread.
- **Stranded remnants are skipped.** A body that begins with recipient-list or `Subject:` lines now starts past them, so an old cache or an unknown header shape cannot leave header text at the top of a message.

### 3. An answer placed before its question

The quote chain already ordered messages, and the fix was upstream: the question existed twice (a provider-dated copy and a zoneless quoted copy 4 h 34 m away) and the two did not merge, so only the quoted copy carried the "was answered by" link while the real one floated free of it. Once skew-tolerant matching merged them, the chain edge bound the surviving message and the answer moved after the question it quoted, both marked *Placed by the quoted reply chain*. A regression now asserts this end to end: an answer whose own clock reads earlier than the question it quotes is still shown after it.

### 4. Forwarding is announced rather than shown as an empty message

An email that adds no words of its own is an event, not a message. `src/offscreen/parser.ts` now writes `<name> passed this conversation on to <recipients> without adding a message.` (a long list becomes "a, b and 2 others"), and `MessageBubble` renders a carrier as one centred line instead of an empty bubble. The event is kept because the participation marker depends on it.

**Verification.** Replaying the real export end to end — re-parsing every body, then reconciling — goes from 25 entries with duplicates and two merged-together emails to 23 distinct messages, four of them recovered by the second pass, with the reply chain ordering the pair whose clocks disagree. Fourteen synthetic regressions cover the shapes: wrapped recipient lists, stranded remnants, stray lines in a header block, skew plus offset, tenant banners, answer-before-question, picture evidence at both strengths, and the carrier notice. The suite is 185 tests. The Chromium smoke was updated for the carrier wording but, as in 1.6.0 and 1.6.1, could not be run here — Playwright is not installed on this machine.

Limits: the exact provider shape that defeated the first pass in the live DOM is unknown — the second pass is a safety net that catches it whatever it was, verified against the real export. Two identical short emails genuinely sent minutes apart can now merge. A banner phrased unlike any of the known forms is still compared as if the author wrote it.


## 1.6.3 stable expansion and meaningful quoted variants (11 September 2026)

The supplied masked exports contained 19 entries before opening an email and 21 afterwards. The two extra entries repeated the earliest two emails, with the same author/date/prose but different generated image captions. Another message carried two quoted variants containing the same words: a removed-image copy and a provider-clipped copy with nested quote wrappers. No unsplit From/Sent or On/wrote header remained in the exported main message bodies.

**Changes.** `message-reconciliation.ts` now ignores generated `[Image: …]` captions when comparing authored prose, alongside existing unavailable-image/provider noise. Image-only messages retain their existing caption evidence and image guards. The author, timestamp, direct-ID, near-copy and ambiguity rules remain in place. Image identity uses the complete data payload rather than its first 128 characters, so different embedded pictures sharing an encoded prefix remain distinguishable.

Quoted variants use a separately cached presentation comparison that retains signature/contact words while ignoring image captions and provider clipping. A clipped copy is redundant only when its remaining words prefix the complete copy, with the existing minimum evidence threshold. An actual wording/title change or conflicting identifiable image stays inspectable. Fuller equivalent text and pictures can supply the displayed body without replacing the provider ID, sender, timestamp or recipients. If the clipped copy is the only place an extra picture survives, it remains available as a variant. Cached formatting-only variants are cleaned even when no second copy arrives in that batch; an empty result explicitly clears the old variants array.

The quoted-chain parser and incremental reader were not changed. Removing the redundant clipped variant removes the reported stack of quote lines; authored blockquotes are preserved. The new comparisons use WeakMap caches and operate in the existing offscreen reconciliation path, with no new mail-page DOM scans.

**Verification.** All 200 tests pass, including 15 new cases in `tests/expansion-stability.ts`. The new cases first reproduced the failure on 1.6.2 (10 of the initial 12 failed). Coverage includes mixed forwarded/Gmail chains across five people, several successive recipient additions, expansion and repeated rescans in three orders, all originals arriving together, altered image labels, clipped signatures in both orders, retained images, stale variant cleanup, and protections for real edits and authored quotations. Two older expectations were intentionally updated: dropped logos and provider-clipped text are no longer treated as edited copies when the complete content survives.

Local export replay produces 19 → 19 and 21 → 19 messages, both without remaining quoted variants; numeric evidence is in `artifacts/expansion-replay.json`. Masked placeholders were reconstructed as img elements using surviving alt labels and unknown per-copy blob identities. This checks the exported structure and text; masked exports cannot verify the original picture bytes, URLs, provider IDs or exact live DOM. Customer content was not copied into the repository.

The actual built extension passed `scripts/smoke-extension.mjs` in temporary Chromium with synthetic email pages: incremental extraction, tables, real edited variants, joining/forwarding notices, masked/full exports, local attachment persistence, HTTPS/blob images, full-size viewing, offline embedded images, navigation clearing and no cross-world preload warnings. The new expansion scenario opens four older emails, retains five messages with images and no false variants, and asserts one new snapshot per expansion. `artifacts/stable-expansion.png` shows this build. The older smoke fixture used a yearless provider date while asserting an exact instant; it now supplies the explicit date that assertion requires. Yearless behavior remains separately tested.

**Performance.** A sequential Chromium comparison against clean main 1.6.2 uses the same 40-message, 1,043,271-byte synthetic fixture. Both versions take 40 snapshots in 10 batches, one scan, no automatic expansion and zero extra snapshots on five unrelated toolbar/scroll changes. Total snapshot work was 43.2 ms versus 44.5 ms; maximum individual snapshot 2.7 ms versus 3.0 ms. Scroll-burst page scripting was 0.958 ms versus 1.069 ms. These small single-run timing differences are not evidence of a speed improvement or a meaningful regression. The important work counts remain unchanged; this benchmark measures mail-page work, not all offscreen CPU or live-tenant performance. See `artifacts/performance-expansion.json`. The benchmark now reads actual manifest versions and accepts `BENCHMARK_OUTPUT` to preserve earlier evidence.

**Delivery.** Package version is 1.6.3. `npm run release` passed typecheck, the full suite, build, manifest resource checks and ZIP integrity checks. It produces ignored local `releases/threadlens-1.6.3.zip` and the extracted `releases/threadlens-1.6.3/`. Reload the extension from the updated dist directory, or load the extracted release directory, then refresh Gmail and reopen ThreadLens. Existing downloaded exports do not update automatically.

**Limits.** Opening mail may legitimately reveal previously unavailable history or refine a provider timestamp; the timeline is not frozen. Omitted history remains unrecoverable. Unknown blob/proxy identities cannot prove whether the actual image pixels differ. Arbitrary enterprise header formats still require a new fixture when encountered; synthetic coverage is not a guarantee for every tenant.


## 1.7.0 thread-source capture (11 September 2026)

Every diagnosis since 1.6.0 has been made from a masked *conversation* export — what ThreadLens produced. The remaining reports are about what it *read*: an email split in the wrong place, one email shown twice only after an older one is opened, a message that appears nowhere. By the time a conversation is exported the provider's markup is gone, and 1.6.3 recorded the consequence plainly — a masked export "cannot verify the original picture bytes, URLs, provider IDs or exact live DOM". This release captures that markup instead.

**What is captured.** `CAPTURE_THREAD_SOURCE` reaches the reader in the mail page, which already holds the answer: for every message it has sent to the parser it keeps that exact snapshot, so a capture is the parser's own input rather than a second reading of the same page. Alongside each snapshot goes the whole provider container — header row, date cell, recipient chips, attachment chips — which is where a problem lives when the parsed body looks correct. A collapsed row that renders no body is recorded as headers only and says so; so is a container shortened at 512 KB, and a capture over 16 MB stops adding container markup rather than growing without limit. Nothing runs unless the button is pressed: the reading path is untouched.

**Picture bytes are folded, not carried.** Reconciliation identifies a `data:` picture by its complete payload, so each payload folds to one short digest: identical payloads stay identical, different payloads stay different, and megabytes of base64 never reach the file. Every other kind of address is left exactly as the page wrote it.

**Masking keeps the identity classes a parser reads.** `IdentityMasker.imageSource` replaces a picture with a placeholder *of its own kind* — a blob stays a blob, a bare proxy token stays one, a proxy address ending in the original URL keeps that ending (masked, and the same for two tokens naming one picture), a payload stays a distinct payload, a `cid:` stays a `cid:`, and the query around one address is dropped as `imageKeys` drops it. Flattening all of these into one `https://images.example/image-N.png`, as 1.6.0 did, would merge or separate copies that the original keeps apart. The conversation export gains the same faithfulness.

Two masking defects surfaced while proving this and are fixed at the root:

- **A name masked only after its address was seen.** Masking a text node can replace only the names already learned, so a display name written above the address it belongs to — the name in a quoted attribution, a signature over a `mailto:` link — survived in the copy masked first and was replaced in the next one. That is both a leak and a difference between two copies of one email, which reconciliation then reads as two messages. `seedHtml` now learns every address, `mailto:` target and name-beside-address pair in the whole capture before a single word is rewritten, and `html()` seeds the same way.
- **A correspondent whose name is a calendar word rewrote the dates.** A person called May, or a company called Marchetti, would have had `May 3` and `Mar 3` replaced throughout, silently changing the timestamps a thread is reconciled by. Calendar words are no longer learned as identities.

`providerHtml` masks the provider's own markup: it treats every attribute as identifying unless it is structural, because a mail client writes addresses and display names into attributes no allowlist could predict. Element classes, layout, ids, `datetime` and spelled-out dates keep their shape, so a scraper still reads the masked container the way it read the real one.

**The masked copy is checked, not assumed.** Masking shortens names, and reconciliation weighs how much text two copies share, so a masked body sitting near one of its length thresholds could cross it. Before either file is saved, both copies are parsed through the real parser and cache and reduced to an identity-independent shape — per message: sender ordinal, clock, source, flags, line count, quote link, variants, recipients, attachments and the grouping of its pictures. The comparison is written into the file and shown in the panel, naming the message and the field where two copies disagree. Both are also read twice, whole and in batches of four the way the mailbox delivers them, because a difference between those is a parsing problem in itself.

**Reading a capture back.** `npm run replay -- <file.json>` parses a capture outside the browser and prints what came of it: containers captured, messages produced, whether whole and batched reads agree, the file's own fidelity verdict, and one line per message. `scripts/node22.mjs` now holds the nvm re-run that `npm run release` already used.

**Verification.** 223 tests pass, 23 of them new in `tests/thread-source-capture.ts`. The new suite drives the real Gmail content script through a stubbed Chrome into the real offscreen parser, over the conversation that keeps being reported: two people, a third added, a fourth added, the reader added last, most of the thread reaching the mailbox only as quoted history, with a proxied signature, a payload logo, per-copy blobs, a `cid:` picture, a tenant banner, a Gmail clipping notice, an attachment chip and a collapsed row. It asserts that a capture replays to *exactly* the thread the extension itself produced; that opening the collapsed older email adds no duplicate and the capture still matches the panel; that the masked copy parses to the same thread as the original before and after that expansion; that no name, address, domain, phone number, provider id or picture payload survives masking; that the masked containers can be planted back into a page and read as the same conversation; and that a masked copy which *would* change the thread is reported rather than passed. `artifacts/thread-source-capture.json` is the synthetic example the replay command reads.

The Chromium smoke gains a capture step — open the disclosure, save the masked source, assert it is masked, complete, faithful and identity-free, and that the panel says so. As in 1.6.0 through 1.6.3 it could not be run here: Playwright is not installed on this machine.

**Limits.** A capture holds what the page held: history a sender never included is still unrecoverable, and a collapsed email is not readable until it is opened. Picture bytes are folded away by design, so a capture cannot prove two pictures with different payload digests looked different on screen. Masking is still a strong default rather than a guarantee — the fidelity check proves the copy parses alike, not that no identity survives in prose — and the file should be read before it is sent. A capture is a diagnostic artifact, not an archive: the conversation export remains the way to keep a thread.

## 1.7.1 one person, one identity (14 September 2026)

Diagnosed from the user's first 1.7.0 thread-source capture (`manual_test/`, read locally; nothing from it was copied into fixtures). The report: the same colleague appears in the panel as two participants, in two colours, and the masked export lists nine people in a conversation between about five. Replaying the capture reproduced it exactly — `npm run replay` showed seven participants, among them `Person 1 <person1@company1.example>` with five messages *and* `Person 1 <unknown:person 1>` with three.

**Cause.** A quoted attribution names its author but rarely records an address — "On 13 Aug 2026, Sarah Jones wrote:" — so `quoted-chain-parser` invents `unknown:sarah jones`. Reconciliation already understood this for *matching* (`sameAuthor` accepts a name against an address), but nothing merged these messages, because they are different emails by one person rather than copies of one email. Everything downstream keys on `sender.email`: the participant map, the sidebar chips, the participant filter, consecutive-message grouping and `hashColor`. One person therefore became two participants with two avatar colours.

**Fix.** `resolveNamedSenders` runs at the end of `mergeMessages` and gives a name-only sender the address the thread itself shows for that name, on evidence in this order: an address that person has written from (their display name, or the local part written as a name — the evidence `sameAuthor` already trusts); an address the thread's own To/Cc lines carry for it; or, for a lone first name, the one person whose name or address opens with it. A key that fits two different addresses resolves to nobody, a full name never matches a different person who shares only part of it ("Sarah Jones" is not "Sarah Connor"), and a name too short or too generic to identify anybody — `DJ`, `Unknown` — keeps the identity the parser gave it. Only the identity is resolved: which messages are copies of one another is decided exactly as before, and the resolved sender also inherits whether that person is the reader, so their own quoted emails are drawn as theirs.

**Two masking defects found alongside it, both visible in the same report.**

- **Masking invented an address for an author who had none.** `unknown:sarah jones` has no host, so `person()` produced `person3@company.example` — indistinguishable from a real address. That hid the whole defect from every masked export, and it changed how the masked copy reconciles, because `sameAuthor`'s name-only branch tests for exactly that missing address. A masked identity with no address now keeps the `unknown:` shape.
- **The same person took two placeholder names.** Their addressed identity became `Person 1` and their name-only identity `Person 3`, so no name-based resolution could ever join them in a masked copy: the copy grouped differently from the thread it came from. A name-only identity now takes the placeholder name already learned for that person, and header identities are seeded addressed-first so the addressed one is always known first. The word "unknown" is also no longer learned as somebody's name.

`conversationHtml` now says "(address not recorded in the quoted history)" instead of printing `unknown:dj` as though it were an address.

**Verification.** 240 tests pass, 17 of them new in `tests/participant-identity.ts`: resolution from a sent address in either order, from a provider that recorded no display name, from a To line, and from a lone first name; the reader recognised under both identities; two people sharing a name, a first name shared by two people, a full name against a different partial match, and a nickname too short to identify anybody all left alone; identity resolved without merging two distinct messages; stability when the thread is reconciled again; the participant list and message count through the cache; and the masked copy keeping the unaddressed shape, one placeholder name per person, and grouping exactly as the real thread groups. Replaying the reported capture now yields five participants rather than seven, with the remaining two — a person the thread never addresses by an address, and a two-letter nickname — correctly left as themselves.

**Limits.** A nickname unrelated to a name ("DJ" for Dhruv Joshi), an author quoted under a name the thread never pairs with an address, and two colleagues who genuinely share a name still read as separate participants. That is deliberate: linking two people who are not the same person is a worse error than showing one person twice, and no evidence in a thread distinguishes those cases.

## 1.7.2 a shorter panel, collapsing back, and both ends of a thread (14 September 2026)

Three changes asked for after using 1.7.1 on real mail.

**The picture-embedding download is removed.** `Download conversation (.html)` is gone from the panel; `Text only (no images)` and `Masked copy (share-safe)` remain, so no export writes picture bytes or provider URLs any more. `downloadConversation`'s `includeImages` option and `media/images.embedImages` are kept and still tested, so the button can be restored in one line if it is ever wanted; nothing else calls them.

**Expanding gained its opposite.** `tryCollapseAll` in `gmail-scraper.ts` clicks Gmail's own *Collapse all* when the mailbox offers one and otherwise clicks the header row of each *expanded* message — never a collapsed one, which would open it. `COLLAPSE_THREAD` reaches it through the reader, which deliberately does not rediscover or re-read afterwards: collapsing reveals nothing new, and every email already recovered is held by the extension rather than by the page, so the panel keeps its whole timeline while the mailbox goes back to how it was found.

**Both ends of a thread are one tap away.** `ChatThread` draws two round buttons over the bottom right of the conversation, as a messaging app does: ↑ jumps to the first message, ↓ to the latest, and each appears only when there is somewhere to go (more than 40px of travel). The scroll container is handed to the panel's existing ref *and* to the component's own through one callback ref, so the keyboard shortcuts — `Home`, `End`, `J`, `K` — keep working exactly as before and the buttons do the same thing with the mouse.

**Verification.** 243 tests pass, three of them new: collapsing clicks only the expanded emails, prefers Gmail's own control when present, and reaches the adapter through `COLLAPSE_THREAD` without re-reading the page. The Chromium smoke now takes the conversation export from the text-only button, asserts an export carries no `<img>` and no payload while keeping both picture placeholders and their captions, drives both jump buttons to each end of the thread, and collapses the fixture through the panel — the fixture's header rows behave as Gmail's do — then asserts the panel still shows all four messages including the oldest recovered one. As in every release since 1.6.0 the smoke could not be run here: Playwright is not installed on this machine.

**Limits.** Collapsing depends on Gmail's header rows and its *Collapse all* control, and is offered for Gmail only; Outlook's reading pane has no equivalent adapter action. An export can no longer be read offline with its pictures in place — that was the removed button's purpose.


## 1.7.3 separate developer and production packages (20 September 2026)

Work continues on `fix/release-1.7.3`, starting from the branch's 1.7.2 changes at `dc80ca7`. The previous sender, parser, expansion/collapse and navigation fixes are retained. The requested change is to make all extension-provided file download options available only in a development package.

**Build contract.** `vite.config.ts` defines `__DEV_TOOLS__` only for explicit `--mode development`. This is a build-time boolean, independent of `import.meta.env.DEV` (optimized Vite builds do not use that flag to identify a development testing package). Production is the default. `dist-dev/` contains **ThreadLens Dev**, visibly labeled in the manifest and panel; `dist/` contains **ThreadLens**. Both use package.json version 1.7.3. The output directories are separate and ignored, so building one does not overwrite the other.

**Controls.** `DevDownloads` owns the existing text-only/masked conversation exports and masked/original source captures. `DevAttachmentControls` owns provider file links, local saving, manual import, saved-file download and local-copy removal. Neither component is mounted in production and its implementation/imports are removed from the production bundle. Production still displays attachment names and sizes; it does not open the attachment IndexedDB database. File retrieval remains available through the original mail application. Inline image loading/full-size viewing, tables, searching, participant filtering, participation markers and Gmail read/collapse controls work in both builds. The image-embedding export button removed in 1.7.2 has not been restored.

`App` keeps errors for Gmail commands independently of development export state. The reader's `CAPTURE_THREAD_SOURCE` handler and returned capture function are also compiled out of production. Snapshot reading, parser/reconciliation and normal image requests are unchanged. The test configuration enables developer tools for the existing capture unit tests; the real compiled production package is independently checked in Chromium.

**Commands.** `npm run package:dev` / `npm run release:dev` run typecheck, tests, the optimized development build, then package it. `package:prod` / `release:prod` run the same gates for production. Plain `package`, `release` and `build` default to production. `build:dev` creates dist-dev, `build:prod` creates dist, and `dev` watches and rebuilds dist-dev. Release flags are validated and survive the existing Node 22 fallback. Python 3 is required for packaging.

The packager verifies version and flavor, manifest resource paths, absence of modulepreloads, and actual emitted JavaScript: every developer control and capture-request marker must exist in dev and be absent from prod. It writes `releases/threadlens-1.7.3-dev.zip` and `releases/threadlens-1.7.3-prod.zip`, plus matching extracted folders and SHA256SUMS. Each INSTALL.txt describes its flavor and loading directory. A user switching flavors must select the matching folder with Load unpacked; Reload only updates the directory the existing entry already uses. Enable one build at a time on the same mailbox.

**Verification.** Both package commands passed typecheck, 243 active tests, build, flavor checks and ZIP validation. The existing optional capture-file test is skipped without THREADLENS_CAPTURE. `scripts/smoke-packages.mjs` loads the actual extracted releases in separate temporary Chromium profiles and uses synthetic mail. Production has no export/download/file-input/provider-file controls, no attachment database, and no responding capture endpoint. Dev successfully downloads text/masked HTML and both source captures (with matching fidelity), saves an attachment, reloads to verify persistence, downloads it and removes it. Both builds retain a recovered two-message conversation, table, searchable cells, full-size inline image, participation marker, and functioning Gmail collapse control. Both have zero page errors. Local screenshots and verification JSON are under ignored `artifacts/packages-1.7.3/`.

Production's emitted panel JavaScript is about 162 KB versus 194 KB in dev, and its reader about 5 KB versus 7 KB. These are bundle sizes, not a new performance benchmark; no additional mailbox scanning was added. Dev exports remain testing tools, and ordinary browser features or links authored inside email content are not disabled by this change.

The broader `scripts/smoke-extension.mjs` also passed against dist-dev: reconstruction/deduplication, both conversation exports, capture fidelity, attachment import/save/reload/download/removal, HTTPS/blob images, named image placeholders in exports, collapse/jump controls, incremental updates, stable five-person expansion and navigation clearing. There were no page errors or cross-world preload warnings. The smoke now explicitly targets a Dev build and makes its jump fixture overflow before asserting the conditional jump buttons. Older generated smoke artifacts were retained as their previous committed evidence; this run’s full outputs are available locally under `/private/tmp/threadlens-smoke-1.7.3-results/`.


## 1.7.4 restore production attachment access (20 September 2026)

Correction to the 1.7.3 scope: the user's dev-only requirement applies to entire-conversation exports and diagnostic thread-source captures, **not attachments**. Started from merged main `720a372`, retaining the user's subsequent removal of manual capture files.

`AttachmentChip` now always mounts the shared `AttachmentControls` component (renamed from `DevAttachmentControls`). Both builds offer Open in email, Save locally, Choose downloaded file, Download saved file and Remove local copy. The original storage, download and provider-authentication fallback behavior is retained. `DevDownloads` and `CAPTURE_THREAD_SOURCE` remain gated by the explicit developer build flag; no conversation exports have been restored to production.

The packager now independently checks the two feature groups: conversation/diagnostic controls only in dev, attachment controls required in both. The package smoke test runs attachment provider-link, save, persistence across reload, download, removal, manual import and re-download checks on both actual extracted packages. It also verifies production still has no conversation export controls (including after reload) and no capture endpoint. README, test coverage, release messages and INSTALL instructions now describe that distinction.

Version is 1.7.4 so the correction is distinguishable from the previously installed 1.7.3 release. Commands remain `npm run package:prod` and `npm run package:dev`; plain `package` and `release` still default to production. Outputs are `releases/threadlens-1.7.4-prod/` and `releases/threadlens-1.7.4-dev/`, with matching ZIPs. The earlier 1.7.3 entry above records the original implementation and is superseded by this scope correction.

**Verification completed:** both package pipelines passed typecheck, 243 active unit/regression tests (one optional capture-file test skipped), builds and flavor checks. Chromium package smoke passed for both extracted releases, including attachment save/reload/download/remove/manual-import/re-download, and production absence of whole-conversation exports and the capture endpoint. Both had zero page errors. Local evidence is in ignored `artifacts/packages-1.7.4/`.
