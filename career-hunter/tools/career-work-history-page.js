/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: the Work history page's screen. It reads the main résumé with its revision (GET /resume/doc?id=master), draws one card per job, opens a card as a form, saves through POST /resume/master-edit (career-work-history.js builds the edits), shows the changed-with-Undo bar (career-change-bar.js), keeps the Word document on My résumé in step (career-resume-office.js), and registers the page with the shared document handoff so Career's concierge reads it saved and the change it proposes and the person approves is on the page at once, with Undo.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13 ~22:16Z: each new job held his whole pasted draft as one bullet, and that bullet stopped mid-sentence, so the concierge could not quote it). A bullet box no longer carries maxlength 1000, which Chromium applies to a paste by keeping the first 1000 characters; the whole paste is saved, and the engine makes it one bullet per line (master_edit, card_targets.split_lines). Guard: tests/career-work-history-page.test.mjs, the pasted-draft case.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "i cant use the tools to update my resume and see it in the resume tab after adding experience"): the Word document on My résumé follows through CareerResumeOffice.settle, which knows the version the document was made from, so it is brought up to date after every change here whatever it missed before (it used to be left for ever once it was behind). On opening, text typed in the document and never saved is saved into the main résumé first, so this page shows it and nothing here is later written over it.
 */
(function (win) {
  'use strict';
  var doc = win.document, W = win.CareerWorkHistory, API = W.API;
  var state = { doc: null, revision: '', editing: null, busy: false };
  var $ = function (id) { return doc.getElementById(id); };

  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key]; else if (key === 'class') node.className = attrs[key];
      else if (attrs[key] !== false && attrs[key] != null) node.setAttribute(key, attrs[key] === true ? '' : attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.append(child); });
    return node;
  }
  async function request(path, init) {
    var response = await win.fetch(API + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || body.ok === false) throw new Error(body.error || body.message || 'Career could not answer. Try again.');
    return body;
  }
  function roles() { return (state.doc && state.doc.resume && state.doc.resume.experience) || []; }
  function notice(text) { $('whNotice').textContent = text || ''; $('whNotice').hidden = !text; }

  async function load() {
    var answer = await request('/resume/doc?id=master');
    state.doc = answer; state.revision = typeof answer.revision === 'string' ? answer.revision : '';
    render();
    return answer;
  }

  function cardView(role, index) {
    var bullets = (role.bullets || []).map(function (text) { return el('li', { text: text }); });
    return el('li', { class: 'wh-job', 'data-job': String(index) }, [
      el('div', { class: 'wh-job-head' }, [
        el('div', {}, [el('h2', { text: role.title || 'Untitled job' }), el('p', { class: 'wh-meta', text: [role.org, W.spanLabel(role.start, role.end)].filter(Boolean).join(' · ') })]),
        el('button', { type: 'button', class: 'ck-btn wh-edit', 'data-edit': String(index), 'aria-label': 'Edit ' + (role.title || 'this job'), text: 'Edit' }),
      ]),
      bullets.length ? el('ul', { class: 'wh-bullets' }, bullets) : el('p', { class: 'wh-meta', text: 'No bullets yet.' }),
    ]);
  }

  function monthField(prefix, label, value, disabled) {
    var part = W.parseMonth(value), id = 'wh-' + prefix;
    var month = el('select', { id: id + '-month', name: prefix + 'Month', 'aria-label': label + ' month', disabled: disabled },
      [el('option', { value: '', text: 'Month' })].concat(W.MONTHS.map(function (name, n) {
        var code = String(n + 1).padStart(2, '0'); return el('option', { value: code, text: name, selected: part.month === code });
      })));
    var year = el('input', { id: id + '-year', name: prefix + 'Year', inputmode: 'numeric', maxlength: '12', placeholder: 'Year', 'aria-label': label + ' year', value: part.year, disabled: disabled });
    return el('fieldset', { class: 'wh-month' }, [el('legend', { text: label }), month, year]);
  }

  function bulletRow(text, orig) {
    // No maxlength: a browser cuts a longer paste there without a word. The engine turns a pasted draft into one bullet
    // per line and refuses, in words, a single line over its 1000-character bullet limit.
    var area = el('textarea', { class: 'wh-bullet-text', rows: '2', 'aria-label': 'Bullet', 'data-orig': orig == null ? '' : String(orig) });
    area.value = text || '';
    return el('li', { class: 'wh-bullet' }, [area, el('div', { class: 'wh-bullet-tools' }, [
      el('button', { type: 'button', class: 'ck-icon', 'data-bullet': 'up', 'aria-label': 'Move bullet up', text: '↑' }),
      el('button', { type: 'button', class: 'ck-icon', 'data-bullet': 'down', 'aria-label': 'Move bullet down', text: '↓' }),
      el('button', { type: 'button', class: 'ck-icon', 'data-bullet': 'remove', 'aria-label': 'Remove bullet', text: '×' }),
    ])]);
  }

  function editorFooter(index, isNew) {
    var count = roles().length, move = !isNew && count > 1;
    return el('div', { class: 'wh-form-foot' }, [
      el('button', { type: 'submit', class: 'ck-primary', text: isNew ? 'Add this job' : 'Save' }),
      el('button', { type: 'button', class: 'ck-btn', 'data-cancel': '', text: 'Cancel' }),
      move && index > 0 ? el('button', { type: 'button', class: 'ck-btn', 'data-move': '-1', text: 'Move up' }) : null,
      move && index < count - 1 ? el('button', { type: 'button', class: 'ck-btn', 'data-move': '1', text: 'Move down' }) : null,
      isNew ? null : el('button', { type: 'button', class: 'ck-danger wh-remove', 'data-remove': '', text: 'Remove this job' }),
    ]);
  }

  function editor(role, index) {
    var isNew = index === 'new', current = !role.end, list = el('ol', { class: 'wh-bullet-list' },
      (role.bullets || []).map(function (text, n) { return bulletRow(text, isNew ? null : n); }));
    var field = function (name, label, value) { var id = 'wh-' + name; return el('label', { for: id, class: 'wh-label' }, [el('span', { text: label }), el('input', { id: id, name: name, maxlength: '200', required: true, value: value || '', autocomplete: 'off' })]); };
    return el('li', { class: 'wh-job wh-editing', 'data-job': String(index) }, [el('form', { class: 'wh-form', novalidate: true, 'aria-label': isNew ? 'Add a job' : 'Edit ' + role.title }, [
      el('h2', { text: isNew ? 'Add a job' : 'Edit job' }),
      field('title', 'Job title', role.title), field('org', 'Employer', role.org),
      el('div', { class: 'wh-dates' }, [monthField('start', 'Start', role.start, false), monthField('end', 'End', role.end, current)]),
      el('label', { class: 'wh-check' }, [el('input', { type: 'checkbox', name: 'current', checked: current }), el('span', { text: 'I work here now' })]),
      el('h3', { text: 'Bullets' }), list,
      el('button', { type: 'button', class: 'ck-btn', 'data-add-bullet': '', text: 'Add a bullet' }),
      el('p', { class: 'wh-error', role: 'alert', hidden: true }),
      editorFooter(index, isNew),
    ])]);
  }

  function render() {
    var list = $('whJobs'), noProfile = !state.revision, jobs = roles();
    $('whEmpty').hidden = !(noProfile || (!jobs.length && state.editing == null));
    $('whEmptyText').textContent = noProfile ? 'Upload your résumé on My résumé first; Career builds your work history from it. Then add or change jobs here.'
      : 'No jobs yet. Add your most recent job first.';
    $('whUpload').hidden = !noProfile; $('whAdd').hidden = noProfile;
    var cards = jobs.map(function (role, index) { return state.editing === index ? editor(role, index) : cardView(role, index); });
    if (state.editing === 'new') cards.unshift(editor({ title: '', org: '', start: '', end: '', bullets: [''] }, 'new'));
    list.replaceChildren.apply(list, cards);
    $('whAdd').disabled = state.busy || state.editing != null;
    var first = list.querySelector('.wh-editing input[name=title]');
    if (first && doc.activeElement === doc.body) first.focus({ preventScroll: false });
  }

  function readForm(form) {
    var value = function (name) { var input = form.elements[name]; return input ? String(input.value || '').trim() : ''; };
    var current = form.elements.current.checked;
    return { title: value('title'), org: value('org'),
      start: W.composeMonth(value('startYear'), value('startMonth')),
      end: current ? '' : W.composeMonth(value('endYear'), value('endMonth')),
      bullets: Array.from(form.querySelectorAll('.wh-bullet-text')).map(function (area) { return { orig: area.dataset.orig === '' ? null : Number(area.dataset.orig), text: area.value }; }) };
  }
  function formProblem(form, data) {
    if (!data.title || !data.org) return 'Enter the job title and the employer.';
    if (!data.start) return 'Enter the year you started (the month is optional).';
    if (!form.elements.current.checked && !data.end) return 'Enter the year you left, or tick I work here now.';
    return '';
  }

  /** Keep the Word document on My résumé in step with the main résumé as it is now; a failure here never undoes the save. */
  async function followInWord(before, after) {
    try { if (win.CareerResumeOffice) await win.CareerResumeOffice.settle({ master: after, before: before }); }
    catch (_) { /* AI Office is optional; My résumé brings its document up to date when it opens */ }
  }
  /** On opening: text typed in the Word document and never saved goes into the main résumé first, so this page shows it. */
  async function takeTyped() {
    if (!win.CareerResumeOffice || !state.revision) return;
    var outcome = await win.CareerResumeOffice.settle({ save: true, master: state.doc });
    if (outcome.changed && state.editing == null) await load();
  }

  /** Show the change with Undo, which puts back the version before it and redraws the page. */
  function announce(text, before, after) {
    win.CareerChangeBar.show({ text: text, undo: before && after && before !== after ? async function () {
      await win.CareerChangeBar.undoRequest(before, after);
      var prior = state.doc; await load(); await followInWord(prior, state.doc);
      win.CareerChangeBar.show({ text: 'Put back. Your work history is as it was.' });
    } : null });
  }

  /** Send the edits in order, each request on the revision the last one answered; one change, one Undo. */
  async function save(edits, done) {
    if (!edits.length) { state.editing = null; render(); return; }
    var before = state.revision, revision = before, prior = state.doc;
    state.busy = true; notice('Saving…');
    try {
      for (var part of W.chunks(edits)) {
        var answer = await request('/resume/master-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: revision, edits: part }) });
        revision = answer.revision;
      }
      state.editing = null; notice('');
      await load(); await followInWord(prior, state.doc);
      announce(done, before, state.revision);
    } catch (error) {
      notice(revision !== before ? 'Part of this change was saved: ' + error.message : error.message);
      if (revision !== before) { await load().catch(function () {}); announce('Part of the change was saved.', before, revision); }
    } finally { state.busy = false; render(); }
  }

  function submit(form) {
    var index = state.editing, data = readForm(form), problem = formProblem(form, data), error = form.querySelector('.wh-error');
    error.textContent = problem; error.hidden = !problem;
    if (problem) return;
    var job = roles()[index];
    var edits = index === 'new' ? W.newRoleEdits(data) : W.roleEdits(index, job, data);
    var name = data.title + (data.org ? ' at ' + data.org : '');
    save(edits, index === 'new' ? 'Added ' + name + '.' : 'Saved ' + name + '.');
  }

  function moveJob(index, step) {
    var job = roles()[index];
    save([{ op: 'move', field: 'role', roleIndex: index, roleTitle: job.title, before: job.title, to: index + step }], 'Moved ' + job.title + '.');
  }

  function removeJob(index) {
    var job = roles()[index], dialog = $('whConfirm');
    $('whConfirmText').textContent = 'Remove ' + job.title + (job.org ? ' at ' + job.org : '') + ' and its bullets from your work history? Undo puts it back.';
    dialog.returnValue = '';
    dialog.onclose = function () {
      if (dialog.returnValue === 'remove') save([{ op: 'remove', field: 'role', roleIndex: index, roleTitle: job.title, before: job.title }], 'Removed ' + job.title + '.');
    };
    dialog.showModal();
  }

  function bulletTool(button) {
    var row = button.closest('.wh-bullet'), list = row.parentElement, action = button.dataset.bullet;
    if (action === 'remove') { row.remove(); return; }
    if (action === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (action === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    button.focus();
  }

  function click(event) {
    var target = event.target.closest('button'); if (!target || state.busy) return;
    var card = target.closest('.wh-job'), index = card && card.dataset.job !== 'new' ? Number(card.dataset.job) : state.editing;
    if (target.id === 'whAdd') { state.editing = 'new'; render(); }
    else if (target.dataset.edit != null) { state.editing = Number(target.dataset.edit); render(); }
    else if (target.dataset.cancel != null) { state.editing = null; render(); }
    else if (target.dataset.addBullet != null) { var list = card.querySelector('.wh-bullet-list'), row = bulletRow('', null); list.append(row); row.querySelector('textarea').focus(); }
    else if (target.dataset.bullet) bulletTool(target);
    else if (target.dataset.move) moveJob(index, Number(target.dataset.move));
    else if (target.dataset.remove != null) removeJob(index);
  }

  /** An open form with changes is the person's own draft: the concierge waits for Save or Cancel instead of replacing it. */
  function draftOpen() {
    var form = doc.querySelector('.wh-editing form'); if (!form) return false;
    if (state.editing === 'new') return true;
    return W.roleEdits(state.editing, roles()[state.editing], readForm(form)).length > 0;
  }

  function registerHandoff() {
    return import('/shared/ui/js/document-handoff.js').then(function (module) {
      module.registerDocumentSession({ app: 'career-hunter', win: win,
        prepare: async function () {
          if (draftOpen()) throw new Error('Save or cancel the job you are editing, then ask again.');
          await load();
          return { app: 'career-hunter', screen: 'surface', surface: 'work-history', recordId: 'master', title: 'Work history',
            fields: { revision: state.revision, jobs: roles().length, readOnly: false, draft: false,
              editWith: 'career_resume_patch: field role for a job, field experience for its bullets' } };
        },
        refresh: async function () {
          if (draftOpen()) return;
          var before = state.revision, prior = state.doc; await load();
          if (before && state.revision && before !== state.revision) { await followInWord(prior, state.doc); announce('The change you approved is on the page.', before, state.revision); }
        } });
    }).catch(function () { notice('The concierge cannot see this page right now. Your work history still saves here.'); });
  }

  function boot() {
    doc.addEventListener('click', click);
    doc.addEventListener('submit', function (event) { if (event.target.closest('.wh-form')) { event.preventDefault(); if (!state.busy) submit(event.target); } });
    doc.addEventListener('change', function (event) {
      if (event.target.name !== 'current') return;
      var form = event.target.form; ['endMonth', 'endYear'].forEach(function (name) { form.elements[name].disabled = event.target.checked; });
    });
    notice('Loading your work history…');
    load().then(function () { notice(''); return takeTyped(); }).catch(function (error) { notice('Your work history could not be read. ' + error.message); });
    registerHandoff();
  }

  win.CareerWorkHistoryPage = { state: state, load: load, render: render, readForm: readForm, formProblem: formProblem, save: save };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
}(window));
