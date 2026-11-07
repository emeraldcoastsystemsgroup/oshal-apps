/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit batch 7 (payroll--payroll-home): verify role="tab" module buttons
 *   switch by keyboard arrows/Home/End, phone (<600px) 4+More bottom bar and sheet, single-sentence scope lede, 44px W-4
 *   switch rows, supported-state select matching the compiled tax engine, blur validation, hidden Termination date on new
 *   hires, and 4-step Add employee sheet/dialog saving an employee.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(path.join(here, '..', 'tools', 'payroll.html'), 'utf8');
const { supportedStates } = require('../routes/payroll-state-tax.js');

function extractMainScript(html) {
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((s) => s.includes('function selectModule(') && s.includes('function openEmpForm('));
  assert.ok(found, 'expected main Payroll inline script');
  return found;
}

function makeElement(id, tag = 'div', dataset = {}) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  return {
    id,
    tagName: tag.toUpperCase(),
    dataset: { ...dataset },
    style: { display: '' },
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    tabIndex: -1,
    value: '',
    innerHTML: '',
    textContent: '',
    focused: false,
    classList: {
      add: (...xs) => xs.forEach((x) => classes.add(x)),
      remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      toggle: (x, force) => {
        const on = force === undefined ? !classes.has(x) : !!force;
        if (on) classes.add(x); else classes.delete(x);
        return on;
      },
      contains: (x) => classes.has(x),
    },
    setAttribute(k, v) { attrs[k] = String(v); if (k === 'open') this.open = true; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; if (k === 'open') this.open = false; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, extra = {}) {
      let prevented = false;
      const ev = { type, target: this, preventDefault() { prevented = true; }, ...extra };
      (listeners[type] || []).forEach((fn) => fn(ev));
      return prevented;
    },
    focus() { this.focused = true; },
    showModal() { this.open = true; this.setAttribute('open', ''); },
    close() { this.open = false; this.removeAttribute('open'); },
    scrollIntoView() {},
    insertAdjacentHTML() {},
  };
}

function seedPayrollDom(getEl, nodes) {
  const tabIds = ['employees', 'runs', 'stubs', 'reports', 'filing', 'settle', 'settings'];
  const tabEls = tabIds.map((t, idx) => {
    const el = makeElement('tab-' + t, 'button', { tab: t });
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
    el.tabIndex = idx === 0 ? 0 : -1;
    if (idx === 0) el.classList.add('active');
    nodes[el.id] = el;
    const view = makeElement('view-' + t, 'div');
    view.style.display = idx === 0 ? '' : 'none';
    nodes[view.id] = view;
    return el;
  });
  const phoneTabEls = ['employees', 'runs', 'stubs', 'reports'].map((t, i) => {
    const el = makeElement('phone-' + t, 'button', { phoneTab: t });
    if (i === 0) el.classList.add('active');
    return el;
  });
  const moreTabEls = ['filing', 'settle', 'settings'].map((t) => makeElement('more-' + t, 'button', { moreTab: t }));
  const stepBtnEls = [1, 2, 3, 4].map((n) => {
    const el = makeElement('stepbtn-' + n, 'button', { step: String(n) });
    if (n === 1) el.setAttribute('aria-current', 'step');
    return el;
  });
  [1, 2, 3, 4].forEach((n) => { getEl('empStep' + n).hidden = n !== 1; });
  ['moreModulesSheet', 'moreSheetBackdrop', 'f_term', 'empBackBtn', 'empSaveBtn'].forEach((id) => { getEl(id).hidden = true; });
  getEl('f_term').style.display = 'none';
  getEl('e_hours').value = '80';
  ['e_dep', 'e_other', 'e_ded', 'e_extra', 'e_k401', 'e_roth', 'e_health', 'e_post', 'e_garn', 'e_state', 'e_allow', 'p_wages', 'p_sstax', 'p_def', 'p_supp'].forEach((id) => {
    getEl(id).value = '0';
  });
  return { tabIds, tabEls, phoneTabEls, moreTabEls, stepBtnEls };
}

function createPayrollFetch(employees, calls) {
  return async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, url, body });
    if (url === '/api/payroll/states') return { ok: true, status: 200, json: async () => ({ supported: supportedStates(), detail: null }) };
    if (url.startsWith('/api/payroll/states?code=')) {
      const code = decodeURIComponent(url.split('code=')[1] || '');
      return { ok: true, status: 200, json: async () => ({ supported: supportedStates(), detail: { supported: supportedStates().includes(code), kind: 'none', note: 'Verified.' } }) };
    }
    if (url === '/api/payroll/company') {
      return { ok: true, status: 200, json: async () => ({ taxYear: 2026, company: { company_name: 'Emerald Payroll', pay_frequency: 'biweekly', state_code: 'FL', suta_rate_pct: 2.7, suta_wage_base_cents: 700000 } }) };
    }
    if (url === '/api/payroll/employees' && method === 'GET') return { ok: true, status: 200, json: async () => ({ employees }) };
    if (url === '/api/payroll/employees' && method === 'POST') {
      const created = {
        employee_id: 'emp-' + (employees.length + 1), first_name: body.firstName, last_name: body.lastName,
        comp_type: body.compType, hourly_rate_cents: body.hourlyRateCents, annual_salary_cents: body.annualSalaryCents,
        filing_status: body.filingStatus, w4_step2: body.w4Step2, w4_exempt: body.w4Exempt, state_code: body.stateCode, status: 'active',
      };
      employees.push(created);
      return { ok: true, status: 200, json: async () => ({ employee: created }) };
    }
    if (url === '/api/payroll/runs') return { ok: true, status: 200, json: async () => ({ runs: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

function bootPayroll({ initialEmployees = [] } = {}) {
  const nodes = {};
  const getEl = (id) => { if (!nodes[id]) nodes[id] = makeElement(id); return nodes[id]; };
  const { tabIds, tabEls, phoneTabEls, moreTabEls, stepBtnEls } = seedPayrollDom(getEl, nodes);
  const employees = [...initialEmployees];
  const calls = [];
  const docListeners = {};
  const sandbox = {
    AppView: { active: () => false },
    window: { AppView: { active: () => false }, confirm: () => true, prompt: () => 'test' },
    document: {
      getElementById: getEl,
      querySelectorAll(sel) {
        if (sel === '.tab[role="tab"]') return tabEls;
        if (sel === '.view') return tabIds.map((t) => getEl('view-' + t));
        if (sel === '.phone-nav-btn[data-phone-tab]') return phoneTabEls;
        if (sel === '.more-sheet-item[data-more-tab]') return moreTabEls;
        if (sel === '.emp-step-btn[data-step]') return stepBtnEls;
        return [];
      },
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      createElement: (tag) => makeElement(tag, tag),
    },
    fetch: createPayrollFetch(employees, calls),
    setTimeout: () => 0, clearTimeout() {},
    Set, Array, Object, Number, String, Math, Date, RangeError, Error, Promise, encodeURIComponent,
    console: { log() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractMainScript(HTML), sandbox, { filename: 'payroll.html' });
  return { sandbox, nodes, tabEls, phoneTabEls, moreTabEls, calls };
}

const settle = () => new Promise((r) => setImmediate(r));

test('payroll: static structure has semantic tablist, phone 4+More bar, 44px W-4 switches, engine states, and 1-sentence lede', () => {
  assert.match(HTML, /<p class="sub" id="payrollLede">oshal records payroll from the <span id="taxYear">2026<\/span> tax engine; it never moves money or files returns\.<\/p>/);
  assert.match(HTML, /<div class="tabs" id="moduleTabs" role="tablist" aria-label="Payroll modules">/);
  const tabButtons = [...HTML.matchAll(/<button type="button" class="tab[^"]*" role="tab"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabButtons, ['employees', 'runs', 'stubs', 'reports', 'filing', 'settle', 'settings']);

  // Phone (<600px) bottom bar of 4 + More (Pay & file, Settlement, Settings)
  assert.match(HTML, /@media \(max-width:599px\)/);
  const phoneButtons = [...HTML.matchAll(/data-phone-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(phoneButtons, ['employees', 'runs', 'stubs', 'reports']);
  const moreButtons = [...HTML.matchAll(/data-more-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(moreButtons, ['filing', 'settle', 'settings']);

  // 44px W-4 switch rows + Work state <select> matching compiled engine's supportedStates()
  assert.match(HTML, /id="e_step2" type="checkbox" role="switch"/);
  assert.match(HTML, /id="e_exempt" type="checkbox" role="switch"/);
  const selectMatch = HTML.match(/<select id="e_statecode"[\s\S]*?<\/select>/);
  assert.ok(selectMatch, '#e_statecode is a <select>');
  const htmlStates = [...selectMatch[0].matchAll(/<option value="([A-Z]{2})">/g)].map((m) => m[1]);
  assert.deepEqual(htmlStates, supportedStates(), 'Work state options match payroll-state-tax supportedStates()');
});

test('payroll: role="tab" module buttons switch active panel, aria-selected, and roving tabindex by keyboard', async () => {
  const { nodes, tabEls } = bootPayroll();
  await settle();
  await settle();

  assert.equal(tabEls[0].getAttribute('aria-selected'), 'true');
  assert.equal(nodes['view-employees'].style.display, '');
  assert.equal(nodes['view-runs'].style.display, 'none');

  // ArrowRight moves from Employees -> Run payroll
  const preventedRight = tabEls[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(preventedRight, true);
  assert.equal(tabEls[0].getAttribute('aria-selected'), 'false');
  assert.equal(tabEls[0].tabIndex, -1);
  assert.equal(tabEls[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabEls[1].tabIndex, 0);
  assert.equal(tabEls[1].focused, true);
  assert.equal(nodes['view-employees'].style.display, 'none');
  assert.equal(nodes['view-runs'].style.display, '');

  // End jumps to Settings; ArrowRight wraps back to Employees
  tabEls[1].dispatch('keydown', { key: 'End' });
  assert.equal(tabEls[6].getAttribute('aria-selected'), 'true');
  assert.equal(nodes['view-settings'].style.display, '');

  tabEls[6].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(tabEls[0].getAttribute('aria-selected'), 'true');
  assert.equal(nodes['view-employees'].style.display, '');
});

test('payroll: 4-step Add employee sheet/dialog validates on blur, hides Termination date for new hires, and saves on step 4', async () => {
  const { sandbox, nodes, calls } = bootPayroll({
    initialEmployees: [
      { employee_id: 'existing-1', first_name: 'Ada', last_name: 'Lovelace', comp_type: 'hourly', hourly_rate_cents: 4500, default_hours: 80, filing_status: 'single', state_code: 'FL', status: 'active' },
    ],
  });
  await settle();
  await settle();

  // Open Add employee for a new hire
  sandbox.openEmpForm();
  assert.equal(nodes.empForm.open, true);
  assert.equal(nodes.f_term.hidden, true, 'Termination date withheld when creating a new employee');
  assert.equal(nodes.empStep1.hidden, false);
  assert.equal(nodes.empSaveBtn.hidden, true, 'Save is only on step 4');
  assert.equal(nodes.empNextBtn.hidden, false);

  // Blur validation on required First name and Next gate on Step 1
  nodes.e_first.dispatch('blur');
  assert.equal(nodes.e_first.getAttribute('aria-invalid'), 'true');
  assert.match(nodes.err_first.textContent, /first name/i);
  sandbox.nextEmpStep();
  assert.equal(nodes.empStep1.hidden, false, 'stays on step 1 when required fields are empty');

  // Complete Step 1 (Person & pay) -> Step 2 (Federal W-4) -> Step 3 (Benefits & deductions) -> Step 4 (State)
  nodes.e_first.value = 'Grace';
  nodes.e_last.value = 'Hopper';
  nodes.e_rate.value = '52.50';
  sandbox.nextEmpStep();
  assert.equal(nodes.empStep2.hidden, false);

  nodes.e_step2.checked = true;
  nodes.e_step2.dispatch('change');
  assert.equal(nodes.e_step2.getAttribute('aria-checked'), 'true');
  sandbox.nextEmpStep();
  assert.equal(nodes.empStep3.hidden, false);

  sandbox.nextEmpStep();
  assert.equal(nodes.empStep4.hidden, false);
  assert.equal(nodes.empNextBtn.hidden, true);
  assert.equal(nodes.empSaveBtn.hidden, false, 'Save becomes primary on step 4');

  // Required Work state checked before save
  await sandbox.saveEmployee(nodes.empSaveBtn);
  assert.equal(nodes.e_statecode.getAttribute('aria-invalid'), 'true');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === '/api/payroll/employees').length, 0);

  nodes.e_statecode.value = 'FL';
  nodes.e_statecode.dispatch('change');
  await sandbox.saveEmployee(nodes.empSaveBtn);

  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/payroll/employees');
  assert.ok(post, 'expected POST /api/payroll/employees');
  assert.equal(post.body.firstName, 'Grace');
  assert.equal(post.body.lastName, 'Hopper');
  assert.equal(post.body.hourlyRateCents, 5250);
  assert.equal(post.body.w4Step2, true);
  assert.equal(post.body.stateCode, 'FL');
  assert.equal(post.body.terminationDate, null);
  assert.equal(nodes.empForm.open, false, 'dialog closes after saving employee');

  // Editing an existing employee reveals Termination date
  sandbox.openEmpForm('existing-1');
  assert.equal(nodes.f_term.hidden, false, 'Termination date shown when editing an existing employee');
});
