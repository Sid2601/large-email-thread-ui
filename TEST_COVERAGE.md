# Enterprise conversation test coverage

Release 1.7.3. **243 passing automated tests**, one optional capture-file test skipped without an input file, plus Chromium checks for both packages and the development extension. All committed cases are synthetic; the user's exported conversation was examined and replayed locally only.

| Area | Cases covered |
|---|---|
| Build flavors | Production omits all export, diagnostic and attachment download/save/import controls and the capture endpoint; no attachment database is opened. Dev retains text/masked exports, both source captures and attachment persistence/download/removal. Both packaged builds retain images, tables, search, participation and Gmail controls. Packager checks emitted code and distinct names/paths. |
| Standard replies | Gmail nested attribution, Outlook From/Sent/To/Subject, plain On/wrote text, Apple/mobile comma attribution, wrapped attribution, single messages, ordinary blockquotes, short replies |
| Joining midway | 40 messages recovered from one nested chain; 40 unique messages recovered from the last five direct emails; earlier quoted history retained after direct expansion |
| Forwarding | Forward with an introduction, pure forward, nested Outlook inside forward, mixed Gmail/Outlook, independent sibling forwards, new recipient later replying in the same conversation |
| Expansion stability | Fifteen regressions: changed image captions, removed-image labels, full versus clipped signatures in both orders, richer image retention, clearing old formatting variants, image-only and direct-ID safeguards, changed wording/title/image evidence, full data payload comparison, authored blockquotes, and five-person mixed forwarding/join chains opened and rescanned in three orders |
| Duplicates | Original plus quoted copy, repeated quote across forwards, whitespace/NBSP/quote-prefix differences, signature/title changes, full bodies beyond 300 characters, progressive cache rescans |
| Timezones in quotes | Zoneless attribution clocks marked and reconciled against the provider header; offset confirmed by a long copy also resolving shorter identical ones; copies quoted by clients in two different timezones; non-offset gaps, gaps beyond any inhabited offset, changed figures and two real emails an offset apart all kept separate; stable across repeated merges and rescans |
| Edited quotes | Small contextual insertion retained as an expandable variant; full copy retained so changed wording and signatures remain inspectable |
| Protecting distinct messages | Different direct IDs; different authors; repeated approvals at different times; unknown-time short replies; changed numbers, negations, substitutions; unknown senders; ambiguous matches |
| Sender ownership | Nested message/signature scopes; text after a quote kept with enclosing sender; plain prose not split at From/To without a date header |
| Date handling | Explicit offsets, real historical years, missing-year September instead of JavaScript's 2001 default, December/January rollover, malformed/time-only dates, approximate labels, quoted clocks with no recorded timezone |
| Participation evidence | Explicit first recipient inclusion, earlier authorship, already included from the start, wrapped To recipients, no join assertion without recipient evidence, addresses in bodies excluded, body prose after recipient headers retained |
| Formatting and safety | Tables and cell spans, nested emphasis, rich search, ordinary quoted passages, active-content removal, unsafe links/styles, metadata escaping and export CSP |
| Attachments | Late-arriving metadata preserved through reconciliation, host checks, per-file limit, direct saving, manual import, IndexedDB persistence, saved download/removal |
| Full exports | All messages despite filters, chronological order, metadata, formatted tables, attachment names without expiring URLs, approximate labels, duplicate cleanup, quoted variants, participation note |
| Thread order | Unreadable clocks kept in mailbox position and interpolated between readable neighbours, leading/trailing gaps, equal and unparsable clocks, collapsed-row dates read from header attributes, mailbox position reported over snapshot order |
| Reply order across timezones | Quote nesting placing correspondents whose zoneless clocks read out of order, the contradicting pair marked in the panel and the export, the carrier kept after everything it quotes, chains of two separate emails joined through a shared message, sibling forwards left to their clocks, order stable across repeated merges and cache rescans |
| Duplicate copies | Twenty-email thread with unanswered follow-ups reduced to one entry per message, identical follow-ups assigned to the right message, name-only attributions matched, placeholder names kept apart, re-addressed inline pictures merged, differing pictures kept apart, offset confirmed by two agreeing copies |
| No-images exports | Every image replaced by a filename, source URLs and image bytes absent, source-derived and generated names, alt text kept, image-free threads unchanged, filename suffix |
| Inline images | Image-only, leading/trailing, between paragraphs, table-cell and quoted images; author ownership; live source overrides; blob references; unsafe/cid rejection; removed-image captions; differing images kept separate; export embedding/failure notices; raster/size checks |
| Browser image flow | HTTPS and source-tab blob images render at full natural dimensions; full-size dialog; offline HTML embeds both sources; updates/replaced body nodes retain pictures |
| Collapsing the mailbox | Only expanded emails clicked, Gmail's own Collapse all control preferred, the request reaching the adapter without re-reading the page or losing recovered messages |
| Adapter stability | Gmail identity/date stable across edits; Outlook fallback IDs stable; nested Outlook wrappers produce one message |
| Performance | Synthetic 40-message ~1 MB benchmark; no automatic expand-all; unrelated toolbar/scroll mutations cause zero additional snapshots; a body edit snapshots only its owning message |
| Deep quote nesting | Eight-level Outlook indentation recovered without rebuilt quote wrappers, an author's own quotation kept, empty quote shells dropped innermost-first |
| Provider-trimmed copies | Unequal signature logos merged and a differing picture kept apart; `Thanks & Regards` treated as the end of the authored text; a Gmail-clipped copy merged into the complete wording with the clipped copy kept as a variant, a body that merely stops earlier not merged, a clipped copy not matched to a different message; a specific sentence quoted against a provider-dated email merged with its attachments, a brief acknowledgement and an unanchored pair kept apart |
| Unread header blocks | Recipient lists wrapped between a name and its address; stranded recipient/Subject remnants skipped at the top of a body; a stray line inside a block skipped while its fields continue, but never across into the next email; a second pass splitting a body that still holds a complete header block |
| Provider chrome | Tenant external-sender banners laid out one word to a line, `[EXTERNAL]` tags and unavailable-picture captions ignored when matching and kept when shown |
| Clock skew | A quarter-hour offset plus minutes of client/server skew matched; word-for-word copies minutes apart treated as one message |
| Reply order | An answer whose zoneless clock reads earlier than the question it quotes is shown after it, both marked as chain-placed |
| Forwarding | A carrier naming who passed the thread on and to whom, a long recipient list abbreviated, no recipients readable, and an email that did add words kept as an ordinary message |
| Masked exports | One placeholder per person across headers, bodies, signatures, recipients and quoted variants; body-only addresses; employer domains; capitalised short names masked while lowercase words are kept; dates, quantities and reference numbers protected from the phone heuristic; renumbered ids keeping their references; no image bytes, attachment URLs or mail-tab reference; preserved wording, tables, order, timestamps and recovery labels; masked filename |
| Participant identity | A name-only quoted author resolved to an address they sent from (either order), to a provider address with no display name, to a To/Cc address, and — for a lone first name — to the one person who has it; the reader recognised under both identities; two people sharing a name, a first name shared by two, a full name against a partial match, and a two-letter nickname all left alone; identity resolved without merging distinct messages; stable across repeated reconciliation; one participant chip, one colour and one message count through the cache; masked copies keeping the unaddressed shape, one placeholder per person, and the same grouping |
| Thread-source capture | One entry per provider container with the snapshot the parser received; collapsed rows kept as headers with a note; provider classes, ids, clocks, recipient rows and attachment chips retained; oversized containers shortened and reported; picture payloads folded stably out of both the snapshot and the container markup |
| Capture fidelity | A capture replays to exactly the thread the extension produced, before and after an older email is opened; whole and batched reads agree; a masked capture parses to the same shape as its original; a masked copy that would lose a message is reported with the message and field that moved |
| Masked captures | No name, address, domain, phone number, provider id or picture payload survives; display names learned before any markup is rewritten, so two copies of one email mask alike; calendar words never learned as identities; picture placeholders keep their kind (blob, proxy, proxied original, payload, cid, address with a varying query); masked containers read back into a page as the same conversation; masked source filename |
| Extension integration | Real content script/service worker/panel flow, tab isolation, inbox clearing, no preload mismatch warnings, synthetic missing-year near-copy example, timezone-shifted quoted copy, forward-only receiving event |

## Commands

```sh
npm test
npm run typecheck
npm run build:dev
npm run replay -- artifacts/thread-source-capture.json
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/smoke-extension.mjs
# After package:dev and package:prod:
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run test:packages
```

`npm run replay` reads a thread-source capture back through the real parser and prints the conversation it makes of it. The synthetic example above is written by the test suite; a capture from a real mailbox is read the same way.

## Not claimed as fully solved

- Mail/history omitted by the sender or unavailable to the browser cannot be recovered by parsing.
- Recipient headers show first *visible* inclusion, not guaranteed original membership. Bcc, group membership, aliases, unavailable header details and unknown signed-in identity can require the availability fallback.
- Arbitrary localized/custom headers and interleaved inline edits are not universally supported. Add an anonymized DOM fixture for each real failure.
- A quote can be edited by its sender. Near-copy matching is intentionally narrow; variants remain inspectable, and ambiguous cases can still appear separately.
- A quoted attribution line records no timezone. Where no provider header or confirmed offset resolves it, the displayed time is the quoted clock read as local and can be offset from the real send time; the panel and the export say so. Quote nesting still orders those messages correctly, but two messages that no chain relates — sibling forwards, or a direct email quoting neither — are ordered by clocks that may sit in different zones.
- A thread-source capture holds only what the page held, with picture payloads folded to digests. It reproduces parsing and scraping, not the pixels of a picture, and its fidelity check proves that a masked copy parses alike — not that no identity survives in prose.
- Live enterprise Gmail/Outlook selectors and provider authentication must be verified in the user's tenant. Synthetic Chromium testing is not a live-mailbox certification.
