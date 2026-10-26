// File export with graceful fallbacks:
// 1. Inside a Claude artifact viewer with the downloads capability: viewer-confirmed save.
// 2. A normal browser (Netlify deploy): Blob download.
// 3. Otherwise: copy to clipboard.
let downloads = null;
let checked = false;
async function cap() {
  if (checked) return downloads;
  checked = true;
  try { if (window.claude?.use) downloads = await Promise.race([window.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 1500))]); } catch { downloads = null; }
  return downloads;
}
const framed = () => { try { return window.self !== window.top; } catch { return true; } };

/** @returns {Promise<'saved'|'downloaded'|'copied'|'declined'>} */
export async function exportText(filename, text, mime = 'text/csv') {
  const d = await cap();
  if (d) {
    try { await d.save({ filename, data: text }); return 'saved'; } catch (e) { if (e?.code === 'declined') return 'declined'; }
  }
  if (!framed()) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
export const EXPORT_MSG = { saved: 'File saved', downloaded: 'Download started', copied: 'Downloads are blocked here, so the data was copied to your clipboard', declined: 'Export cancelled' };
