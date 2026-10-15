/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 8: at 412 px the Accounts table (425 px wide inside a 386 px
 *                     |                             | card) cut its Balance column at the card edge ('BALANC', '$11' for
 *                     |                             | $110). In real Chromium at 412 x 915, the page's own stylesheet and
 *                     |                             | renderAccounts: the table fits its card, every Balance shows whole,
 *                     |                             | and the institution still reads under the account name; at desktop
 *                     |                             | width the Institution column is unchanged.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for playwright. Run locally:
 *   OSHAL_CORE_DIR=<framework checkout> node --test tests/accounts-phone.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, '..', 'tools', 'finance.html'), 'utf8');
const core = process.env.OSHAL_CORE_DIR || process.env.OSHAL_CORE_ROOT || process.env.OSHAL_FRAMEWORK;
if (!core) throw new Error('harness:oshal-core-root is required: set OSHAL_CORE_DIR, OSHAL_CORE_ROOT or OSHAL_FRAMEWORK to a framework checkout with playwright');
const { chromium } = createRequire(path.join(core, 'package.json'))('playwright');

const STYLE = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const MONEY = HTML.match(/^const money = .*$/m)[0];
const RENDER = HTML.match(/^function renderAccounts\(a, cur\) \{[\s\S]*?\n\}/m)[0];
const ACCOUNTS = { accounts: [
  { name: 'Plaid Checking', mask: '0000', institution: 'First Platypus Bank', subtype: 'checking', balance: 110 },
  { name: 'Plaid Saving', mask: '1111', institution: 'First Platypus Bank', subtype: 'savings', balance: 210 },
  { name: 'Plaid Credit Card', mask: '3333', institution: 'First Platypus Bank', subtype: 'credit card', balance: 410 },
  { name: 'Plaid Money Market', mask: '4444', institution: 'First Platypus Bank', subtype: 'money market', balance: 43200 },
  { name: 'Plaid CD', mask: '2222', institution: 'First Platypus Bank', subtype: 'cd', balance: 1000 },
] };

async function measure(width) {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width, height: 915 } })).newPage();
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body><div class="page" id="root"></div></body></html>`);
    await page.evaluate(([money, render, data]) => {
      const fn = new Function('data', `${money}\n${render}\nreturn renderAccounts(data, 'USD');`);
      document.getElementById('root').innerHTML = fn(data);
    }, [MONEY, RENDER, ACCOUNTS]);
    return await page.evaluate(() => {
      const panel = document.querySelector('.panel');
      const pr = panel.getBoundingClientRect();
      const inner = pr.right - parseFloat(getComputedStyle(panel).paddingRight);
      const cells = [...document.querySelectorAll('table.accounts th.num, table.accounts td.num')];
      return {
        tableWidth: document.querySelector('table.accounts').getBoundingClientRect().width,
        panelInner: inner - pr.left - parseFloat(getComputedStyle(panel).paddingLeft),
        balanceCut: cells.filter((c) => c.getBoundingClientRect().right > inner + 0.5 || c.scrollWidth > c.clientWidth).map((c) => c.textContent),
        balances: cells.map((c) => c.textContent),
        instColumnShown: getComputedStyle(document.querySelector('th.acct-inst')).display !== 'none',
        instLine: [...document.querySelectorAll('.acct-inst-line')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.textContent),
      };
    });
  } finally { await browser.close(); }
}

test('at 412 px every Balance shows whole inside its card and the institution reads under the name', async () => {
  const m = await measure(412);
  assert.ok(m.tableWidth <= m.panelInner + 0.5, `table ${m.tableWidth}px must fit the card's ${m.panelInner}px`);
  assert.deepEqual(m.balanceCut, []);
  assert.deepEqual(m.balances, ['Balance', '$110', '$210', '$410', '$43,200', '$1,000']);
  assert.equal(m.instColumnShown, false);
  assert.equal(m.instLine.length, 5);
  assert.equal(m.instLine[0], 'First Platypus Bank');
});

test('at desktop width the Institution column is unchanged', async () => {
  const m = await measure(1280);
  assert.equal(m.instColumnShown, true);
  assert.deepEqual(m.instLine, []);
  assert.deepEqual(m.balanceCut, []);
});
