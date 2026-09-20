import { afterEach, expect, it, vi } from 'vitest';
import { downloadInlineImage, imageDownloadName } from '../src/side-panel/media/download-image';
import { loadInlineImage } from '../src/side-panel/media/images';
import { saveFile } from '../src/side-panel/export/download';
vi.mock('../src/side-panel/media/images', async importOriginal => {
  const original = await importOriginal<typeof import('../src/side-panel/media/images')>();
  return { ...original, loadInlineImage: vi.fn() };
});
vi.mock('../src/side-panel/export/download', () => ({ saveFile: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each([
  ['https://mail.google.com/chart.png', 'image.jpg', 'image/png', 'image.png'],
  ['https://mail.google.com/quarter%20one.jpeg?token=secret', 'Inline image', 'image/jpeg', 'quarter-one.jpg'],
  ['data:image/webp;base64,YQ==', 'Stock chart', 'image/webp', 'Stock chart.webp'],
  ['blob:https://mail.google.com/123', 'Inline image', 'image/png', 'inline-image.png'],
  ['data:image/png;base64,YQ==', '../report:one?.png', 'image/png', '-report-one-.png'],
])('uses a safe filename and the real image format: %s', (src, alt, mime, name) => {
  expect(imageDownloadName(src, alt, mime)).toBe(name);
});
it('saves the exact resolved bytes and forwards the original tab for authenticated images', async () => {
  vi.mocked(loadInlineImage).mockResolvedValue('data:image/png;base64,AAEC/w==');
  await downloadInlineImage('blob:https://mail.google.com/image', 'Chart', 42);
  expect(loadInlineImage).toHaveBeenCalledWith('blob:https://mail.google.com/image', 42);
  const [filename, blob] = vi.mocked(saveFile).mock.calls[0];
  expect(filename).toBe('Chart.png'); expect(blob.type).toBe('image/png');
  const encoded = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
  expect(encoded).toBe('data:image/png;base64,AAEC/w==');
});
it('does not start a download when image access fails', async () => {
  vi.mocked(loadInlineImage).mockRejectedValue(new Error('Image exceeds 8 MB.'));
  await expect(downloadInlineImage('https://mail.google.com/large.png', '')).rejects.toThrow('Image exceeds 8 MB.');
  expect(saveFile).not.toHaveBeenCalled();
});
it('rejects an unexpected image payload without downloading it', async () => {
  vi.mocked(loadInlineImage).mockResolvedValue('data:text/html;base64,YQ==');
  await expect(downloadInlineImage('https://mail.google.com/image', '')).rejects.toThrow('format cannot be downloaded');
  expect(saveFile).not.toHaveBeenCalled();
});
