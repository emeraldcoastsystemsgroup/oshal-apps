/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5: Projects pane controller for tools/finance.html. Pure DOM API (textContent/createElement, zero innerHTML, zero alert/confirm), exact integer-cent dollar parsing without floating-point drift, project creation, line allocations, multi-source actual entry, and two-click in-page removal confirmation.
 */
(function () {
  'use strict';
  const panel = document.getElementById('projectsPanel');
  if (!panel) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'banks' || (window.AppView && window.AppView.active())) {
    panel.hidden = true;
    return;
  }

  const byId = (id) => document.getElementById(id);
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = String(v);
        else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
      }
    }
    if (children) {
      for (const child of children) {
        if (child !== null && child !== undefined) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return node;
  };

  let projects = [];
  let selectedId = null;

  /** Parse a user-typed decimal dollar string strictly into integer cents without floating-point arithmetic. */
  function parseDollarsToCents(raw, allowZero) {
    const cleaned = String(raw == null ? '' : raw).trim().replace(/[$,\s]/g, '');
    if (!cleaned) return allowZero ? 0 : null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
    const parts = cleaned.split('.');
    const dollars = Number(parts[0]);
    const cents = parts[1] ? Number(parts[1].padEnd(2, '0')) : 0;
    const total = dollars * 100 + cents;
    if (!Number.isSafeInteger(total)) return null;
    if (!allowZero && total <= 0) return null;
    return total;
  }

  /** Format integer cents into a human-readable currency string using exact integer division. */
  function formatCents(cents, currency) {
    const n = Number.isSafeInteger(cents) ? cents : 0;
    const neg = n < 0;
    const abs = Math.abs(n);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, '0');
    const cur = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : 'USD';
    const prefix = cur === 'USD' ? '$' : cur + ' ';
    return (neg ? '−' : '') + prefix + whole.toLocaleString('en-US') + '.' + frac;
  }

  /** Set inline status message without blocking dialogs. */
  function setStatus(message, isError) {
    const node = byId('projectFormStatus');
    if (!node) return;
    node.className = isError ? 'err' : 'sub';
    node.textContent = message || '';
  }

  /** Fetch JSON from /api/finance/projects* routes. */
  async function projApi(path, opts) {
    const init = Object.assign({ credentials: 'include' }, opts || {});
    if (init.body && typeof init.body === 'object') {
      init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch('/api/finance' + path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.error || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /** Render the four summary cards (Budget, Committed, Actual, Variance). */
  function renderSummaryCards(summary) {
    const cur = summary.project.currency || 'USD';
    const cards = [
      { label: 'Budget', value: formatCents(summary.totalBudgetCents, cur), cls: '' },
      { label: 'Committed', value: formatCents(summary.totalCommittedCents, cur), cls: '' },
      { label: 'Actual', value: formatCents(summary.totalActualCents, cur), cls: summary.overBudget ? 'neg' : '' },
      { label: 'Variance', value: formatCents(summary.totalVarianceCents, cur), cls: summary.totalVarianceCents < 0 ? 'neg' : '' },
    ];
    const nodes = cards.map((c) => el('div', { className: 'stat' }, [
      el('div', { className: 'n' + (c.cls ? ' ' + c.cls : ''), text: c.value }),
      el('div', { className: 'l', text: c.label }),
    ]));
    byId('projectSummaryCards').replaceChildren(...nodes);
  }

  /** Populate the allocation lines table and actual line selector. */
  function renderLines(summary) {
    const cur = summary.project.currency || 'USD';
    const tbody = byId('projectLinesBody');
    const select = byId('actualLine');
    const opts = [el('option', { value: '', text: 'Unassigned (project-level)' })];
    for (const line of summary.lines) {
      opts.push(el('option', { value: line.lineId, text: line.name + ' (' + line.channel + ')' }));
    }
    select.replaceChildren(...opts);
    if (!summary.lines.length) {
      tbody.replaceChildren(el('tr', null, [
        el('td', { colspan: '6', className: 'sub', text: 'No allocation lines yet. Add a line above to allocate budget by channel.' }),
      ]));
      return;
    }
    const rows = summary.lines.map((line) => el('tr', null, [
      el('td', { text: line.name }),
      el('td', { text: line.channel }),
      el('td', { className: 'num', text: formatCents(line.budgetCents, cur) }),
      el('td', { className: 'num', text: formatCents(line.committedCents, cur) }),
      el('td', { className: 'num', text: formatCents(line.actualCents, cur) }),
      el('td', { className: 'num' + (line.varianceCents < 0 ? ' owed' : ''), text: formatCents(line.varianceCents, cur) }),
    ]));
    tbody.replaceChildren(...rows);
  }

  /** Build one actual row with two-click in-page Remove confirmation. */
  function buildActualRow(actual, lineNames, cur, projectId) {
    const lineLabel = actual.lineId && lineNames.has(actual.lineId) ? lineNames.get(actual.lineId) : 'Unassigned';
    const details = [actual.occurredOn, actual.source.toUpperCase(), lineLabel, actual.note].filter(Boolean).join(' · ');
    const removeBtn = el('button', { type: 'button', className: 'btn ghost', text: 'Remove' });
    const cancelBtn = el('button', { type: 'button', className: 'btn ghost', text: 'Cancel' });
    cancelBtn.hidden = true;
    const actions = el('div', { className: 'proj-actions-inline' }, [removeBtn, cancelBtn]);

    cancelBtn.addEventListener('click', () => {
      removeBtn.dataset.confirming = '';
      removeBtn.className = 'btn ghost';
      removeBtn.textContent = 'Remove';
      cancelBtn.hidden = true;
    });
    removeBtn.addEventListener('click', async () => {
      if (removeBtn.dataset.confirming !== '1') {
        removeBtn.dataset.confirming = '1';
        removeBtn.className = 'btn danger';
        removeBtn.textContent = 'Confirm remove';
        cancelBtn.hidden = false;
        return;
      }
      removeBtn.disabled = true;
      try {
        const res = await projApi('/projects/' + encodeURIComponent(projectId) + '/actuals/' + encodeURIComponent(actual.actualId), { method: 'DELETE' });
        setStatus('Actual removed.', false);
        renderDetail(res.summary);
        await refreshList(projectId);
      } catch (err) {
        setStatus(err.message, true);
        removeBtn.disabled = false;
      }
    });

    return el('li', { className: 'proj-actual-row' }, [
      el('div', null, [
        el('strong', { text: formatCents(actual.amountCents, cur) }),
        el('div', { className: 'proj-actual-meta', text: details }),
      ]),
      actions,
    ]);
  }

  /** Render recorded actuals list for the selected project. */
  function renderActuals(summary) {
    const cur = summary.project.currency || 'USD';
    const list = byId('projectActualsList');
    const lineNames = new Map(summary.lines.map((l) => [l.lineId, l.name]));
    if (!summary.actuals.length) {
      list.replaceChildren(el('li', { className: 'proj-actual-meta', text: 'No actuals recorded yet.' }));
      return;
    }
    list.replaceChildren(...summary.actuals.map((a) => buildActualRow(a, lineNames, cur, summary.project.projectId)));
  }

  /** Render the selected project detail panel. */
  function renderDetail(summary) {
    const detail = byId('projectDetail');
    if (!summary) { detail.hidden = true; return; }
    detail.hidden = false;
    byId('projectDetailTitle').textContent = summary.project.name;
    const meta = ['Status: ' + summary.project.status, summary.project.externalRef ? 'Ref: ' + summary.project.externalRef : ''].filter(Boolean).join(' · ');
    byId('projectDetailMeta').textContent = meta;
    byId('projectOverBadge').hidden = !summary.overBudget;
    renderSummaryCards(summary);
    renderLines(summary);
    renderActuals(summary);
  }

  /** Render clickable project list pills with budget vs actual preview. */
  function renderProjectList() {
    const badge = byId('projectsCountBadge');
    badge.textContent = projects.length + (projects.length === 1 ? ' project' : ' projects');
    const host = byId('projectList');
    if (!projects.length) {
      host.replaceChildren(el('span', { className: 'proj-actual-meta', text: 'No projects yet. Create one above to track budget vs actual.' }));
      renderDetail(null);
      return;
    }
    const buttons = projects.map((p) => {
      const btn = el('button', {
        type: 'button',
        className: 'proj-pill',
        'aria-pressed': String(p.projectId === selectedId),
      }, [
        el('span', { text: p.name }),
        el('span', {
          className: 'proj-badge' + (p.overBudget ? ' over' : ''),
          text: formatCents(p.actualCents, p.currency) + ' / ' + formatCents(p.budgetCents, p.currency),
        }),
      ]);
      btn.addEventListener('click', () => selectProject(p.projectId));
      return btn;
    });
    host.replaceChildren(...buttons);
  }

  /** Load full summary for a chosen project. */
  async function selectProject(projectId) {
    selectedId = projectId;
    renderProjectList();
    try {
      const summary = await projApi('/projects/' + encodeURIComponent(projectId) + '/summary');
      renderDetail(summary);
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  /** Refresh project list from server while preserving selection if present. */
  async function refreshList(preferId) {
    try {
      const data = await projApi('/projects');
      projects = Array.isArray(data.projects) ? data.projects : [];
      if (preferId && projects.some((p) => p.projectId === preferId)) selectedId = preferId;
      else if (!selectedId || !projects.some((p) => p.projectId === selectedId)) selectedId = projects[0] ? projects[0].projectId : null;
      renderProjectList();
      if (selectedId && !preferId) await selectProject(selectedId);
    } catch (err) {
      if (err.status !== 404) setStatus(err.message, true);
    }
  }

  /** Bind the create-project form submission handler. */
  function bindProjectForm() {
    byId('projectForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = byId('projectName').value.trim();
      const budgetCents = parseDollarsToCents(byId('projectBudget').value, true);
      const externalRef = byId('projectExternalRef').value.trim();
      if (!name) { setStatus('Enter a project name.', true); return; }
      if (budgetCents === null) { setStatus('Enter budget as a dollar amount (e.g. 1000.00).', true); return; }
      try {
        const created = await projApi('/projects', {
          method: 'POST',
          body: { name, budgetCents, ...(externalRef ? { externalRef } : {}) },
        });
        byId('projectName').value = '';
        byId('projectBudget').value = '';
        byId('projectExternalRef').value = '';
        setStatus('Project created.', false);
        selectedId = created.project.projectId;
        renderDetail(created);
        await refreshList(selectedId);
      } catch (err) { setStatus(err.message, true); }
    });
  }

  /** Bind the add-allocation-line form submission handler. */
  function bindLineForm() {
    byId('projectLineForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!selectedId) { setStatus('Select a project first.', true); return; }
      const name = byId('lineName').value.trim();
      const channel = byId('lineChannel').value.trim() || 'general';
      const budgetCents = parseDollarsToCents(byId('lineBudget').value, true);
      const committedCents = parseDollarsToCents(byId('lineCommitted').value, true);
      if (!name) { setStatus('Enter a line name.', true); return; }
      if (budgetCents === null || committedCents === null) { setStatus('Enter valid dollar amounts for line budget and committed.', true); return; }
      try {
        const res = await projApi('/projects/' + encodeURIComponent(selectedId) + '/lines', {
          method: 'POST',
          body: { name, channel, budgetCents, committedCents },
        });
        byId('lineName').value = '';
        byId('lineBudget').value = '';
        byId('lineCommitted').value = '';
        setStatus('Allocation line added.', false);
        renderDetail(res.summary);
        await refreshList(selectedId);
      } catch (err) { setStatus(err.message, true); }
    });
  }

  /** Bind the record-actual form submission handler. */
  function bindActualForm() {
    const dateInput = byId('actualDate');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    byId('projectActualForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!selectedId) { setStatus('Select a project first.', true); return; }
      const lineId = byId('actualLine').value || null;
      const source = byId('actualSource').value;
      const amountCents = parseDollarsToCents(byId('actualAmount').value, false);
      const occurredOn = byId('actualDate').value;
      const note = byId('actualNote').value.trim();
      if (amountCents === null) { setStatus('Enter a positive dollar amount for the actual.', true); return; }
      try {
        const res = await projApi('/projects/' + encodeURIComponent(selectedId) + '/actuals', {
          method: 'POST',
          body: { lineId, source, amountCents, occurredOn, note },
        });
        byId('actualAmount').value = '';
        byId('actualNote').value = '';
        setStatus('Actual recorded.', false);
        renderDetail(res.summary);
        await refreshList(selectedId);
      } catch (err) { setStatus(err.message, true); }
    });
  }

  /** Bind form submissions for project creation, line allocation, and actual entry. */
  function bindForms() {
    bindProjectForm();
    bindLineForm();
    bindActualForm();
  }

  bindForms();
  void refreshList(null);
})();
