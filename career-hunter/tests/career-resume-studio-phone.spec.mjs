/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6 (workspace Resume Studio tab at 412 px): the resume select ran past the right edge (right=487 in a 412 viewport, arrow hidden) and the chat placeholder was clipped mid-line. The shipped page, opened in headless Chromium at 412x915 with a long resume name in the select, keeps the select and the page inside the viewport and shows the composer's placeholder whole.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: on a phone the Resume Editor is a sheet opened from "Edit with AI", so the placeholder is measured with it open.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 12: the editor panel is hidden until a résumé exists, which the page's script marks on its body; this layout check serves no script, so it marks one itself before measuring the editor.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-16: every chat surface is the core Jarvis chat window): the page has no résumé editor of its own, so there is no composer placeholder to measure and no Send beside the shell's floating assistant (Career's concierge is the chat; tests/career-hunter-one-chat-window.test.mjs measures it at 412 and 1440). The select and the page stay inside 412 px, and the page draws no editor panel, text box or Send.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for playwright. Run locally:
 *   OSHAL_CORE_DIR=<core checkout> node --test tests/career-resume-studio-phone.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CORE = process.env.OSHAL_CORE_DIR;
const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'career-resume-studio.html'), 'utf8')
  // The layout under test is the page's own markup and CSS; its scripts and shared stylesheets are not served here.
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');

test('at 412 px the resume select and the page stay inside the viewport, and the page draws no chat of its own', async (t) => {
  assert.ok(CORE, 'OSHAL_CORE_DIR must name a core checkout with playwright (refusing rather than skipping)');
  const { chromium } = createRequire(path.join(CORE, 'package.json'))('playwright');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const tab = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await tab.setContent(page);
  await tab.evaluate(() => {
    const o = document.createElement('option');
    o.textContent = 'Senior Platform Reliability Engineer — Northwind Logistics International (tailored 2026-10-11)';
    document.querySelector('#pick').append(o);
    document.querySelector('#pick').value = o.value;
    document.body.dataset.resume = 'ready'; // the page's script, not served here, marks a résumé
  });
  const m = await tab.evaluate(() => {
    const s = document.querySelector('#pick').getBoundingClientRect();
    return { right: s.right, width: s.width, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      own: ['.chat', '#log', '#msg', '#send'].filter((selector) => document.querySelector(selector)) };
  });
  assert.ok(m.right <= m.cw, `select right edge ${m.right} past the ${m.cw} px viewport`);
  assert.ok(m.sw <= m.cw, `page scrolls sideways: ${m.sw} > ${m.cw}`);
  assert.deepEqual(m.own, [], 'Career\'s concierge is the page\'s chat; it draws none of its own');
});
