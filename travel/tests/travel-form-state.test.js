/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Travel form's state and hand-off text, which a live sweep found broken: the place fields carried JFK/LHR (Paris, Miami) as real values, a Hotels -> Flights round trip rebuilt the form and lost the typed VPS -> DCA, Plan a ride / Plan a meal then sent JFK -> LHR as raw JSON, the Hotels and Cars tabs replaced the no-Duffel notice with "Search to see options.", and a Rides "Plan a trip" hand-off left the flight form on its defaults. The guard EXECUTES the shipped FORMS, switchTab(), typedTrip(), tripOfferContext() and applyHandoffTrip() against a DOM double whose form rebuild resets every field to the markup's own value, as the browser does.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** One declaration cut out of the shipped surface: a function, or a const/let whose value may span lines. */
function extract(source, name) {
  const decl = new RegExp(`^(const|let) ${name} = `, 'm').exec(source);
  if (decl && source.search(new RegExp(`(async )?function ${name}\\(`)) < 0) {
    const open = source.indexOf(decl[0]) + decl[0].length;
    if (!'{['.includes(source[open])) return source.slice(decl.index, source.indexOf(';\n', open) + 1);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if ('{['.includes(source[i])) depth += 1;
      else if ('}]'.includes(source[i]) && --depth === 0) return source.slice(decl.index, source.indexOf(';', i) + 1);
    }
  }
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}

/**
 * A DOM double: getElementById returns one element per id. Setting #searchForm's innerHTML rebuilds every field the
 * markup names, with the markup's own value attribute (empty when it has none), exactly as a browser rebuild does.
 */
function dom() {
  const els = new Map();
  const make = () => ({ value: '', innerHTML: '', textContent: '', style: {}, classList: { toggle() {} }, focus() {} });
  const get = (id) => { if (!els.has(id)) els.set(id, make()); return els.get(id); };
  const form = make();
  let markup = '';
  Object.defineProperty(form, 'innerHTML', {
    get: () => markup,
    set(html) {
      markup = html;
      for (const m of html.matchAll(/<(input|select)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[2]); if (!id) continue;
        const value = /value="([^"]*)"/.exec(m[2]);
        const first = m[1] === 'select' ? /<option>([^<]*)</.exec(html.slice(m.index)) : null;
        els.set(id[1], Object.assign(make(), { value: value ? value[1] : (first ? first[1] : ''), placeholder: (/placeholder="([^"]*)"/.exec(m[2]) || [])[1] || '' }));
      }
    },
  });
  els.set('searchForm', form);
  return { els, get, document: { getElementById: (id) => (id === 'searchForm' || els.has(id) ? get(id) : null), querySelectorAll: () => [] } };
}

const PKG = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PKG, 'tools', 'travel-app.html'), 'utf8');
const NAMES = ['esc', 'NOT_CONNECTED', 'todayPlus', 'FORMS', 'FIELDS', 'FORM_STATE', 'saveForm', 'restoreForm', 'idleResults',
  'switchTab', 'showTab', 'val', 'typedTrip', 'describeTrip', 'tripOfferContext', 'applyHandoffTrip'];

/** The shipped declarations running in one sandbox over the DOM double. */
function page() {
  const d = dom();
  d.get('results'); d.get('priceband');
  const sandbox = { String, Object, Date, RegExp, JSON, document: d.document };
  vm.createContext(sandbox);
  const code = NAMES.map((n) => extract(html, n)).join('\n') +
    '\nlet KIND = "flight"; let LAST = { search:null, items:[], deepLink:null }; let RAIL_MISSING = false;' +
    '\nglobalThis.__t = { switchTab, typedTrip, tripOfferContext, applyHandoffTrip, FORM_STATE, get KIND(){ return KIND; },' +
    ' get LAST(){ return LAST; }, set RAIL_MISSING(v){ RAIL_MISSING = v; } };';
  new vm.Script(code).runInContext(sandbox);
  return { t: sandbox.__t, el: d.get };
}

test('the place fields are empty with an example placeholder, never a real JFK/LHR, Paris or Miami value', () => {
  const p = page();
  p.t.switchTab('flight');
  assert.equal(p.el('f_origin').value, ''); assert.equal(p.el('f_dest').value, '');
  assert.match(p.el('f_origin').placeholder, /^e\.g\. /);
  assert.equal(p.t.typedTrip(), null, 'an untouched form is no trip, so nothing is handed to another app');
  for (const kind of ['hotel', 'car']) { p.t.switchTab(kind); assert.equal(p.el(kind === 'hotel' ? 'h_city' : 'c_city').value, ''); }
  assert.doesNotMatch(html, /value="(JFK|LHR|Paris|Miami)"/);
});

test('a typed trip survives a Hotels -> Cars -> Flights round trip, and so does each tab its own fields', () => {
  const p = page();
  p.t.switchTab('flight');
  p.el('f_origin').value = 'VPS'; p.el('f_dest').value = 'DCA'; p.el('f_depart').value = '2026-11-20';
  p.t.switchTab('hotel');
  p.el('h_city').value = 'Washington';
  p.t.switchTab('car');
  p.t.switchTab('hotel');
  assert.equal(p.el('h_city').value, 'Washington');
  p.t.switchTab('flight');
  assert.deepEqual(['f_origin', 'f_dest', 'f_depart'].map((id) => p.el(id).value), ['VPS', 'DCA', '2026-11-20']);
  const offer = p.t.tripOfferContext();
  assert.equal(offer.title, 'Plan around my flight trip (not searched)');
  assert.equal(offer.notes, 'Travel plan as typed, not searched and not booked: From VPS to DCA, depart 2026-11-20, economy cabin.');
  assert.doesNotMatch(offer.notes, /[{}"]/, 'the person reads the trip, not JSON');
});

test('with no Duffel rail every tab keeps the unavailable notice instead of "Search to see options."', () => {
  const p = page();
  p.t.RAIL_MISSING = true;
  for (const kind of ['hotel', 'car', 'flight']) {
    p.t.switchTab(kind);
    assert.match(p.el('results').innerHTML, /no Duffel rail/);
    assert.doesNotMatch(p.el('results').innerHTML, /Search to see options/);
  }
  p.t.RAIL_MISSING = false;
  p.t.switchTab('hotel');
  assert.match(p.el('results').innerHTML, /Search to see options/);
});

test('a tab switch drops the other tab\'s search, so it is never offered under this tab\'s name', () => {
  const p = page();
  p.t.switchTab('flight');
  p.t.LAST.search = { origin: 'VPS', destination: 'DCA', departDate: '2026-11-20', cabin: 'business' };
  assert.equal(p.t.tripOfferContext().notes, 'Travel search (not a confirmed booking): From VPS to DCA, depart 2026-11-20, business cabin.');
  p.t.switchTab('hotel');
  assert.equal(p.t.LAST.search, null);
  assert.equal(p.t.tripOfferContext(), null, 'no hotel city typed: nothing to offer');
});

test('a Rides hand-off to an airport fills the flight From; any other destination fills the hotel and car city', () => {
  const p = page();
  p.t.switchTab('flight');
  assert.equal(p.t.applyHandoffTrip({ title: 'Plan around my ride destination', notes: 'Destination: Pensacola International Airport (PNS)\nPickup: Destin, FL\n' }), true);
  assert.equal(p.t.KIND, 'flight');
  assert.equal(p.el('f_origin').value, 'PNS');
  assert.equal(p.el('f_dest').value, '', 'no destination airport is invented');
  p.t.applyHandoffTrip({ notes: 'Destination: 1600 Pennsylvania Ave NW, Washington, DC\nPickup: my location' });
  assert.equal(p.t.KIND, 'hotel');
  assert.equal(p.el('h_city').value, '1600 Pennsylvania Ave NW, Washington, DC');
  p.t.switchTab('flight');
  assert.equal(p.el('f_origin').value, 'PNS', 'the flight From kept from the first hand-off');
  assert.equal(p.t.applyHandoffTrip({ notes: 'Plan dinner near the hotel' }), false, 'no destination named, nothing filled');
  assert.match(html, /context => \{ applyHandoffTrip\(context\); set\('chatbox', brief\(context\)\);/, 'the receiver fills the form and the chat box');
});
