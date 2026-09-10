# ThreadLens project context

Updated 2026-09-10. Current source version: **1.5.0**.

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
- Rich-text search highlights text nodes without destroying tables. Conversation subjects, recovery labels and full dates are visible.

## Source map

- `src/content/quoted-chain-parser.ts`: text projection, header recognition, HTML range extraction, date parsing, direct/quoted reconciliation. `extractEmailBody` returns `{ body, bodyHtml, history }`; `parseQuotedChain` remains compatible with original tests.
- `src/content/gmail-scraper.ts`: message container extraction, expanding Gmail, attachments, navigation and mutation observation.
- `src/content/outlook-scraper.ts`: reading-pane/selected-conversation selectors, shared parser and visible attachment anchors. More tenant-specific live verification is needed.
- `src/content/scraper-utils.ts`: text projection helpers and HTML/style/link allowlists. Active content, tracking image loads, arbitrary CSS and unsafe protocols are removed. Safe inline images retain their source and placement; unavailable images have explicit captions.
- `src/content/message-reconciliation.ts`: conservative exact/near quote matching, variant preservation, metadata merging and evidence-based participation boundaries.
- `src/content/message-metadata.ts`: recipient extraction scoped to provider header elements, excluding the message body.
- `src/content/thread-cache.ts`: reconciles progressively available messages and recomputes participants.
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

`package.json` drives the generated manifest/UI version. Load `dist/` as an unpacked Chrome extension. A ZIP of its contents is provided in `releases/`.

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
