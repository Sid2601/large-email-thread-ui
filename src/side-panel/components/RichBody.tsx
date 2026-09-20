import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { highlightedEmailHtml } from './email-markup';
import { loadInlineImage } from '../media/images';
import { downloadInlineImage } from '../media/download-image';

function ImageViewer({ src, alt, tabId, close }: { src: string; alt: string; tabId?: number; close: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setDownloading(true); setError('');
    try { await downloadInlineImage(src, alt, tabId); }
    catch (error) { setError(error instanceof Error ? `Could not download image. ${error.message}` : 'Could not download image. Please try again.'); }
    finally { setDownloading(false); }
  }
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="image-viewer" onClose={close} aria-label="Full-size image">
    <div className="image-actions">
      <button type="button" onClick={() => dialog.current?.close()}>Close image</button>
      <button type="button" onClick={() => void download()} disabled={downloading} aria-busy={downloading}>{downloading ? 'Downloading…' : 'Download image'}</button>
    </div>
    {error && <p role="alert" className="image-error">{error}</p>}
    <div className="image-original"><img src={src} alt={alt} /></div>
  </dialog>, document.body);
}
export const RichBody = memo(function RichBody({ html, query = '', tabId }: { html: string; query?: string; tabId?: number }) {
  const markup = useMemo(() => highlightedEmailHtml(html, query), [html, query]);
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<{ src: string; alt: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const imgs = Array.from(root.current?.querySelectorAll('img') ?? []);
    const fail = (img: HTMLImageElement) => {
      if (!alive || img.dataset.failed) return;
      img.dataset.failed = 'true';
      const caption = document.createElement('span'); caption.className = 'image-error';
      caption.textContent = `Image unavailable: ${img.alt}. Open the original email to check access.`;
      img.after(caption);
    };
    const load = (img: HTMLImageElement) => {
      const src = img.dataset.tlImageSrc;
      if (!src) return;
      void loadInlineImage(src, tabId).then(data => { if (alive) img.src = data; }, () => fail(img));
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { load(entry.target as HTMLImageElement); observer.unobserve(entry.target); }
    }, { rootMargin: '200px' });
    const handlers = imgs.map(img => {
      img.title = 'Click to view full-size image'; img.tabIndex = 0; img.setAttribute('role', 'button');
      img.setAttribute('aria-label', `View image: ${img.alt}`);
      const open = () => { if (img.naturalWidth) setExpanded({ src: img.currentSrc || img.src, alt: img.alt }); };
      const key = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
      const error = () => {
        // Retry authenticated image links through the extension's host access.
        if (img.dataset.retried) { fail(img); return; }
        img.dataset.retried = 'true';
        void loadInlineImage(img.src, tabId).then(data => { if (alive) img.src = data; }, () => fail(img));
      };
      img.addEventListener('click', open); img.addEventListener('keydown', key); img.addEventListener('error', error);
      if (img.dataset.tlImageSrc) observer.observe(img);
      else if (img.complete && !img.naturalWidth) error();
      return () => { img.removeEventListener('click', open); img.removeEventListener('keydown', key); img.removeEventListener('error', error); };
    });
    return () => { alive = false; observer.disconnect(); handlers.forEach(cleanup => cleanup()); };
  }, [markup, tabId]);
  return <><div ref={root} className="text-sm email-body" dangerouslySetInnerHTML={{ __html: markup }} />{expanded && <ImageViewer {...expanded} tabId={tabId} close={() => setExpanded(null)} />}</>;
});
