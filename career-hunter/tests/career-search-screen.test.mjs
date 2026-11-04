/**
 * CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | State the fixture's explicit currency and unit when asserting quoted salary rendering.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the Search Jobs screen's own code: every control it advertises reaches the request, and nothing résumé-shaped appears on it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Supply browser timers and abort controllers to exercise immediate filters cancelling pending debounce work.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin three-page navigation and the desktop-only independently scrollable filter rail.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Keep the primary keyword form above saved searches and filters, and exercise Enter/button submission with page reset.
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
  for (const id of [...formControls, 'rail', 'keywordSearch', 'list', 'count', 'pager', 'chips', 'clear',
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
    CareerFeedback:{unique:rows=>rows,configure(){}},
    console, JSON, Math, Number, String, Object, Array, URLSearchParams, setTimeout, clearTimeout, AbortController,
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

test('the primary keyword search is directly below the heading and outside the filter rail', () => {
  const form = html.match(/<form id="keywordSearch"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  assert.match(form, /role="search"/);
  assert.match(form, /<label for="q">Search jobs<\/label>/);
  assert.match(form, /<input id="q"[^>]*type="search"/);
  assert.match(form, /type="submit"/);
  assert.match(form, /titles, full descriptions, and employers/);
  assert.ok(html.indexOf('</header>') < html.indexOf(form));
  assert.ok(html.indexOf(form) < html.indexOf('<section class="saved-searches"'));
  assert.ok(html.indexOf(form) < html.indexOf('<form class="rail"'));
  assert.equal([...html.matchAll(/\bid="q"/g)].length,1);
});

test('Enter or the Search button runs keywords immediately and resets to the first page', async () => {
  const {requests,el}=boot({jobs:[{id:1,title:'Example'}],exhausted:false});
  await settle(); el('next').onclick(); await settle();
  assert.equal(lastQuery(requests).get('page'),'2');
  el('q').value='Python architect';
  const before=requests.length; let prevented=false;
  for(const submit of el('keywordSearch').listeners.submit) submit({preventDefault(){prevented=true;}});
  await settle();
  assert.ok(prevented,'search submits without navigating away');
  assert.equal(requests.length,before+1);
  assert.equal(lastQuery(requests).get('q'),'Python architect');
  assert.equal(lastQuery(requests).get('page'),'1');
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
  read.add('per');    // selected page size is a remembered view choice
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
  assert.ok(el('next').onclick, 'page 2 rendered no Next button');
  el('next').onclick();
  await settle();
  assert.equal(lastQuery(requests).get('page'), '3', 'the pager stopped after its second page');
  const prev = el('prev');
  assert.ok(prev.onclick, 'page 3 rendered no Previous button');
  prev.onclick();
  await settle();
  assert.equal(lastQuery(requests).get('page'), '2');
  el('prev').onclick();
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
    salary_min: 190000, salary_max: 240000, salary_currency:'USD', salary_period:'year', job_type: 'full-time',
  });
  for (const resumeShaped of
    ['fit', 'P land', 'hi-win', 'ai_fit', 'Generate resume', 'Submit', 'Mark applied']) {
    assert.ok(!card.includes(resumeShaped),
      `the search card shows "${resumeShaped}" — this screen has no résumé`);
  }
  assert.match(card, /\$190k–\$240k/);
  assert.match(card, /Employer posting/);
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
  const desktopRail = html.match(/\.rail\{[^}]*\}/)?.[0] || '';
  assert.match(desktopRail, /max-height:calc\(100vh - 24px\)/,
    'the desktop filter rail has no viewport-bounded height');
  assert.match(desktopRail, /overflow-y:auto/,
    'the desktop filter rail cannot scroll when its filters exceed the viewport');
  assert.match(html, /@media\(max-width:820px\)\{[\s\S]*?\.rail\{position:static;max-height:none;overflow:visible/,
    'the narrow layout must return scrolling to the page instead of trapping the rail');
  // Nothing is "submitted" — every control re-runs the search itself, from page one.
  assert.match(script, /function refilter\(\)\{ clearTimeout\(typing\); page = 1; search\(\); \}/);
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

test('target salary includes an explicit unlisted-pay choice and labels estimates', async () => {
  assert.match(html, /id="max_pay"[^>]*type="number"/);
  assert.match(html, /Include jobs with no pay estimate/);
  const { el, context, requests } = boot();
  await settle();
  el('min_pay').value = '140000';
  el('include_unknown_pay').checked = true;
  context.refilter(); await settle();
  assert.equal(lastQuery(requests).get('min_pay'), '140000');
  assert.equal(lastQuery(requests).get('include_unknown_pay'), '1');
  el('include_unknown_pay').checked = false;
  context.refilter(); await settle();
  assert.equal(lastQuery(requests).has('include_unknown_pay'), false);
  assert.match(context.jobCard({ id: 1, title: 'IT manager', salary_min: 140000, salary_max: 160000, salary_source: 'ai_estimated' }), /estimate/);
  assert.match(context.jobCard({ id: 2, title: 'IT manager', salary_min: 140000, salary_source: 'heuristic' }), /estimate/);
  assert.match(context.jobCard({ id: 3, title: 'County position', salary_min: 25.5, salary_max: 30, salary_currency:'USD', salary_period: 'hour' }), /\$25\.5–\$30 \/hr/);
  assert.match(context.jobCard({ id: 4, title: 'College position', salary_min: 5000, salary_currency:'USD', salary_period: 'month' }), /\$5,000 \/month/);
});

test('both pay bounds and the selected unit reach search; reversed bounds retain the results', async () => {
  const {el,context,requests} = boot(); await settle();
  el('min_pay').value='25.50'; el('max_pay').value='40'; el('pay_period').value='hour';
  context.refilter(); await settle();
  assert.equal(lastQuery(requests).get('min_pay'),'25.50');
  assert.equal(lastQuery(requests).get('max_pay'),'40');
  assert.equal(lastQuery(requests).get('pay_period'),'hour');
  const n=requests.length; el('searchStatus'); el('max_pay').value='20';
  context.refilter(); await settle();
  assert.equal(requests.length,n,'invalid bounds must not replace the last successful results');
  assert.match(el('searchStatus').textContent,/Minimum pay cannot be higher/);
  assert.match(context.jobCard({id:1,title:'Developer',salary_min:105210,salary_max:171980,salary_source:'bls_estimated',
    salary_estimate:{source:'BLS OEWS',survey:'May 2025',occupation:'Software Developers',method:'National occupation wage range.'}}),/estimate.*BLS May 2025/s);
});


test('selectable page sizes reach the API, reset paging, and preserve filters', async () => {
  const {context, requests, el} = boot({jobs:Array.from({length:200},(_,id)=>({id,title:'Role'})),exhausted:false});
  await settle();
  el('q').value='engineer';
  for (const size of [25,50,100,200]) {
    el('per').value=String(size);
    await el('per').listeners.change[0](); await settle();
    assert.equal(lastQuery(requests).get('per'),String(size));
    assert.equal(lastQuery(requests).get('page'),'1');
    assert.equal(lastQuery(requests).get('q'),'engineer');
    await el('next').onclick(); await settle();
    assert.equal(lastQuery(requests).get('page'),'2');
  }
  context.fill({per:'9999'}); await context.search();
  assert.equal(lastQuery(requests).get('per'),'50');
});


test('a Jarvis search link keeps its requested small page size and offset', async () => {
  const {context, requests, el} = boot({jobs:Array.from({length:5},(_,id)=>({id,title:'Role'})),exhausted:false});
  await settle();context.fill({near:'Destin, FL',radius_miles:'50',per:'5'});
  await context.search();await settle();
  assert.equal(lastQuery(requests).get('per'),'5');assert.equal(lastQuery(requests).get('near'),'Destin, FL');
  assert.equal(lastQuery(requests).get('radius_miles'),'50');
  await el('next').onclick();await settle();
  assert.equal(lastQuery(requests).get('per'),'5');assert.equal(lastQuery(requests).get('page'),'2');
});

 test('saved searches live in an optional header popup without a layout row', () => {
  assert.match(html, /<button[^>]*class="saved-search-toggle"[^>]*popovertarget="savedSearchPopup"[^>]*aria-label="Saved searches"/);
  assert.match(html, /<section[^>]*id="savedSearchPopup"[^>]*popover role="dialog"/);
  assert.match(html, /\.saved-searches:not\(:popover-open\)\{display:none\}/);
  assert.match(html, /\.saved-searches\{position:fixed/);
});
