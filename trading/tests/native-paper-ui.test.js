/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shipped tools/ui/native-paper.js tells armed and scheduled apart: an armed book whose
 *   paper-autopilot job is not active shows "armed, not scheduled" with an Activate button (never "autopilot on" and only
 *   Stop), an armed and active one shows "autopilot on" with Stop; Start arms the book and then activates the person's own
 *   job with class person through the kernel's schedule API, and a job already active is not activated twice.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ui', 'native-paper.js'), 'utf8');
const SCHEDULE = { app: 'intelligent-trades', name: 'paper-autopilot', route: '/api/trading/paper/tick' };

/** One element with the few properties the module touches. */
function element(id, attrs = {}) {
  return { id, className: attrs.className || '', textContent: attrs.text || '', attrs: { ...attrs.data },
    getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = String(v); } };
}

/**
 * Load the shipped classic script in a context with the page globals it reads (STATUS, $, api, jbody, render) and a
 * recording fetch that answers the kernel's schedule API from `row`.
 */
function page({ armed, row }) {
  const btn = element('npBtn', { data: { 'data-np': armed ? 'stop' : 'start' } });
  const msg = element('npMsg');
  const pill = element('', { className: 'pill ok', text: 'autopilot on' });
  const kind = element('', { className: 'pill', text: 'paper' });
  const header = { querySelector: (sel) => (sel === '#npBtn' ? btn : null), querySelectorAll: () => [kind, pill],
    addEventListener() {} };
  const requests = [];
  const ctx = {
    STATUS: { nativePaper: { available: true, opened: true, armed, schedule: SCHEDULE } },
    RENDER_TOKEN: 0, rendered: 0,
    $: (id) => (id === 'npMsg' ? msg : null),
    jbody: (method, body) => ({ method, body: JSON.stringify(body) }),
    api: async (p, opts) => { requests.push(['api', p, opts && opts.method]); return { ok: true, armed: true, schedule: SCHEDULE }; },
    fetch: async (p, opts) => {
      requests.push(['kernel', p, (opts && opts.method) || 'GET', opts && opts.body ? JSON.parse(opts.body) : undefined]);
      const body = p === '/api/v1/agent/schedules' ? { schedules: row ? [row] : [] } : { ok: true };
      return { ok: true, status: 200, json: async () => body };
    },
    Array, JSON, Object, Boolean, Error, encodeURIComponent,
  };
  ctx.render = () => { ctx.rendered += 1; };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { ctx, btn, msg, pill, header, requests };
}

const row = (status, activation = null) => ({ id: '933b484f-85a8-88a6-915e-1cdaa127cd28', app: SCHEDULE.app, name: SCHEDULE.name,
  status, activation });

test('an armed book whose job is not active says so and offers Activate, not "autopilot on"', async () => {
  const p = page({ armed: true, row: row('not-activated') });
  await p.ctx.nativePaperSync(p.header);
  assert.equal(p.pill.textContent, 'armed, not scheduled');
  assert.equal(p.pill.className, 'pill');
  assert.equal(p.btn.getAttribute('data-np'), 'start');
  assert.equal(p.btn.textContent, 'Activate paper schedule');
  assert.match(p.msg.textContent, /not active, so nothing trades/);
  assert.match(p.msg.className, /err/);
});

test('an armed book whose job is active for the person is on and offers Stop', async () => {
  const p = page({ armed: true, row: row('active', { class: 'Person' }) });
  await p.ctx.nativePaperSync(p.header);
  assert.equal(p.pill.textContent, 'autopilot on');
  assert.equal(p.pill.className, 'pill ok');
  assert.equal(p.btn.getAttribute('data-np'), 'stop');
  assert.match(p.msg.textContent, /Armed and scheduled/);
});

test('a suspended job names its state', async () => {
  const p = page({ armed: true, row: { ...row('suspended'), reason: 'budget exhausted' } });
  await p.ctx.nativePaperSync(p.header);
  assert.match(p.msg.textContent, /it is suspended: budget exhausted/);
});

test('Start arms the book, then activates the person\'s own job with class person', async () => {
  const p = page({ armed: false, row: row('not-activated') });
  await p.ctx.nativePaperStart();
  assert.deepEqual(p.requests.map((r) => r.slice(0, 3)), [
    ['api', '/paper/arm', 'POST'],
    ['kernel', '/api/v1/agent/schedules', 'GET'],
    ['kernel', '/api/v1/agent/schedules/933b484f-85a8-88a6-915e-1cdaa127cd28/activate', 'POST'],
  ]);
  assert.equal(p.requests[2][3].class, 'person');
  assert.equal(p.ctx.rendered, 1, 'the header repaints and reads the job again');
});

test('Start on a job already active for the person does not activate it twice', async () => {
  const p = page({ armed: true, row: row('active', { class: 'Person' }) });
  await p.ctx.nativePaperStart();
  assert.equal(p.requests.filter((r) => /\/activate$/.test(r[1])).length, 0);
  assert.equal(p.ctx.rendered, 1);
});

test('a host that does not list the job still repaints, and the header then says nothing fires', async () => {
  const p = page({ armed: false, row: null });
  await p.ctx.nativePaperStart();
  assert.equal(p.ctx.rendered, 1);
  p.ctx.STATUS.nativePaper.armed = true;
  await p.ctx.nativePaperSync(p.header);
  assert.equal(p.pill.textContent, 'armed, not scheduled');
  assert.match(p.msg.textContent, /does not list the paper-autopilot job/);
});
