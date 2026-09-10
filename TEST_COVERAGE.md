# Enterprise conversation test coverage

Release 1.5.0. **144 automated tests** plus the real Chromium extension smoke test. All committed cases are synthetic; the user's exported conversation was examined and replayed locally only.

| Area | Cases covered |
|---|---|
| Standard replies | Gmail nested attribution, Outlook From/Sent/To/Subject, plain On/wrote text, Apple/mobile comma attribution, wrapped attribution, single messages, ordinary blockquotes, short replies |
| Joining midway | 40 messages recovered from one nested chain; 40 unique messages recovered from the last five direct emails; earlier quoted history retained after direct expansion |
| Forwarding | Forward with an introduction, pure forward, nested Outlook inside forward, mixed Gmail/Outlook, independent sibling forwards, new recipient later replying in the same conversation |
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
| Duplicate copies | Twenty-email thread with unanswered follow-ups reduced to one entry per message, identical follow-ups assigned to the right message, name-only attributions matched, placeholder names kept apart, re-addressed inline pictures merged, differing pictures kept apart, offset confirmed by two agreeing copies |
| No-images exports | Every image replaced by a filename, source URLs and image bytes absent, source-derived and generated names, alt text kept, image-free threads unchanged, filename suffix |
| Inline images | Image-only, leading/trailing, between paragraphs, table-cell and quoted images; author ownership; live source overrides; blob references; unsafe/cid rejection; removed-image captions; differing images kept separate; export embedding/failure notices; raster/size checks |
| Browser image flow | HTTPS and source-tab blob images render at full natural dimensions; full-size dialog; offline HTML embeds both sources; updates/replaced body nodes retain pictures |
| Adapter stability | Gmail identity/date stable across edits; Outlook fallback IDs stable; nested Outlook wrappers produce one message |
| Performance | Synthetic 40-message ~1 MB benchmark; no automatic expand-all; unrelated toolbar/scroll mutations cause zero additional snapshots; a body edit snapshots only its owning message |
| Extension integration | Real content script/service worker/panel flow, tab isolation, inbox clearing, no preload mismatch warnings, synthetic missing-year near-copy example, timezone-shifted quoted copy, forward-only receiving event |

## Commands

```sh
npm test
npm run typecheck
npm run build
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/smoke-extension.mjs
```

## Not claimed as fully solved

- Mail/history omitted by the sender or unavailable to the browser cannot be recovered by parsing.
- Recipient headers show first *visible* inclusion, not guaranteed original membership. Bcc, group membership, aliases, unavailable header details and unknown signed-in identity can require the availability fallback.
- Arbitrary localized/custom headers and interleaved inline edits are not universally supported. Add an anonymized DOM fixture for each real failure.
- A quote can be edited by its sender. Near-copy matching is intentionally narrow; variants remain inspectable, and ambiguous cases can still appear separately.
- A quoted attribution line records no timezone. Where no provider header or confirmed offset resolves it, the displayed time is the quoted clock read as local and can be offset from the real send time; the panel and the export say so.
- Live enterprise Gmail/Outlook selectors and provider authentication must be verified in the user's tenant. Synthetic Chromium testing is not a live-mailbox certification.
