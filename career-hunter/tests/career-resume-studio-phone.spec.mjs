/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6 (workspace Resume Studio tab at 412 px): the resume select ran past the right edge (right=487 in a 412 viewport, arrow hidden) and the chat placeholder was clipped mid-line. The shipped page, opened in headless Chromium at 412x915 with a long resume name in the select, keeps the select and the page inside the viewport and shows the composer's placeholder whole.
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

test('at 412 px the resume select and the page stay inside the viewport, and the placeholder shows whole', async (t) => {
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
    document.querySelector('#msg').disabled = false;
  });
  const m = await tab.evaluate(() => {
    const s = document.querySelector('#pick').getBoundingClientRect();
    const ta = document.querySelector('#msg');
    const probe = document.createElement('div');
    const cs = getComputedStyle(ta);
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', width: ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 'px', font: cs.font, lineHeight: cs.lineHeight, whiteSpace: 'pre-wrap' });
    probe.textContent = ta.placeholder;
    document.body.append(probe);
    const need = probe.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { right: s.right, width: s.width, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, taH: ta.clientHeight, need };
  });
  assert.ok(m.right <= m.cw, `select right edge ${m.right} past the ${m.cw} px viewport`);
  assert.ok(m.sw <= m.cw, `page scrolls sideways: ${m.sw} > ${m.cw}`);
  assert.ok(m.taH >= m.need - 1, `placeholder needs ${m.need} px, composer shows ${m.taH}`);
});
