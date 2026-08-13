/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the board surface's real onboarding gate to prove the pre-resume browse mode and the Apply-to-upload handoff.
 */
/**
 * Guards for the board's pre-resume BROWSE mode.
 *
 * These do not grep the surface for strings. The board's own inline script is executed in a VM
 * against a minimal DOM/fetch double, and every assertion is on what that code actually DID —
 * which endpoint it called, which controls it hid, what it wrote to localStorage. A substring
 * guard would keep passing if `checkOnboarding` stopped routing to the browse feed; this does not.
 *
 * The behaviour under guard: a signed-in account with no indexed resume used to see ONLY the
 * upload card, with the search bar, filters and list hidden. It now browses and searches the
 * corpus, and Apply on a result becomes the entry point to the resume upload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'tools', 'career-board.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
// [0] is the parent-theme bridge, which needs a real parent frame. [1] is the board itself.
const boardScript = inline[inline.length - 1];

/** One DOM node, carrying only what the board actually touches. */
function makeElement(id) {
  const el = {
    id,
    style: {},
    dataset: {},
    innerHTML: '',
    textContent: '',
    value: '',
    placeholder: '',
    checked: false,
    hidden: false,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    scrollIntoView() { this.scrolled = true; },
    remove() {},
    append() {},
    insertBefore() {},
    appendChild() {},
    get options() {
      return [...String(this.innerHTML).matchAll(/<option value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
    },
    get offsetHeight() { return 0; },
    get parentElement() { return null; },
    get firstChild() { return null; },
  };
  return el;
}

/** Whether the board hid a control. The surface sets style.display, so read exactly that. */
const hidden = (el) => el.style.display === 'none';

/**
 * Boot the board script against a DOM double and a routed fetch.
 * @param resumeState - What `/api/career-hunter/resume/state` answers.
 * @returns The VM context plus the request log and element registry.
 */
function bootBoard(resumeState) {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  // The querySelector targets the board reaches for by CSS rather than id.
  const bySelector = new Map([
    ['.bar', el('#bar')], ['.countrow .bulk', el('#bulk')],
  ]);
  const requests = [];
  const store = new Map();

  const respond = (url) => {
    if (url.startsWith('/api/career-hunter/resume/state')) return resumeState;
    if (url.startsWith('/api/career-hunter/jobs/stats')) return { byStatus: [] };
    if (url.startsWith('/api/career-hunter/browse')) {
      return {
        browse: true,
        pooled: url.includes('q='),
        poolSize: url.includes('q=') ? 20000 : null,
        jobs: [{
          id: 42, title: "Rick's <b>Platform</b> Engineer", company: 'Northwind',
          url: 'https://example.test/42', location: 'Remote', remote: 1, salary_max: 210000,
        }],
      };
    }
    if (url.startsWith('/api/career-hunter/jobs')) return { jobs: [], pooled: false };
    if (url.startsWith('/api/apply-operator/workers')) return { workers: [], defaultClientId: null };
    return {};
  };

  const context = {
    console,
    JSON,
    Math,
    Date,
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    location: { search: '', pathname: '/board' },
    history: { replaceState() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      // Faithful to a real document in the one way that matters here: an id becomes reachable once
      // something has RENDERED it. Auto-creating every id would hide a genuinely missing element.
      getElementById: (id) => {
        if (elements.has(id)) return elements.get(id);
        for (const node of elements.values()) {
          if (String(node.innerHTML).includes(`id="${id}"`)) return el(id);
        }
        return null;
      },
      querySelector: (sel) => bySelector.get(sel) || null,
      querySelectorAll: () => [],
      createElement: () => makeElement('created'),
      addEventListener() {},
    },
    fetch: (url) => {
      requests.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(respond(url)), text: () => Promise.resolve('') });
    },
    window: { confirm: () => true, addEventListener() {}, setTimeout: () => 0 },
  };
  context.window.localStorage = context.localStorage;
  // Every id the board resolves at parse time has to exist before the script runs.
  for (const id of ['list', 'tabs', 'toast', 'count', 'q', 'sort', 'min_score', 'min_pay', 'days',
    'remote', 'onboard', 'intent', 'sub', 'fitWrap', 'applyRules', 'autofillRules', 'nodeSel',
    'workerHint', 'copyAutofill', 'subAll']) el(id);
  el('sort').innerHTML = '<option value="ai">Best fit</option><option value="prob">P(land)</option>'
    + '<option value="salary">Salary</option><option value="recent">Newest</option>';

  vm.createContext(context);
  vm.runInContext(boardScript, context, { filename: 'career-board.html' });
  return { context, requests, el, elements };
}

/** Let the board's boot promises settle. */
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

const NO_RESUME = { hasResume: false, scored: 0, indexing: false };
const SCORED = { hasResume: true, scored: 7, indexing: false };

test('with no indexed resume the board reads the CORPUS feed, not the scored one', async () => {
  const { requests } = bootBoard(NO_RESUME);
  await settle();
  assert.ok(requests.some((u) => u.startsWith('/api/career-hunter/browse')),
    `browse feed was never requested — the pre-resume board is blank again:\n${requests.join('\n')}`);
});

test('browse mode hides every control that needs a resume, and keeps the search bar', async () => {
  const { el } = bootBoard(NO_RESUME);
  await settle();
  assert.equal(hidden(el('list')), false, 'the results list must be visible');
  assert.equal(hidden(el('#bar')), false, 'the search + filter bar must be visible');
  for (const id of ['tabs', 'fitWrap', '#bulk', 'applyRules', 'autofillRules']) {
    assert.equal(hidden(el(id)), true, `${id} reads a résumé and must be hidden while browsing`);
  }
  assert.equal(el('onboard').hidden, false, 'the upload card rides above the board, not instead of it');
});

test('browse mode offers only corpus sort keys, never a fit ranking', async () => {
  const { el } = bootBoard(NO_RESUME);
  await settle();
  const values = el('sort').options.map((o) => o.value);
  assert.ok(values.includes('recent'), `browse sorts missing: ${values.join(',')}`);
  for (const scored of ['ai', 'prob', 'highwin', 'generated', 'applied']) {
    assert.ok(!values.includes(scored), `browse offered a score-based sort: ${scored}`);
  }
});

test('a remembered fit floor or pipeline tab never reaches the corpus feed', async () => {
  const { el, requests, context } = bootBoard(NO_RESUME);
  await settle();
  el('min_score').value = '80';
  el('q').value = 'platform';
  context.loadJobs();
  await settle();
  const search = requests.filter((u) => u.startsWith('/api/career-hunter/browse')).pop();
  assert.match(search, /q=platform/);
  assert.ok(!search.includes('min_score'), `browse asked the corpus for a fit score: ${search}`);
  assert.ok(!search.includes('status='), `browse asked the corpus for a pipeline status: ${search}`);
});

test('a browse card carries Apply and no score, and escapes the job into data attributes', async () => {
  const { el } = bootBoard(NO_RESUME);
  await settle();
  const rendered = el('list').innerHTML;
  assert.match(rendered, /data-apply="42"/, 'no Apply affordance on a browse card');
  assert.ok(!/class="fit"|P land|hi-win/.test(rendered), 'browse card showed a score it does not have');
  // The seeded title carries an apostrophe and markup: both must be escaped, and the title must
  // never be interpolated into an inline handler where a quote would break out of the attribute.
  assert.ok(!rendered.includes("Rick's"), 'an apostrophe reached the attribute unescaped');
  assert.ok(!rendered.includes('<b>Platform</b>'), 'job markup was rendered as markup');
  assert.ok(!/onclick=['"][^'"]*Rick/.test(rendered), 'the job was interpolated into an inline handler');
});

test('Apply on a browse card remembers the job and hands over the named upload card', async () => {
  const { context, el } = bootBoard(NO_RESUME);
  await settle();
  context.applyIntent({ id: 42, title: 'Staff Platform Engineer', company: 'Northwind' });
  const saved = JSON.parse(context.localStorage.getItem('career-board.applyIntent.v1'));
  assert.equal(saved.id, 42);
  assert.equal(saved.company, 'Northwind');
  assert.ok(saved.at > 0, 'the intent needs an age so a stale one can expire');
  const card = el('onboard').innerHTML;
  assert.equal(el('onboard').hidden, false);
  assert.match(card, /Staff Platform Engineer/, 'the upload card must name the job being applied to');
  assert.match(card, /Northwind/);
  assert.match(card, /id="obFile"/, 'the upload input is what makes this the onboarding step');
  assert.equal(el('onboard').scrolled, true, 'the user has to be taken to the upload card');
});

test('once the resume is indexed the board returns to the scored feed and offers the held job', async () => {
  const { context, requests, el } = bootBoard(SCORED);
  context.localStorage.setItem('career-board.applyIntent.v1',
    JSON.stringify({ id: 42, title: 'Staff Platform Engineer', company: 'Northwind', at: Date.now() }));
  await context.checkOnboarding();
  await settle();
  assert.ok(requests.some((u) => u.startsWith('/api/career-hunter/jobs?')),
    `scored feed was never requested:\n${requests.join('\n')}`);
  assert.equal(hidden(el('tabs')), false, 'the pipeline tabs come back with a résumé');
  assert.equal(el('intent').hidden, false, 'the job the user tried to apply to was forgotten');
  assert.match(el('intent').innerHTML, /Staff Platform Engineer/);
});

test('an expired intent is dropped rather than resurrected months later', async () => {
  const { context, el } = bootBoard(SCORED);
  const old = Date.now() - (30 * 24 * 60 * 60 * 1000);
  context.localStorage.setItem('career-board.applyIntent.v1',
    JSON.stringify({ id: 42, title: 'Staff Platform Engineer', at: old }));
  await context.checkOnboarding();
  await settle();
  assert.equal(el('intent').hidden, true);
});

test('mid-index the openings stay up instead of blanking out', async () => {
  const { el, requests } = bootBoard({ hasResume: false, scored: 0, indexing: true });
  await settle();
  assert.equal(hidden(el('list')), false, 'the board went blank for the 2-3 minute index');
  assert.ok(requests.some((u) => u.startsWith('/api/career-hunter/browse')));
  assert.match(el('onboard').innerHTML, /Indexing your resume/);
});

test('a failed ingest still takes the whole screen — it needs the user, not a job list', async () => {
  const { el } = bootBoard({
    hasResume: false, scored: 0, indexing: false, ingest: { state: 'failed', error: 'unreadable pdf' },
  });
  await settle();
  assert.equal(hidden(el('list')), true);
  assert.match(el('onboard').innerHTML, /Resume indexing failed/);
});
