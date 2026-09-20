# 06 · Attachments — named always, fetched only when asked

![Inline images and attachments](diagrams/05-images-and-attachments.png)

**Source:** `src/side-panel/storage/attachments.ts`,
`src/side-panel/components/AttachmentControls.tsx`,
`src/side-panel/components/AttachmentChip.tsx`, `src/content/gmail-scraper.ts:77`,
`src/content/outlook-scraper.ts:187`, `src/content/scraper-utils.ts:111`

Two separate promises here, and the distinction is the whole design:

- **A file's existence is metadata**, and ThreadLens always shows it — name, size and type —
  even when no link works.
- **A file's bytes are the provider's**, and ThreadLens fetches them only when the reader
  presses a button, stores them only on this device, and never writes them into an export.

Attachment access is available in **both** the production and development builds (restored in
1.7.4 after being inadvertently limited in 1.7.3).

---

## 1. Reading the chips

### Gmail — `gmail-scraper.ts:77`

Selectors are tried in order and the **first non-empty result wins**: `.aZo`, then
`.M2 .aQy`, then `[data-tooltip*="."]`. For each chip:

- **name** from `.aV3` or `.aQw`, falling back to the tooltip;
- the name **must contain a dot** (`:89`) — that one test is what stops a button label or a
  tooltip fragment being filed as a filename;
- **size label** from `.aV7` or any `[class*="size"]`, kept as the provider's own string
  (`"1.2 MB"`) rather than re-formatted;
- **link** from `a[href*="view=att"]` or `a[href*="attid"]`, else the chip's own `href`.

### Outlook — `outlook-scraper.ts:187`

`a[download]`, `a[href*="attachment" i]`, `a[href*="GetFileAttachment" i]`; the name comes from
the `download` attribute, then `title`, then the link text.

### Type — `scraper-utils.ts:111`

`mimeFromExtension()` maps the extension through a small table (pdf, doc/docx, xls/xlsx, txt,
csv, zip, png, jpg/jpeg, gif) and otherwise returns `application/octet-stream`. The provider is
never asked, and the type is only used for display and for the saved `Blob`.

The resulting shape is `Attachment { name, mimeType, sizeLabel, downloadUrl }`
(`src/types/index.ts:8`).

---

## 2. Surviving reconciliation

Attachment metadata is attached to the **direct** message during snapshotting, and Gmail
frequently renders chips *after* the body. Two mechanics keep them:

1. A chip appearing later is an attribute/child mutation inside the message container, so the
   reader re-snapshots it and the metadata arrives in a later batch.
2. `combine()` (`message-reconciliation.ts:288`) **unions** attachments from both copies and
   de-duplicates on `name + sizeLabel + downloadUrl`. A quoted copy that mentions the file but
   carries no chip never erases the copy that has one.

This was a real defect once — the same email appearing twice, one copy with attachments — and
the union is the fix.

---

## 3. What the panel shows

`AttachmentChip.tsx` renders name, size label and type under the bubble; `AttachmentControls.tsx`
renders the actions. The available actions depend on two independent facts: **is there a usable
link**, and **is a copy already saved on this device**.

| State | Controls |
|---|---|
| usable link, nothing saved | *Open in email* · *Save locally* · *Choose downloaded file* |
| no usable link, nothing saved | *Choose downloaded file* |
| a copy is saved | *Download saved file* · *Remove local copy* |

Every action reports its own error inline via `role="alert"`, and the busy state is announced
with `role="status"` (`AttachmentControls.tsx:47`).

---

## 4. The host allowlist — `attachmentUrl()` at `attachments.ts:53`

```ts
url.protocol === 'https:' && ['mail.google.com', 'outlook.live.com',
  'outlook.office.com', 'outlook.office365.com'].includes(url.hostname)
```

Nothing else is fetched, and the *response's* URL is re-checked after redirects
(`attachments.ts:63`) so a redirect off the allowlist is refused rather than followed.

---

## 5. Saving locally — `fetchAttachment()` at `attachments.ts:59`

1. `fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) })` — the reader's
   own provider session is what authorises this; ThreadLens holds no credentials.
2. **An HTML response is refused.** A `text/html` content type from an attachment endpoint is a
   login or consent page, not a file. The reader is told to download it in the mail client and
   use *Choose downloaded file* — caching a login page as "the invoice" would be worse than
   failing.
3. A declared `content-length` over **`MAX_FILE_BYTES` = 20 MB** is rejected before any body is
   read.
4. The body is read through a stream reader and **cancelled** the moment the running total
   crosses 20 MB, so a missing or dishonest `content-length` cannot be used to exhaust storage.
5. The bytes become a `Blob` with the provider's content type.

---

## 6. Local storage — `attachments.ts:5`–`:52`

IndexedDB database `threadlens-attachments`, object store `files`, keyed by

```
`${messageId}:${attachment.name}:${attachment.sizeLabel}`
```

so a file is bound to the message it arrived with, not merely to its name.

- **Per file**: 20 MB (`MAX_FILE_BYTES`).
- **Per profile**: 100 MB (`MAX_CACHE_BYTES`). The write transaction sums every other stored
  file first and **aborts** if the total would be exceeded (`:34`), surfacing
  *"Local attachment storage is full (100 MB). Remove saved files first."*
- The database handle is opened per operation and closed in a `finally` — an extension page can
  be torn down at any moment, and a held-open connection blocks upgrades.
- Files persist across browser restarts until removed, browser storage is cleared, or the
  extension is uninstalled. This is the **only** thing ThreadLens writes to disk.

---

## 7. Downloading and removing

- *Download saved file* creates an object URL from the stored `Blob`, clicks a synthetic
  `<a download>`, and revokes the URL a second later (`AttachmentControls.tsx:22`). If the entry
  has vanished the button self-corrects back to the unsaved state.
- *Remove local copy* deletes the record immediately.
- No `downloads` permission is requested anywhere in the extension. Every save in the product —
  attachments, images and exports alike — goes through `export/download.ts:2`, which is a
  temporary anchor element in the panel's own document. Nothing can be written to disk without
  a click.

---

## 8. Manual import — the fallback that makes the feature honest

Some tenants will not serve an attachment to anything but the mail client. *Choose downloaded
file* (`AttachmentControls.tsx:40`) lets the reader download it there and then pick it:

```ts
if (file.name !== attachment.name) throw new Error(`Choose the file named ${attachment.name}.`);
```

The name must match exactly, so the wrong file cannot be filed against a message. The picked
file is stored under the same key and behaves identically from then on.

---

## 9. In exports

The conversation export lists attachment **names and sizes** and states plainly:

> *File contents are not embedded. Download attachments separately from ThreadLens or the
> original email.*

No bytes and no provider URLs are ever written, because an attachment URL is authenticated and
expiring — an exported file containing one is either useless later or a credential-shaped leak
now. In a masked copy, `maskMessage()` (`export/mask.ts:409`) additionally rewrites the filename
and sets `downloadUrl` to `''`.

---

## 10. Limits

- Provider links expire and are tenant-specific; *Save locally* while the link works, or import
  the downloaded file.
- 20 MB per file and 100 MB per profile are hard limits, reported as such.
- A saved copy is keyed by message id, so a refreshed provider message identity may require
  re-selecting the file.
- Chrome's storage is not an additional application-level encryption layer; uninstalling the
  extension removes everything it stored.
- Attachments mentioned only in quoted text have no bytes anywhere in the browser — they are
  listed as evidence, and that is all anyone can do with them.

**Next:** [07 · Side panel UI](07-side-panel-ui.md)
