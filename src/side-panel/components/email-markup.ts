import { sanitizeEmailHtml } from '../../content/scraper-utils';

/** Highlight text nodes only so searching never destroys tables or links. */
export function highlightedEmailHtml(html: string, query: string): string {
  const root = new DOMParser().parseFromString('', 'text/html').createElement('div');
  root.innerHTML = sanitizeEmailHtml(html);
  if (!query.trim()) return root.innerHTML;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const value = node.data, lower = value.toLowerCase(), needle = query.toLowerCase();
    const fragment = document.createDocumentFragment();
    let start = 0, match: number;
    while ((match = lower.indexOf(needle, start)) >= 0) {
      fragment.append(value.slice(start, match));
      const mark = document.createElement('mark');
      mark.textContent = value.slice(match, match + query.length);
      fragment.append(mark); start = match + query.length;
    }
    fragment.append(value.slice(start)); node.replaceWith(fragment);
  }
  return root.innerHTML;
}
