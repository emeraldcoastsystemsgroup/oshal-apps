/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0: pictures of the first screen with one device's details open, at desktop and phone size, over the stand-in server (set OSHAL_KERNEL_ROOT to a kernel checkout for the real styles, OUT_DIR for where the pictures go). For the person checking the look; the assertions are in phone-control-home-tree.test.mjs.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../../scripts/toolchain/noop.js'))('playwright');
const port = 4600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [join(here, 'standin-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
try {
  const browser = await chromium.launch();
  for (const [width, height] of [[1280, 900], [412, 915]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    for (let i = 0; i < 40; i += 1) { try { await page.goto(`http://127.0.0.1:${port}/api/phone-control/ui`, { waitUntil: 'networkidle' }); break; } catch { await new Promise((done) => setTimeout(done, 250)); } }
    await page.locator('#computerRail .pc-rail-item').first().waitFor();
    await page.locator('li[data-entry]', { hasText: process.env.DEVICE || 'Fire TV' }).last().getByRole('button', { name: /^Details of/ }).click();
    const picture = join(process.env.OUT_DIR || tmpdir(), `phone-control-details-${width}.png`);
    await page.screenshot({ path: picture, fullPage: true }); console.log(picture);
    await page.close();
  }
  await browser.close();
} finally { server.kill(); }
