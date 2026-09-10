# ThreadLens 1.3.1

A local Chrome extension that displays long Gmail and Outlook email conversations as chronological chat messages. Included quoted history is split into individual messages, including when you join a conversation midway.

## Load the ready-built extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's **dist** directory.
4. If ThreadLens is already loaded from that directory, click **Reload** on its extension card.
5. Refresh your Gmail/Outlook tab, open an email conversation, then click the ThreadLens toolbar icon.

The ZIP in `releases/threadlens-1.3.1.zip` contains the same build. Extract it first and select the extracted directory containing `manifest.json`. Do not select the project root, which contains source-code paths.

## Included

- Separate sender-labeled messages from Gmail quotes, forwarded mail and Outlook-style header chains.
- Direct and recovered messages reconciled together, retaining quoted-only history after expansion.
- Chronological ordering with date/time and an explicit label when a time is uncertain.
- Tables, cell spans, lists, paragraphs, links and useful text styling.
- Participant filters and search highlighting within formatted messages.
- Attachment metadata and provider links when exposed by the page.
- Explicit local file saving, downloading and removal. If **Save locally** cannot access the provider link, download the file through email and use **Choose downloaded file**.

Local attachment limits: **20 MB per file, 100 MB total**. Mail content stays in tab-specific browser session storage; attachment copies remain in local IndexedDB until removed. No app backend, cloud sync or AI service is used. Mail-host access in the manifest enables content extraction and user-triggered attachment retrieval.

## What it can recover

History must actually be included in the emails available to your browser. Messages omitted from a forwarded/replied email, inaccessible attachments and emails you never received cannot be recreated. Provider layouts vary, and inline replies or unsupported localized headers may remain combined. Tables and useful styles are preserved; remote images and unsafe HTML/CSS are excluded.

Gmail integration has been tested with a synthetic page in a real Chromium extension session. Live enterprise Gmail/Outlook layouts and authenticated attachment endpoints still require account-specific verification.

## Replies, forwards and joining midway

Quoted copies are reconciled with original emails using sender, date and message content, ignoring formatting and signature noise. Different direct emails remain separate. A narrowly matched quote with changed wording is retained under **Quoted copy differs**, so differences can be inspected instead of silently discarded. Changes to numbers or negations are not treated as near-duplicates.

Earlier history is reconstructed from all available quoted/forwarded messages. The timeline marks **You joined here · first visible inclusion** when an available header explicitly includes the signed-in address. This identifies the first inclusion visible to the extension, not proof of the original join date. If only mailbox availability is known, the marker says **Your available mailbox history starts here** instead. A forward without introductory text retains a small receiving-email entry so recipient evidence is not lost.

Missing-year dates are inferred relative to the current conversation and labeled approximate until a matching explicitly dated quote is available. Nested signatures and text after quoted blocks stay with their owning email.

A quoted reply header such as `On 9 Sept 2026 at 09:04 ... wrote:` is written by the replying client in **its own timezone and records no offset**, so the same email can read hours away from the provider header your mail client renders in yours. Those clocks are reconciled against the provider header, which supplies the displayed time, and an offset confirmed by a long duplicate also resolves shorter identical copies in the same conversation. Separate emails, different senders, changed figures and gaps no timezone produces stay separate; conversations written in a single timezone are unaffected. Where nothing resolves a quoted clock, the panel and the export say the time was read from quoted text and may be offset from the real send time.

## Download an entire conversation

Click **Download conversation (.html)** under the subject in the side panel. The single standalone HTML file opens in a browser and preserves message order, sender names/addresses, timestamps, tables, lists and text formatting. It includes all recovered messages even when search or a participant filter is active. Attachment names are listed; file bytes and provider download URLs are not embedded. Use the attachment buttons to download files separately. You can also print the HTML from your browser.

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

The parser suite has **98 passing checks**, including a 40-message case. The browser smoke tests extraction, table rendering, rich search, attachment persistence/download/removal and tab navigation. See **TEST_COVERAGE.md** for the covered cases, and **CONTEXT.md** for architecture, implementation decisions, limitations and next checks.

## Recreate release downloads after cloning

The generated `dist/` and `releases/` directories are intentionally ignored by Git. All source for the 1.3.1 fixes is in main. Run `npm ci` and `npm run package` (Node.js 20.19+ and Python 3) to validate, rebuild, and produce `releases/threadlens-<version>.zip` with installation instructions and SHA-256 checksums. The ZIP contains a root manifest.json and can be extracted and loaded unpacked in Chrome. No customer mail is included.
