# 05 · Inline images — a picture is part of the message

![Inline images and attachments](diagrams/05-images-and-attachments.png)

**Source:** `src/shared/images.ts`, `src/side-panel/media/images.ts`,
`src/side-panel/media/download-image.ts`, `src/side-panel/components/RichBody.tsx`,
`src/content/scraper-utils.ts:139` (the sanitiser)

A signature logo, a pasted chart, a screenshot of an invoice — in enterprise mail these are
frequently *the* content. ThreadLens keeps every inline image in its original position inside
the message, at its original resolution, without ever letting the email's markup decide what
the browser loads.

---

## 1. Capture — in the mail page

`incremental-reader.ts:194`

```ts
imageSources(body) = [...body.querySelectorAll('img')]
  .map(img => img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '');
```

`currentSrc` first, because the provider may have resolved a `srcset` or a lazy-loading
placeholder into something quite different from the `src` attribute. The array is sent
**alongside** the body HTML, positionally, because in the parser's inert document there is no
`currentSrc` to read and nothing to resolve a relative address against.

A changed image source marks its message dirty like any other edit — `src`, `srcset` and
`data-src` are in the observer's attribute filter (`incremental-reader.ts:167`).

## 2. Restoration — in the parser

`offscreen/parser.ts:24`

```ts
root.querySelectorAll('img').forEach((img, i) => {
  const source = snapshot.imageSources[i];
  if (source) img.setAttribute('src', source);
  img.removeAttribute('srcset');
});
```

The document is inert, so assigning `src` loads nothing. `srcset` is dropped outright: one
address per picture, and it is the one the page actually resolved.

Because [03](03-message-splitting.md) projects each `<img>` as a single `U+FFFC` character, a
picture belongs to exactly one segment and a message is never split through one.

## 3. The safety gate — `safeImageSource()`

`src/shared/images.ts:3`. Every image address in the product passes through this one function —
the sanitiser, the panel loader, the blob handler and the masker all call it.

| Accepted | Condition |
|---|---|
| `data:image/(png\|jpeg\|gif\|webp\|avif);base64,…` | raster only, and under `MAX_IMAGE_BYTES` × 1.4 (the base64 overhead) |
| `https:` | no username, no password embedded in the URL |
| `blob:` | **only** when the origin is `mail.google.com`, `outlook.live.com`, `outlook.office.com` or `outlook.office365.com` |

Everything else returns `''`: `cid:` references with no provider data behind them, `http:`,
`javascript:`, `file:`, SVG data payloads (which can carry script), anything malformed.

`MAX_IMAGE_BYTES` is **8 MB** (`images.ts:2`).

## 4. Rewriting — `sanitizeEmailHtml()`

`scraper-utils.ts:151`. For every `<img>`:

1. A **1–2 px** image with explicit width and height is a tracking pixel and is removed
   outright.
2. An address the gate rejected becomes visible text: `[Image unavailable: <alt>]` — never a
   silent disappearance.
3. Otherwise **every attribute is stripped**, and a known-safe set is put back:

   | Attribute | Value |
   |---|---|
   | `src`, or `data-tl-image-src` | the gated source; the `data-` form is used for `blob:` addresses, which belong to the mail tab and must be resolved through it |
   | `alt` | the original, or `"Inline image"` |
   | `loading` | `lazy` |
   | `decoding` | `async` |
   | `referrerpolicy` | `no-referrer` |
   | `width`, `height` | only when the original values are plain 1–5 digit numbers |

That is the whole allowlist. No `style`, no `onerror`, no `srcset`, no `usemap`.

## 5. Loading on demand — `RichBody`

`src/side-panel/components/RichBody.tsx:31`

- An `IntersectionObserver` with `rootMargin: '200px'` starts a load just before the picture
  reaches the viewport (`:46`). Pictures deep in a forty-message thread cost nothing until they
  are scrolled to.
- `https:` images are left to the browser; only a **`data-tl-image-src`** (a mail-tab blob) is
  fetched eagerly through `loadInlineImage`.
- An `error` event triggers **one** retry through `loadInlineImage`, which fetches with the
  extension's host access — this is what recovers authenticated provider images the page's own
  credentials could not reach (`:54`).
- A second failure writes a visible caption: *"Image unavailable: <alt>. Open the original email
  to check access."* (`:36`).
- Every image is made keyboard-reachable: `tabIndex`, `role="button"`, an `aria-label`, and
  Enter/Space handling (`:50`).

### 5.1 `loadInlineImage()` — `media/images.ts:11`

| Control | Value | Why |
|---|---|---|
| cache key | `tabId:src` | two tabs may hold different blobs at the same URL |
| concurrency | **2** (`:5`) | a signature of seven logos repeated in thirty quotes must not flood the panel |
| cache size | 16 entries, oldest evicted (`:30`) | enough for a thread's repeated logos |
| large images | anything over **2 MB** is dropped from the cache once delivered (`:29`) | memory |
| `data:` sources | returned immediately | already inline |
| `blob:` sources | round trip via `READ_PAGE_IMAGE` | see below |
| everything else | `fetch(credentials: 'include', referrerPolicy: 'no-referrer')`, 15 s timeout | |

### 5.2 The blob round trip

A `blob:` URL is only meaningful inside the document that created it, so the panel cannot read
one. The path is:

```
panel  --READ_PAGE_IMAGE-->  service worker  --READ_BLOB_IMAGE-->  mail tab
                                                                     |
panel  <-------------------- data: URL <-----------------------------+
```

Two checks make this safe:

1. The service worker only accepts `READ_PAGE_IMAGE` when the sender's URL is exactly the
   side-panel page (`service-worker.ts:23`).
2. The content script refuses unless the blob's origin is the page's own **and** that exact URL
   is currently displayed by an `<img>` inside a message body in this thread
   (`incremental-reader.ts:180`). The extension cannot be used to read arbitrary blobs out of a
   mail tab.

### 5.3 `imageResponse()` — `shared/images.ts:13`

Every fetched image is validated before it becomes a data URL:

- the `content-type` must be a **raster** mime (`png`, `jpeg`, `gif`, `webp`, `avif`) —
  `rasterMime()` at `:12`;
- a declared `content-length` over 8 MB is rejected immediately;
- the body is read through a stream reader and **cancelled** the moment the running total
  crosses 8 MB, so a lying `content-length` cannot exhaust memory;
- the blob is converted with `FileReader.readAsDataURL`.

## 6. Full size and download

`RichBody.tsx:7` — clicking or pressing Enter on a loaded image opens a native `<dialog>`
containing the image at its real dimensions, with *Close image* and *Download image*.

`downloadInlineImage()` (`media/download-image.ts:20`) reuses the same authenticated loader, so
what is saved is exactly what is displayed:

1. `loadInlineImage()` → a data URL.
2. Strict re-validation: `^data:(image/(png|jpeg|gif|webp|avif));base64,…$`. Anything else is
   refused with *"This image format cannot be downloaded. Open it in the original email."*
3. Decode to bytes and hand to `saveFile()`.

**No screenshot, no canvas re-encode, no resize** — the original raster bytes are saved.

`imageDownloadName()` (`:6`) picks a name in this order: an `alt` that already looks like a
filename → the source's own filename → the alt text → `inline-image`; then sanitises it for the
filesystem (control characters, `<>:"/\|?*`, leading/trailing dots and spaces, 100 characters)
and appends the extension of the mime type **actually returned**, not the one the URL claimed.

Downloading is available in **both** the production and development builds.

## 7. In exports

`media/images.ts:34`, `:70`

| Mode | Behaviour |
|---|---|
| `embedImages()` | every image becomes a `data:` URI; a running total stops at **50 MB**; each failure leaves an inline note beside the picture and a summary line in the overview |
| `stripImages()` | every image becomes a `<span class="image-placeholder">` naming the file — the source's own filename where it has one, else `image-1.png` derived from the mime type — plus a summary line. The file holds no picture bytes and no provider URLs |

Since 1.7.2 the panel only offers the stripped forms (text-only and masked). An exported file is
therefore a few kilobytes, opens identically offline, and cannot leak an expiring provider URL.
A masked copy never embeds pictures at all — a picture can show a face, a signature or a
letterhead.

## 8. Pictures as identity

`imageKeys()` ([04](04-reconciliation-and-ordering.md#3-pictures-as-evidence)) treats a picture
as evidence when deciding whether two copies are one message, and
`foldImageSource()` ([08](08-exports-and-diagnostics.md)) preserves exactly that evidence in a
diagnostic capture while dropping the bytes. The three modules are deliberately consistent: what
counts as "the same picture" is decided in one place and reused everywhere.

## 9. Limits

- 8 MB per image; 2 fetches at a time; 15 s timeout.
- `cid:` images with no provider data behind them cannot be resolved and are shown as
  unavailable — that is a fact about the email, not a bug.
- Expired provider links, images removed by the sender and tenant-restricted resources remain
  visibly unavailable, with the reason in the caption.
- Displaying an HTTPS image contacts that image's host. There is no ThreadLens server in the
  path, and `referrerpolicy="no-referrer"` means the host is not told which email it is in.

**Next:** [06 · Attachments](06-attachments.md)
