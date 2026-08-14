/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the Search Jobs screen's own code: every control it advertises reaches the request, and nothing résumé-shaped appears on it.
 */
/**
 * Guards for the Search Jobs screen (`tools/career-search.html`).
 *
 * The screen's contract is small and easy to break silently: a control the form
 * shows must actually reach the request. A `<select>` that looks like a filter and
 * is never read is indistinguishable from a working one until somebody tries to
 * find a remote job — so these run the screen's own `criteria()` and its fetch,
 * against a DOM double, and assert the URL that came out.
 *
 * The second contract is negative and just as easy to lose: this screen exists
 * BECAUSE it works without a résumé. Any fit score, pipeline status or submission
 * affordance drifting onto it makes it the Job Board again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'tools', 'career-search.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1]).pop();

/** Every control the FORM offers, read out of the markup rather than assumed. */
const formControls = [...html.matchAll(/<(?:input|select)[^>]*\bid="([a-z_]+)"/g)]
  .map((m) => m[1]).filter((id) => id !== 'reset');

function makeElement(id) {
  return {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    style: {}, listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    onclick: null, closest: () => null, querySelectorAll: () => [],
    // Real <select>s have this; the chip label reads it to show a friendly job type.
    selectedOptions: [],
  };
}

/** Boot the screen against a DOM double; returns the request log and the context. */
function boot(page = { jobs: [] }) {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  for (const id of [...formControls, 'rail', 'list', 'count', 'pager', 'chips', 'clear',
    'adv', 'remote']) el(id);
  // The remote control is three pills writing a hidden input; the double provides them so
  // the screen's own click handler is what gets exercised.
  const pills = ['', '1', '0'].map((value) => {
    const pill = makeElement('pill-' + value);
    pill.dataset.remote = value;
    pill.setAttribute = (name, v) => { pill[name] = v; };
    return pill;
  });
  const requests = [];
  const context = {
    console, JSON, Math, Number, String, Object, Array, URLSearchParams,
    location: { search: '', pathname: '/search' },
    history: { replaceState() {} },
    document: {
      // An id becomes reachable once something has RENDERED it — same as a real
      // document, and what lets the pager's own buttons be clicked below.
      getElementById: (id) => {
        if (elements.has(id)) return elements.get(id);
        for (const node of elements.values()) {
          if (String(node.innerHTML).includes(`id="${id}"`)) return el(id);
        }
        return null;
      },
      querySelector: () => null,
      querySelectorAll: (selector) => (selector === '.pill' ? pills : []),
    },
    fetch: (url) => {
      requests.push(url);
      return Promise.resolve({ json: () => Promise.resolve(page) });
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'career-search.html' });
  /** Click one of the remote pills the way the surface wires them. */
  const clickRemote = (value) => {
    const pill = pills.find((p) => p.dataset.remote === value);
    pill.listeners.click.forEach((fn) => fn.call(pill));
  };
  return { context, requests, el, clickRemote };
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
/** The query string of the most recent search request. */
const lastQuery = (requests) => new URLSearchParams(requests[requests.length - 1].split('?')[1]);

test('the screen searches the corpus feed, not the resume-scored board', async () => {
  const { requests } = boot();
  await settle();
  assert.ok(requests.length, 'the screen never issued a search');
  assert.ok(requests.every((u) => u.startsWith('/api/career-hunter/browse')),
    `Search Jobs called the scored board:\n${requests.join('\n')}`);
});

test('every control the form shows reaches the request', async () => {
  const { context, requests, el } = boot();
  await settle();
  const typed = {
    q: 'platform engineer', company: 'Northwind', state: 'FL', title: 'staff engineer',
    description: 'clearance', min_pay: '150000', remote: '1', type: 'contract',
    days: '7', sort: 'salary',
  };
  for (const [id, value] of Object.entries(typed)) el(id).value = value;
  await context.search();
  await settle();

  const sent = lastQuery(requests);
  for (const [id, value] of Object.entries(typed)) {
    assert.equal(sent.get(id), value, `the ${id} control never reached the request`);
  }
  // And the negative: an untouched control must not pin the search to a value.
  const { context: fresh, requests: freshLog } = boot();
  await settle();
  await fresh.search();
  await settle();
  const empty = lastQuery(freshLog);
  for (const id of Object.keys(typed)) {
    if (id === 'sort') continue; // sort always has a value; it is a choice, not a filter
    assert.equal(empty.get(id), null, `an empty ${id} still filtered the search`);
  }
});

test('no control exists on the form that the screen does not read', () => {
  const declared = script.match(/const FILTERS = \[([\s\S]*?)\];/);
  assert.ok(declared, 'the screen no longer declares its filter list');
  const read = new Set(declared[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')));
  read.add('sort');   // a view choice, declared alongside the filters
  read.add('clear');  // the reset button, not a filter
  for (const control of formControls) {
    assert.ok(read.has(control),
      `the form shows a "${control}" control that criteria() never reads — a dead filter`);
  }
});

test('the pager advances the search rather than re-asking for the first page', async () => {
  const { requests, el } = boot({ jobs: [{ id: 1, title: 'A' }], exhausted: false });
  await settle();
  assert.equal(lastQuery(requests).get('page'), '1');
  // Click the screen's own Next button — `page` is a lexical binding the harness
  // cannot reach, which is exactly why this drives the affordance instead.
  const next = el('next');
  assert.ok(next.onclick, 'a page of results with more to come rendered no Next button');
  next.onclick();
  await settle();
  assert.equal(lastQuery(requests).get('page'), '2');
  const prev = el('prev');
  assert.ok(prev.onclick, 'page 2 rendered no Previous button');
  prev.onclick();
  await settle();
  assert.equal(lastQuery(requests).get('page'), '1');
});

test('a filter change resets to page one instead of stranding the user on page 4', async () => {
  const { requests, el, clickRemote } = boot({ jobs: [{ id: 1, title: 'A' }], exhausted: false });
  await settle();
  el('next').onclick();
  await settle();
  assert.equal(lastQuery(requests).get('page'), '2');
  clickRemote('1');
  await settle();
  assert.equal(lastQuery(requests).get('page'), '1',
    'changing a filter kept the old page number, so results looked empty');
  assert.equal(lastQuery(requests).get('remote'), '1');
});

test('a job card carries no fit score, no pipeline status and no submit rail', async () => {
  const { context } = boot();
  await settle();
  const card = context.jobCard({
    id: 7, title: "Rick's <b>Staff</b> Engineer", company: 'Northwind & Co',
    url: 'https://example.test/7', location: 'Remote', remote: 1,
    salary_min: 190000, salary_max: 240000, job_type: 'full-time',
  });
  for (const resumeShaped of
    ['fit', 'P land', 'hi-win', 'ai_fit', 'Generate resume', 'Submit', 'Mark applied']) {
    assert.ok(!card.includes(resumeShaped),
      `the search card shows "${resumeShaped}" — this screen has no résumé`);
  }
  assert.match(card, /\$190k–\$240k/);
  assert.match(card, /View &amp; apply/);
  // Escaped, and never interpolated into an inline handler.
  assert.ok(!card.includes("Rick's"), 'an apostrophe reached the markup unescaped');
  assert.ok(!card.includes('<b>Staff</b>'), 'job markup was rendered as markup');
  assert.ok(!/onclick=/.test(card), 'the card wires an inline handler');
});

test('the screen says plainly that it needs no resume, and never claims a match', () => {
  const copy = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(copy, /No r(é|e)sum(é|e) needed/i);
  for (const claim of ['fit score', 'best match', 'matched to your']) {
    assert.ok(!new RegExp(claim, 'i').test(copy), `the screen claims "${claim}"`);
  }
});


test('the inline script parses — nothing else in the toolchain checks this file', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'career-search.html' }));
});

// ── The shape the operator asked for ─────────────────────────────────────────

test('the filters sit in a rail beside the results, and narrow them live', () => {
  // The shape every job site uses, and the reason it matters: the screen shows the newest
  // postings BEFORE anything is asked for, then narrows as each control is used. The
  // predecessor was a header form you filled in and submitted.
  assert.match(html, /class="rail"/, 'the filter rail is gone');
  assert.match(html, /grid-template-columns:262px/, 'the two-column layout is gone');
  // Nothing is "submitted" — every control re-runs the search itself, from page one.
  assert.match(script, /function refilter\(\)\{ page = 1; search\(\); \}/);
  assert.match(script, /addEventListener\('submit', e => \{ e\.preventDefault\(\)/);
});

test('the first paint is a search with no criteria at all', async () => {
  const { requests } = boot();
  await settle();
  const first = new URLSearchParams(requests[0].split('?')[1]);
  for (const filter of ['q', 'remote', 'state', 'type', 'days', 'min_pay',
    'title', 'description', 'company']) {
    assert.equal(first.get(filter), null,
      `the screen opened with ${filter} already applied instead of the latest postings`);
  }
  assert.equal(first.get('page'), '1');
});

test('a filter narrows what is already there, one control at a time', async () => {
  const { requests, el, clickRemote, context } = boot({ jobs: [{ id: 1, title: 'A' }] });
  await settle();
  clickRemote('1');
  await settle();
  assert.equal(lastQuery(requests).get('remote'), '1');
  el('title').value = 'welder';
  await context.search();
  await settle();
  // The second control must ADD to the first, not replace it.
  const both = lastQuery(requests);
  assert.equal(both.get('remote'), '1', 'adding a title dropped the remote filter');
  assert.equal(both.get('title'), 'welder');
});

test('an applied filter is visible and removable as a chip', async () => {
  const { el, clickRemote, context } = boot();
  await settle();
  clickRemote('1');
  await settle();
  assert.match(el('chips').innerHTML, /data-drop="remote"/,
    'an applied filter left no chip, so there is no way to see or undo it');
  assert.equal(el('clear').disabled, false, 'Clear all stayed disabled with a filter applied');
  context.setRemote('');
  await settle();
});

test('the advanced fields are title-contains and description-contains', () => {
  assert.match(html, /Job title contains/);
  assert.match(html, /Job description contains/);
  assert.match(html, /id="title"/);
  assert.match(html, /id="description"/);
});

test('the salary filter says what it actually hides', () => {
  // ~11% of postings publish a salary, so a minimum silently drops the other 89% — which
  // reads as an empty database rather than as a filter doing its job.
  assert.match(html, /1 in 9/);
});
