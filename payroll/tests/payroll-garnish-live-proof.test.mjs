/**
 * The live proof's own logic, held to the real page and the real calendar.
 *
 * The first run of payroll-garnish-live-proof.mjs on blue (kernel 4f780d36,
 * 2026-11-20 19:36Z) failed three ways, all in the proof and none in Payroll:
 *
 *  - it read the refusal off the message line before the refused save had
 *    answered (the save WAS refused: three posts, two orders listed);
 *  - it looked the run up by the pay date it asked for, 2026-06-19, which is
 *    Juneteenth, a Federal Reserve closure, so Payroll had rightly stored the run
 *    on 2026-06-18 and the lookup found nothing ("reading 'run_id'");
 *  - on a phone it looked for Run payroll under More, but Run payroll is in the
 *    bottom bar (a 30-second click timeout).
 *
 * These checks fail if the proof again hard-codes a pay date, a due date, a
 * navigation path or a refusal wording that the package does not produce. They
 * read the package's compiled calendar and garnishment modules and its served
 * page, and they run nothing against a kernel. Like payroll-backlog-queue, this
 * guards repository tooling rather than installed behaviour, so it runs in store
 * CI and is not an AI Test Lab case.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Regression guard for the three proof defects found on blue: the run is found by its period and its stored pay date, reason and due date come from the calendar module; navigation follows the page's own buttons; the refusal wording is the package's; a cockpit-shell write is not counted as Payroll's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const proof = await import('./payroll-garnish-live-proof.mjs');
const { orderFactsFromInput } = require('../routes/payroll-garnish.js');
const html = readFileSync(path.join(here, '..', 'tools', 'payroll.html'), 'utf8');

test('importing the proof runs nothing; it exports the parts the check uses', () => {
  for (const name of ['SIZES', 'REFUSAL', 'expectedRun', 'findRun', 'navSteps', 'payrollStopped']) {
    assert.ok(name in proof, `${name} is exported`);
  }
  assert.equal(process.exitCode, undefined, 'no mode ran on import');
});

test('THE DEFECT: the Juneteenth pay date is stored on the banking day before, and the proof expects that', () => {
  // K.8 2026: Juneteenth, Friday June 19, is a Reserve Bank closure → the banking day before is Thursday June 18.
  // A monthly depositor's June liability is due Wednesday July 15, 2026 (no legal holiday).
  const first = proof.expectedRun(proof.SIZES[0]);
  assert.equal(proof.SIZES[0].payDate, '2026-06-19');
  assert.deepEqual([first.payDate, first.shifted, first.due], ['2026-06-18', true, '2026-07-15']);
  assert.match(first.reason, /Juneteenth National Independence Day — Federal Reserve Banks are closed.*Moved to 2026-06-18/);
  // Thursday July 2, 2026 is a banking day (the IRS observes July 3, the Reserve Banks do not close).
  // July liability is due the 15th of August, a Saturday → Monday August 17.
  const second = proof.expectedRun(proof.SIZES[1]);
  assert.deepEqual([second.payDate, second.shifted, second.due], ['2026-07-02', false, '2026-08-17']);
});

test('the run is found by its period, whatever date it was stored on', () => {
  const runs = [
    { run_id: 'a', period_start: '2026-06-01', period_end: '2026-06-14', pay_date: '2026-06-18' },
    { run_id: 'b', period_start: '2026-06-15', period_end: '2026-06-28', pay_date: '2026-07-02' },
  ];
  assert.equal(proof.findRun(runs, proof.SIZES[0]).run_id, 'a');
  assert.equal(proof.findRun(runs, proof.SIZES[1]).run_id, 'b');
  assert.equal(proof.findRun([], proof.SIZES[0]), null, 'a missing run is named, never read as undefined');
});

test("navigation follows the page's own buttons: Run payroll in the phone's bottom bar, Pay & file under More", () => {
  assert.deepEqual(proof.navSteps('runs', false, html), ['#tab-runs']);
  assert.deepEqual(proof.navSteps('runs', true, html), ['.phone-nav-btn[data-phone-tab="runs"]']);
  assert.deepEqual(proof.navSteps('filing', true, html), ['#phoneMoreBtn', '.more-sheet-item[data-more-tab="filing"]']);
  // Every selector the proof clicks exists on the served page.
  const present = (selector) => {
    const id = /^#([\w-]+)$/.exec(selector);
    if (id) return html.includes(`id="${id[1]}"`);
    const attr = /^\.([\w-]+)\[([\w-]+)="([\w-]+)"\]$/.exec(selector);
    return Boolean(attr) && new RegExp(`class="${attr[1]}[^"]*"[^>]*${attr[2]}="${attr[3]}"`).test(html);
  };
  for (const tab of ['runs', 'filing']) {
    for (const touch of [false, true]) {
      for (const selector of proof.navSteps(tab, touch, html)) assert.ok(present(selector), `${selector} is on the page`);
    }
  }
});

test("the refusal the proof waits for is the package's own wording", () => {
  const refused = orderFactsFromInput('GARN_SUPPORT', { amountCents: 30_000, servedOn: '2026-05-04' });
  assert.match(refused.message, proof.REFUSAL);
});

test("a write the cockpit shell makes is listed, but is not counted as Payroll's", () => {
  const stopped = ['POST /api/cockpit/recents (from /cockpit/)', 'POST /api/payroll/runs/r1/void (from /api/payroll/)'];
  assert.deepEqual(proof.payrollStopped(stopped), ['POST /api/payroll/runs/r1/void (from /api/payroll/)']);
});
