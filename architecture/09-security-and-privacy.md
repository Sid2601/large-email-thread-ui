# 09 · Security and privacy

**Source:** `manifest.json`, `src/content/scraper-utils.ts:124`–`:183`,
`src/shared/images.ts`, `src/side-panel/storage/attachments.ts:53`,
`src/background/service-worker.ts`

ThreadLens reads the most sensitive content most people have. This document states what it is
allowed to do, what stops it doing anything else, and where the honest limits are.

---

## 1. The product guarantees

1. **No backend.** There is no ThreadLens server, no account, no sync, no telemetry, no
   analytics and no AI service. Mail content is never sent anywhere.
2. **The only network requests are to the reader's own provider**, for pictures and files in
   the conversation they are looking at, authorised by their existing browser session.
3. **The only thing written to disk is an attachment the reader explicitly saved.** Everything
   else lives in `chrome.storage.session`, which never reaches disk and is cleared when Chrome
   exits.
4. **Nothing executes.** Email HTML is rewritten through an allowlist before it is ever
   rendered, and parsing happens in an inert document that cannot load a resource.

---

## 2. Permissions, and why each is needed

`manifest.json`

| Permission | Why | What it would mean if it were absent |
|---|---|---|
| `activeTab` | resolve which tab the panel is showing | the panel could not scope a thread to a tab |
| `storage` | `chrome.storage.session` per tab | mail would have to live somewhere more permanent |
| `sidePanel` | the UI surface | — |
| `offscreen` | an inert `DOM_PARSER` document | parsing would have to run inside Gmail's main thread |
| host: the four mail origins | inject the reader; fetch attachments | no extraction, no file retrieval |
| host: `*.googleusercontent.com` | Gmail's image proxy | proxied inline images could not be displayed |

**Not requested**, deliberately: `downloads` (files are saved with an `<a download>` in the
panel), `tabs` beyond `activeTab`, `cookies`, `webRequest`, `<all_urls>`, and any
`externally_connectable` entry.

`minimum_chrome_version: 116` is set by the side panel and offscreen APIs.

Extension pages run under

```
script-src 'self'; object-src 'self'; img-src 'self' https: data: blob:;
```

so no inline script and no remote script can run in the panel, whatever an email contains.

---

## 3. Trust boundaries

```
Provider page (untrusted content, provider origin)
   │  MessageSnapshot — strings only, no DOM, no functions
   ▼
Service worker (extension origin) — routes; validates the sender of READ_PAGE_IMAGE
   ▼
Offscreen document (extension origin, inert DOM) — parses; nothing loads, nothing runs
   │  ThreadData — sanitised HTML only
   ▼
Side panel (extension origin, strict CSP) — renders
```

Everything that crosses a boundary is a plain structured-cloneable value. Email markup crosses
exactly once, as a string, and is sanitised before it is ever inserted into a live document.

---

## 4. HTML sanitisation — `scraper-utils.ts:139`

Every fragment that reaches the panel — a message body, a quoted variant, an export — goes
through `sanitizeEmailHtml()`, and `RichBody` re-sanitises on every render
(`email-markup.ts:6`). Parsing is done with `DOMParser` into a **detached, inert** document; at
no point is untrusted markup assigned to a live node.

**Removed outright:** `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `button`,
`link`, `meta`, `svg`, `math`.

**Tag allowlist** (`:124`): `p div br b i strong em u s a ul ol li table tr td th thead tbody
tfoot pre code blockquote span h1–h6 hr`, plus `img` handled separately. Anything else is
**unwrapped**, not deleted — the text inside an unknown tag is kept.

**Attributes:** every attribute is stripped from every element, then a narrow set is restored:

| Element | Restored |
|---|---|
| any | `style`, containing only allowlisted properties |
| `a` | `href` (via `safeLink()`), `target="_blank"`, `rel="noopener noreferrer"` |
| `td`, `th` | `colspan`, `rowspan` — only if 1–3 digits |
| `ol` | `start` — only if 1–5 digits |
| `img` | see [05](05-inline-images.md#4-rewriting--sanitizeemailhtml) |

**Style allowlist** (`:128`): colour, background-colour, font-weight, font-style,
text-decoration, text-align, vertical-align, white-space, and border/padding properties. Each
value is additionally rejected if it contains `url`, `expression`, `var(`, `@`, `<`, `>` or `\`
(`:172`) — no remote resource can be pulled in through CSS, and no layout property can be used
to cover the surrounding UI.

**Links** (`:132`): parsed with `URL`; only `https:`, `http:` and `mailto:` survive. Everything
else — `javascript:`, `data:`, `file:`, `vbscript:` — returns `''` and the element keeps its
text without becoming a link.

**Empty quote shells** left behind by a segment that ended at a nested quote are removed
innermost-first (`:146`), so a deep thread does not render a column of bare indent rules.

---

## 5. Image handling

Covered fully in [05](05-inline-images.md). The security-relevant parts:

- `safeImageSource()` is the **single gate** every image address in the product passes through.
- SVG data payloads are refused: only `png`, `jpeg`, `gif`, `webp` and `avif` are accepted, as
  data URLs *and* as fetched responses (`rasterMime()`).
- 1–2 px images are removed as tracking pixels.
- `referrerpolicy="no-referrer"` on every image, so an image host is never told which email it
  appears in.
- 8 MB per image, enforced against both the declared `content-length` **and** the actual stream.
- A `blob:` may only be read when the service worker confirms the request came from the side
  panel page, **and** the mail page confirms that exact blob is displayed in the thread.

---

## 6. Network egress, exhaustively

| Request | Origin of the request | When |
|---|---|---|
| inline image, `https:` | side panel | the picture scrolls into view, or a first attempt failed |
| inline image, `blob:` | mail tab | as above, via the round trip |
| attachment | side panel | the reader presses *Save locally* |

That is the complete list. Both use `credentials: 'include'` — the reader's own session
authorises the fetch — and both are host-restricted: images by `safeImageSource()`, attachments
by `attachmentUrl()`'s four-host allowlist, re-checked after redirects. There is no background
fetching, no prefetching and no beaconing.

---

## 7. Data residency and lifetime

| Data | Where | Cleared when |
|---|---|---|
| Parsed thread | `chrome.storage.session`, keyed `thread:<tabId>` | the tab navigates or closes; Chrome exits |
| Parser cache | offscreen document memory | session/thread changes; tab closes (`PARSER_DROP`) |
| Reader snapshots | content script `WeakMap` | navigation; the element is collected |
| Inline image data | panel memory, ≤16 entries | the panel closes |
| Saved attachments | IndexedDB `threadlens-attachments` | the reader removes them, storage is cleared, or the extension is uninstalled |
| Exports | wherever the reader saved them | their problem from then on — which is why they carry their own notices |

The legacy persistent `currentThread` entry from an earlier version is deleted on every startup
(`service-worker.ts:5`).

---

## 8. Threat model

**Assumed hostile: the email itself.** Every message is attacker-controlled content, and the
whole sanitisation chain exists for that. Scripts, remote CSS, forms, tracking pixels, unsafe
protocols and oversized payloads are all handled above.

**Assumed hostile: other pages in the browser.** The two sensitive endpoints validate their
caller: `READ_PAGE_IMAGE` checks the sender's URL is the side panel, and `READ_BLOB_IMAGE`
checks the blob belongs to the page and is actually on screen. `CAPTURE_THREAD_SOURCE` does not
exist at all in production.

**Not defended against, and stated as such:**

- A compromised browser profile or a malicious extension with broader permissions.
- The provider itself, which already has the mail.
- A reader who exports a thread and sends it to the wrong person. This is why the masked copy
  exists, why it is checked, and why the file says what it is.

---

## 9. What "masked" does and does not promise

See [08](08-exports-and-diagnostics.md#26-the-honest-limit). Briefly: every address, name, name
part, capitalised short form, company domain, phone number, long reference number, link, message
id and attachment name is replaced by a consistent placeholder, and the map exists only while
the file is being written. A nickname sharing no opening letters, an identity written only
inside a picture, and a company named in prose but never in an address can survive. It is a
strong default, not a guarantee, and the product says so in the panel and in the file.

---

## 10. Privacy-relevant behaviours worth knowing

- Displaying an HTTPS image contacts that image's host. That is what displaying an image is; it
  happens on demand rather than on load, and never with a referrer.
- `Read collapsed emails` clicks Gmail's own control, which causes Gmail to load those bodies —
  a visible, requested action, with `Collapse emails again` to reverse it.
- The signed-in address is read only to decide which bubbles are the reader's own and where they
  joined the thread. It is never transmitted, and in a masked export it becomes a placeholder
  like anyone else.

**Next:** [10 · Build, test and release](10-build-test-release.md)
