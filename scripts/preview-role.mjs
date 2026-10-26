// Helpers for scripts that drive the static preview build (dist/preview.html).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export const previewUrl = pathToFileURL(resolve('dist/preview.html')).href;
/** Enter the preview as a role (optionally a specific sample profile) and wait for the app. */
export async function previewAs(page, role, ref = null) {
  await page.evaluate(([r, a]) => sessionStorage.setItem('avgenx-preview-identity', JSON.stringify({ role: r, ref: a })), [role, ref]);
  await page.reload();
  await page.waitForSelector('#nav a');
}
