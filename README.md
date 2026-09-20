# ThreadLens 1.7.2

A local Chrome extension that displays long Gmail and Outlook email conversations as chronological chat messages. Included quoted history is split into individual messages, including when you join a conversation midway.

## Load the ready-built extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's **dist** directory.
4. If ThreadLens is already loaded from that directory, click **Reload** on its extension card.
5. Refresh your Gmail/Outlook tab, open an email conversation, then click the ThreadLens toolbar icon.

The ZIP in `releases/threadlens-1.6.3.zip` contains the same build. Extract it first and select the extracted directory containing `manifest.json`. Do not select the project root, which contains source-code paths.

## A shorter panel in 1.7.2

The picture-embedding download is gone — the text-only and masked copies remain, and neither writes picture bytes. **Read collapsed emails** now has an opposite, **Collapse emails again**, which puts the mailbox back as you found it; everything ThreadLens has already recovered stays in the panel whether or not Gmail is still showing it. A long thread also gets two round buttons at the bottom of the chat, as a messaging app does: ↑ jumps to the first message and ↓ to the latest, each appearing only when there is somewhere to go. `Home` and `End` do the same from the keyboard.

## One person, one identity in 1.7.1

A quoted attribution names its author but usually records no address, so ThreadLens had to invent one — and the same colleague appeared twice in the participant bar, in two colours, once under their address and once under their name alone. A name-only author is now given the address the thread itself shows for that name: one they have written from, one the To and Cc lines carry for them, or, for a lone first name, the one person in the thread who has it. Where the thread offers no such evidence — a nickname like "DJ", or an author it never addresses — they are still shown as themselves rather than linked to somebody who might not be them. Masked copies keep the same grouping, and no longer invent an address for an author who never gave one.

## Reporting a parsing problem in 1.7.0

Some conversations only go wrong in a real mailbox, and the exported conversation cannot show why: by then the provider's own markup — the thing ThreadLens actually reads — is gone. **Report a parsing problem**, under the export buttons, saves that markup instead, masked so it can be sent to whoever is diagnosing the problem. Before either file is written the two copies are parsed and compared, and the answer is written into the file and shown in the panel, so nobody has to assume the masked copy still reproduces the problem. See [Report a parsing problem](#report-a-parsing-problem).

Expansion stability from 1.6.3 is unchanged: opening an email already represented in quoted history reconciles image filename/alt differences without adding duplicate messages, and formatting-only or provider-clipped copies do not create a redundant “Quoted copy differs” section.

Refresh Gmail after reloading the extension and export again. Existing downloaded HTML files remain unchanged. Expanding an email can still reveal previously unavailable history or refine an estimated date.

## Included

- Separate sender-labeled messages from Gmail quotes, forwarded mail and Outlook-style header chains.
- Direct and recovered messages reconciled together, retaining quoted-only history after expansion.
- Chronological ordering with date/time and an explicit label when a time is uncertain.
- Tables, cell spans, lists, paragraphs, links and useful text styling.
- Inline images in their original message position, with lazy loading and a full-size viewer.
- Incremental reading and offscreen parsing to reduce work inside Gmail. Collapsed emails expand only when you click **Read collapsed emails**.
- Participant filters and search highlighting within formatted messages.
- Attachment metadata and provider links when exposed by the page.
- Explicit local file saving, downloading and removal. If **Save locally** cannot access the provider link, download the file through email and use **Choose downloaded file**.

Local attachment limits: **20 MB per file, 100 MB total**. Mail content stays in tab-specific browser session storage; attachment copies remain in local IndexedDB until removed. No app backend, cloud sync or AI service is used. Mail-host access enables extraction and file retrieval. Gmail image-proxy access enables image embedding; the offscreen permission moves parsing out of the mail page. Chrome 116 or later is required. Displaying HTTPS images contacts their image hosts; there is no ThreadLens server.

## What it can recover

History must actually be included in the emails available to your browser. Messages omitted from a forwarded/replied email, inaccessible attachments and emails you never received cannot be recreated. Provider layouts vary, and inline replies or unsupported localized headers may remain combined. Tables and useful styles are preserved; available inline images are retained; unsafe HTML/CSS is excluded.

Gmail integration has been tested with a synthetic page in a real Chromium extension session. Live enterprise Gmail/Outlook layouts and authenticated attachment endpoints still require account-specific verification.

## Replies, forwards and joining midway

Quoted copies are reconciled with original emails using sender, date and message content, ignoring formatting and signature noise. An inline picture re-addressed by the provider between copies — a fresh proxy token or blob handle for each one — no longer reads as a different email, and an attribution that names its author without recording an address is matched against the address seen elsewhere in the thread. Different direct emails remain separate. A narrowly matched quote with changed wording is retained under **Quoted copy differs**, so differences can be inspected instead of silently discarded. Changes to numbers or negations are not treated as near-duplicates.

Earlier history is reconstructed from all available quoted/forwarded messages. The timeline marks **You joined here · first visible inclusion** when an available header explicitly includes the signed-in address. This identifies the first inclusion visible to the extension, not proof of the original join date. If only mailbox availability is known, the marker says **Your available mailbox history starts here** instead. A forward without introductory text retains a small receiving-email entry so recipient evidence is not lost.

Missing-year dates are inferred relative to the current conversation and labeled approximate until a matching explicitly dated quote is available. Nested signatures and text after quoted blocks stay with their owning email.

### Order without opening every email

A collapsed row often labels only a clock (`10:32`) or a day (`Sep 8`), so its full date is read from the row's `title`/tooltip attributes rather than its visible text. When no readable date exists at all, the message keeps **the place the mailbox gives it** — its position is read from the thread's own DOM order on every pass — and its time is interpolated between the nearest messages whose clocks were readable, so it stays where it belongs instead of drifting to the end of the timeline. The time itself is still shown as approximate, because it is. Opening an email in the mail tab refines its displayed time but no longer changes its order.

When two correspondents are in different timezones, no amount of clock reading settles their order: each quoted header is stamped in the quoting author's zone, so a reply can read `09:04` above the `13:28` message it answers. The quote nesting itself is the evidence — a client encloses the email it is answering inside its own — so **messages are ordered by the reply chain, and the clocks only break ties the chain leaves open**. A thread quoting nothing, and two messages the chain never relates (sibling forwards, for instance), keep the plain chronological order. Where the nesting overrules the clocks, both messages are marked *Placed by the quoted reply chain* in the panel and the export, so a time that looks out of sequence is explained rather than silently corrected.

A quoted reply header such as `On 9 Sept 2026 at 09:04 ... wrote:` is written by the replying client in **its own timezone and records no offset**, so the same email can read hours away from the provider header your mail client renders in yours. Those clocks are reconciled against the provider header, which supplies the displayed time, and an offset confirmed by a long duplicate also resolves shorter identical copies in the same conversation. One offset is used by every copy a client quoted, so word-for-word copies vote on it: two copies that agree, or one long body, confirm the offset that then dates the shorter copies. No copy can confirm the offset that would justify merging itself. Where the same wording was genuinely sent twice, each copy is attached to the message whose gap is the offset the thread proved. Separate emails, different senders, changed figures and gaps no timezone produces stay separate; conversations written in a single timezone are unaffected. Where nothing resolves a quoted clock, the panel and the export say the time was read from quoted text and may be offset from the real send time.

## Deeply nested threads and repeated copies

An enterprise thread indents every reply, and a message twenty replies down was arriving wrapped in one quote indent per reply — a column of empty vertical rules before the first word. Those wrappers are the quoting clients' indentation, not the author's formatting, so they are no longer rebuilt around a recovered message; a quotation the author wrote inside their own message is still shown as a quotation.

The same message also reaches ThreadLens in copies that a provider trimmed differently: a quoted copy keeps fewer signature logos, Gmail clips a long body and says `[Message clipped]`, and a reply written in another country stamps the quote with its own clock. Copies are now matched through all three — an unequal number of pictures is not evidence of a different message, the provider's own clipping notice is not treated as the author's words, and a specific sentence quoted against an email your mailbox holds is merged even when it is short. The surviving entry keeps the provider's timestamp, its attachments and the complete wording, and any copy that differs stays under *Quoted copy differs*. Genuinely different pictures, brief acknowledgements such as "Thanks", and copies that no provider header dates are still kept apart.

Providers also stamp their own text onto a copy: a tenant's *External email* banner appears on the copy that arrived from outside but not on the copy its author quoted, and a picture one client could not re-host leaves a caption where another kept the picture. None of that is the author's words, so none of it is used to decide whether two copies are the same email — it is still shown, just not compared. Clocks are read the same way: a quoted `Sent:` line comes from the sender's own machine and a provider header from the server, so copies of one email can sit four and a half hours *and four minutes* apart; offsets are recognised with that skew allowed.

When a thread is forwarded or replied to without any new words, ThreadLens says so on one line — *"… passed this conversation on to … without adding a message"* — instead of showing an empty message, and everything that email carried is recovered as messages in its own right.

## Download an entire conversation

Click **Text only (no images)** under the subject in the side panel. The single standalone HTML file opens in a browser and preserves message order, sender names/addresses, timestamps, tables, lists and text formatting. It includes all recovered messages even when search or a participant filter is active. No image or attachment data is written: every inline image becomes a placeholder naming the file, such as `image-1.png` or the source's own `chart-q4.png`, and no provider URLs are written. The file is a few kilobytes rather than megabytes, opens identically offline, and is saved as `ThreadLens-<subject>-<date>-no-images.html`. Attachment names are listed; use the attachment buttons to download the files themselves. You can also print the HTML from your browser.

**Masked copy (share-safe)** writes the same conversation with the identities removed, for handing a thread to someone who is helping you diagnose a parsing problem. Every email address, sender name, name mentioned in a body or signature, company domain, phone number, long reference number, link address, attachment name and internal message id is replaced by a numbered placeholder — `Person 1`, `person1@company1.example`, `Company 2`, `[phone-1]` — and the same real value always becomes the same placeholder, so reply chains, duplicate quotes, who answered whom and who joined when all still read correctly. A capitalised short form of a known name is masked too — `Sid` for Siddharth, `Elevation` for elevationservices.co.uk, and `WarehousePartners` written as one word in a filename — while ordinary lowercase words such as "the car park" are left alone. Consumer mail hosts such as `gmail.com` stay readable because they identify nobody.

Message wording, formatting, tables, order, timestamps, recovery labels and quoted variants are **unchanged**, so the masked file still reproduces the problem it was exported for. No image is included — a picture can show a face, a signature or a letterhead — each one becoming a positioned `image-1.png` placeholder instead, and no attachment bytes or provider URLs are written. The placeholder-to-person map exists only while the file is being written and is never stored in it, so nobody can reverse the file back to the real people. The copy is saved as `ThreadLens-<subject>-<date>-masked.html` and the file itself says it is masked.

Masking is a strong default, not a guarantee: a nickname that shares no opening letters with the real name, an identity written only inside a picture, and a company named in prose but never in an address or domain can survive. Open the file and read it before sending it anywhere.

## Report a parsing problem

A masked conversation shows what ThreadLens produced. When the problem is in what it *read* — an email split in the wrong place, one email shown twice, a message that never appears, a date read from the wrong element — the evidence is the mail page's own markup, and the conversation export no longer contains it. Open **Report a parsing problem** under the export buttons for two more downloads:

- **Thread source (masked)** — the provider's markup for every email in the thread, with every identity replaced exactly as in the masked conversation. This is the file to send. It is saved as `ThreadLens-<subject>-<date>-source-masked.json`.
- **Thread source (original, private)** — the same file with the real names and addresses still in it. Keep it locally to see what the masked copy replaced. Do not send it.

Each entry holds the whole provider container — header row, date cell, recipient chips, attachment chips — and, separately, the exact snapshot the parser received for that email, so a scraping problem and a parsing problem can be told apart. A collapsed row that renders no body is recorded as headers only and says so. Inline picture bytes are never written: each payload is folded to a short digest that keeps "the same picture" and "a different picture" telling apart exactly as they did, and blob, proxy, `cid:` and ordinary addresses each keep their own kind of placeholder, because reconciliation reads those differences when deciding whether two copies are one email.

**Both copies are always parsed and compared before either is saved.** Masking shortens names, and reconciliation weighs how much text two copies share, so a masked copy is not assumed to behave like the original — it is checked. The panel reports the result, and the file records it:

> The masked copy parses to the same 21 message(s) as the original, with the same order, clocks, quote links and pictures.

If the two disagree, the file lists exactly which message and which field moved, and the panel says to send the original as well if that is possible. The thread is also read twice — whole, and in batches the way a mailbox delivers it — because a difference between those two is a parsing problem in itself.

To read a capture back without a browser or a mailbox:

```sh
npm run replay -- ThreadLens-<subject>-<date>-source-masked.json
```

It prints what the parser makes of the file: how many containers were captured, how many messages came out, whether reading it whole and in batches agree, and one line per message with its sender, clock, variants and attachments. `artifacts/thread-source-capture.json` is a synthetic example of the format.

Everything is written by the panel itself — no upload, no network, no extension download permission.

## Building a release

```sh
npm run release
```

One command does everything: typecheck, the full test suite, the production build, then packaging. It stops at the first failure and releases nothing. Node 22 or newer is required (the test runner needs it); if your shell's default `node` is older, the command finds an installed Node 22 through nvm and re-runs itself on it rather than failing part-way.

It leaves two things in `releases/`:

- `threadlens-<version>/` — an unpacked folder. In `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select it. If ThreadLens is already loaded, press **Reload** on its card instead, then refresh Gmail or Outlook and reopen the panel.
- `threadlens-<version>.zip` — the same thing zipped, with an `INSTALL.txt`, for sharing. Its SHA-256 is printed at the end and recorded in `releases/SHA256SUMS.txt`.

To change the version first (the archive is named from `package.json`, and packaging refuses to run if the built manifest disagrees):

```sh
npm run version:patch   # fixes
npm run version:minor   # features
npm run release
```

`releases/` is ignored by git; the build is local.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Optional full extension smoke test, with an available Playwright installation and Chromium:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/smoke-extension.mjs
```

The parser suite has **243 passing checks**, including a 40-message case and a five-person capture read back through the real reader, parser and masker. The browser smoke tests extraction, table rendering, rich search, attachment persistence/download/removal and tab navigation. See **TEST_COVERAGE.md** for the covered cases, and **CONTEXT.md** for architecture, implementation decisions, limitations and next checks.

## Recreate release downloads after cloning

The generated `dist/` and `releases/` directories are intentionally ignored by Git. All source for the 1.5.1 fixes is in main. Run `npm ci` and `npm run package` (Node.js 20.19+ and Python 3) to validate, rebuild, and produce `releases/threadlens-<version>.zip` with installation instructions and SHA-256 checksums. The ZIP contains a root manifest.json and can be extracted and loaded unpacked in Chrome. No customer mail is included.

## Image availability and performance

Refresh the original mail tab after reloading the extension, then export again. Pictures are shown in the panel, at full size when clicked; exports name them rather than carrying them, so an exported file holds no picture bytes or provider URLs. Images removed by the sender, unresolved `cid:` references, expired links or inaccessible provider resources remain visibly unavailable. Gmail's actual proxy URLs and images exposed as source-tab blobs are supported; images remain in position without splitting the message. Click an image to view its full dimensions.

Parsing runs in an inert offscreen extension document. The mail page captures only new or changed messages in small idle batches, ignores unrelated toolbar/scroll mutations, and no longer automatically expands all Gmail messages. This reduces extension work on Gmail's main thread; it does not guarantee a particular live mailbox's frame rate. If older messages are missing because Gmail has not loaded their bodies, use **Read collapsed emails** (Gmail only).

A reproducible synthetic 40-message comparison is in `scripts/benchmark-reader.mjs`, with measurements in `artifacts/performance.json`. It measures mail-page processing, not total extension CPU or a live enterprise account.
