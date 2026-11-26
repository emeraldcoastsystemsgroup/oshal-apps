/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The live check of the résumé for upload forms (tests/career-parse-resume-live-proof.mjs) is itself checked. Its run on blue on 2026-11-25 read every job back exactly at both sizes and still exited 1 with "the page tried a write: POST /api/cockpit/recents": the cockpit records the application a person opens (cockpit-view-controller.js, RP-SHL-01), a platform write that is not Career's, and the check stopped it as one of Career's. In Chromium against a loopback listener, the check's own guard lets reads, the sign-in and the cockpit's recents through and stops and lists every other write, Career's included; its judgement fails a size that tried one of those and passes a size that did not.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { guard, judge } from './career-parse-resume-live-proof.mjs';
import { playwright } from './helpers/ux-page.mjs';

const seen = [];
let server, origin, browser;
before(async () => {
  server = http.createServer((req, res) => {
    seen.push(`${req.method} ${new URL(req.url, 'http://x').pathname}`);
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>stand-in</title>'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright().chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server.close(resolve)); });

/** Each request the page makes, in order, through the check's guard; what reached the listener and what was stopped. */
async function through(requests) {
  const context = await browser.newContext(), row = { stopped: [] };
  try {
    await guard(context, origin, row);
    const page = await context.newPage();
    await page.goto(origin + '/');
    seen.length = 0;
    const answered = await page.evaluate(async (list) => {
      const out = [];
      for (const [method, where] of list) out.push(await fetch(where, { method, body: method === 'GET' ? undefined : '{}' }).then(() => 'answered', () => 'stopped'));
      return out;
    }, requests);
    return { row, answered, reached: [...seen] };
  } finally { await context.close(); }
}

test('the guard lets reads, the sign-in and the cockpit recents through, and stops every other write', async () => {
  const { row, answered, reached } = await through([
    ['GET', '/api/career-hunter/board-native'], ['POST', '/sessions'], ['POST', '/api/cockpit/recents'],
    ['POST', '/api/career-hunter/jobs/7/status'], ['DELETE', '/api/career-hunter/jobs/7/packet'], ['PUT', '/api/cockpit/recents']]);
  assert.deepEqual(answered, ['answered', 'answered', 'answered', 'stopped', 'stopped', 'stopped']);
  assert.deepEqual(reached, ['GET /api/career-hunter/board-native', 'POST /sessions', 'POST /api/cockpit/recents']);
  assert.deepEqual(row.stopped, ['POST /api/career-hunter/jobs/7/status', 'DELETE /api/career-hunter/jobs/7/packet', 'PUT /api/cockpit/recents']);
});

test('a size fails on a write the guard stopped and passes when the only write was the cockpit recents', async () => {
  const job = { id: 7, company: 'Example Logistics', title: 'Operations Manager', experience: [['Dispatch Lead', 'Northwind Haulage', '2012 to 2016']] };
  const size = (stopped) => ({ button: 'For upload forms (.docx)', sideways: false, fileName: 'Example Logistics - Operations Manager - Job 7 - Resume (for upload).docx',
    faults: [], roles: [{ title: 'Dispatch Lead', company: 'Northwind Haulage', start: '2012', end: '2016' }], stopped, failures: [] });
  const opened = size((await through([['POST', '/api/cockpit/recents']])).row.stopped);
  judge(opened, job);
  assert.deepEqual(opened.failures, []);
  const wrote = size((await through([['POST', '/api/cockpit/recents'], ['POST', '/api/career-hunter/jobs/7/status']])).row.stopped);
  judge(wrote, job);
  assert.deepEqual(wrote.failures, ['the page tried a write: POST /api/career-hunter/jobs/7/status']);
});
