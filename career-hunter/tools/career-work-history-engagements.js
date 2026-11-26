/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4 (Roger, 2026-11-16 20:45Z: "i can not find where to see my expanded experience.. it doesnt show anywhere and it was very hard to obtain to begin with because it covers like 20 different companies over a 4 year span when i was consulting in the field"). Work history's Expanded experience: every client engagement the main résumé holds (its project ledger) and every client account group, read whole from GET /resume/doc?id=master (`expanded`). An engagement placed under a job shows on that job's card; the rest show under "Not placed under a job yet" with Place all under [job]. Each engagement shows its name, role, industry, months or length, technology, bullets and marked not public, and opens as a form (client or project, role, industry, start and end month and year, length in months, technology, the job it was done under, marked not public, bullets added, edited, moved and removed); Add an engagement, Move up, Move down and Remove (after confirming). Client accounts show by group and open as one name per line; Add a group. Every save goes through the page's revision-checked main-résumé save with the changed-with-Undo bar. A form being typed in keeps what was typed across redraws, and a refused save says why in the form itself. The layout follows LinkedIn's Experience and Projects sections ("Associated with" a position): the client work sits with the job it was done under.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION: an engagement's form has a Location box (City, State) under Industry, and its card shows the saved location beside its role and industry.
 */
(function (win) {
  'use strict';
  var doc = win.document, W = win.CareerWorkHistory;
  var E = { editing: null, node: null };

  function page() { return win.CareerWorkHistoryPage; }
  function el(tag, attrs, children) { return page().el(tag, attrs, children); }
  function expanded() { var d = page().state.doc; return (d && d.expanded) || { engagements: [], accounts: [], addendum: '' }; }
  function jobs() { var d = page().state.doc; return (d && d.resume && d.resume.experience) || []; }
  function jobName(index) { var role = jobs()[index]; return role ? role.title + (role.org ? ' at ' + role.org : '') : ''; }
  function editingKey(editing) { return editing ? [editing.kind, editing.index, editing.key, editing.job].join('|') : ''; }
  function isEditing(kind, index) { return Boolean(E.editing && E.editing.kind === kind && E.editing.index === index); }
  function under(jobIndex) { return expanded().engagements.filter(function (e) { return (e.job ? e.job.index : null) === jobIndex; }); }

  /** The form being typed in is kept as it is across redraws (the same node), so a save that is refused loses nothing. */
  function keep(build) {
    var key = editingKey(E.editing);
    if (!E.node || E.node.dataset.key !== key) { E.node = build(); E.node.dataset.key = key; }
    return E.node;
  }

  function timing(e) {
    var when = W.engagementSpan(e.start, e.end), length = W.lengthLabel(e.months);
    return when && length ? when + ' (' + length + ')' : (when || length);
  }

  function card(e) {
    var meta = [e.role, e.industry, e.location, timing(e)].filter(Boolean).join(' · ');
    var details = [e.tech.length ? 'Technology: ' + e.tech.join(', ') : ''].concat((e.other || []).map(function (pair) { return pair[0] + ': ' + pair[1]; })).filter(Boolean);
    return el('li', { class: 'wh-eng', 'data-eng-index': String(e.index) }, [
      el('div', { class: 'wh-job-head' }, [
        el('div', {}, [el('h4', { text: e.project || 'Untitled engagement' }), meta ? el('p', { class: 'wh-meta', text: meta }) : null,
          e.public === false ? el('p', { class: 'wh-tag', text: 'Marked not public' }) : null]),
        el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'edit', 'data-index': String(e.index), 'aria-label': 'Edit ' + (e.project || 'this engagement'), text: 'Edit' }),
      ]),
    ].concat(details.map(function (line) { return el('p', { class: 'wh-meta wh-eng-detail', text: line }); }),
      e.bullets.length ? [el('ul', { class: 'wh-bullets' }, e.bullets.map(function (text) { return el('li', { text: text }); }))] : []));
  }

  function monthPair(prefix, label, value) {
    var part = W.parseMonth(value);
    var month = el('select', { name: prefix + 'Month', 'aria-label': label + ' month' }, [el('option', { value: '', text: 'Month' })]
      .concat(W.MONTHS.map(function (name, n) { var code = String(n + 1).padStart(2, '0'); return el('option', { value: code, text: name, selected: part.month === code }); })));
    var year = el('input', { name: prefix + 'Year', inputmode: 'numeric', maxlength: '12', placeholder: 'Year', 'aria-label': label + ' year', value: part.year });
    return el('fieldset', { class: 'wh-month' }, [el('legend', { text: label }), month, year]);
  }

  function input(name, label, value, extra) {
    return el('label', { class: 'wh-label' }, [el('span', { text: label }),
      el('input', Object.assign({ name: name, value: value == null ? '' : String(value), autocomplete: 'off', maxlength: '200' }, extra || {}))]);
  }

  function jobSelect(jobIndex) {
    var options = [el('option', { value: '', text: 'Not under a job', selected: jobIndex == null })].concat(jobs().map(function (role, n) {
      var years = [W.parseMonth(role.start).year, role.end ? W.parseMonth(role.end).year : 'now'].filter(Boolean).join('–');
      return el('option', { value: String(n), text: [role.title, role.org, years].filter(Boolean).join(' · '), selected: jobIndex === n });
    }));
    return el('label', { class: 'wh-label' }, [el('span', { text: 'Done under' }), el('select', { name: 'job', 'aria-label': 'Done under' }, options)]);
  }

  function bulletRow(text, orig) {
    var area = el('textarea', { class: 'wh-eng-bullet', rows: '2', 'aria-label': 'Engagement bullet', 'data-orig': orig == null ? '' : String(orig) });
    area.value = text || '';
    return el('li', { class: 'wh-bullet' }, [area, el('div', { class: 'wh-bullet-tools' }, [
      el('button', { type: 'button', class: 'ck-icon', 'data-eng': 'bullet-up', 'aria-label': 'Move engagement bullet up', text: '↑' }),
      el('button', { type: 'button', class: 'ck-icon', 'data-eng': 'bullet-down', 'aria-label': 'Move engagement bullet down', text: '↓' }),
      el('button', { type: 'button', class: 'ck-icon', 'data-eng': 'bullet-remove', 'aria-label': 'Remove engagement bullet', text: '×' }),
    ])]);
  }

  function neighbours(e) {
    var group = under(e.job ? e.job.index : null), at = group.findIndex(function (other) { return other.index === e.index; });
    return { before: at > 0 ? group[at - 1] : null, after: at >= 0 && at < group.length - 1 ? group[at + 1] : null };
  }

  function editorFoot(e, isNew) {
    var near = isNew ? {} : neighbours(e);
    return el('div', { class: 'wh-form-foot' }, [
      el('button', { type: 'submit', class: 'ck-primary', text: isNew ? 'Add this engagement' : 'Save engagement' }),
      el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'cancel', text: 'Cancel' }),
      near.before ? el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'move', 'data-to': String(near.before.index), text: 'Move up' }) : null,
      near.after ? el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'move', 'data-to': String(near.after.index), text: 'Move down' }) : null,
      isNew ? null : el('button', { type: 'button', class: 'ck-danger wh-remove', 'data-eng': 'remove', text: 'Remove this engagement' }),
    ]);
  }

  function editor(e, isNew, jobIndex) {
    var rows = (e.bullets.length ? e.bullets : (isNew ? [''] : [])).map(function (text, n) { return bulletRow(text, isNew ? null : n); });
    var form = el('form', { class: 'wh-eng-form', novalidate: true, 'aria-label': isNew ? 'Add an engagement' : 'Edit ' + e.project }, [
      el('h4', { text: isNew ? 'Add an engagement' : 'Edit engagement' }),
      input('project', 'Client or project', e.project, { required: true }), input('role', 'Your role', e.role), input('industry', 'Industry', e.industry),
      input('location', 'Location', e.location, { maxlength: '120', placeholder: 'City, State' }),
      el('div', { class: 'wh-dates' }, [monthPair('engStart', 'Engagement start', e.start), monthPair('engEnd', 'Engagement end', e.end)]),
      input('months', 'Length in months', e.months, { inputmode: 'decimal', maxlength: '8' }),
      input('tech', 'Technology (separate with commas)', e.tech.join(', '), { maxlength: '2000' }),
      jobSelect(jobIndex),
      el('label', { class: 'wh-check' }, [el('input', { type: 'checkbox', name: 'notPublic', checked: e.public === false }), el('span', { text: 'Marked not public' })]),
      el('h5', { text: 'Bullets' }), el('ol', { class: 'wh-bullet-list' }, rows),
      el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'add-bullet', text: 'Add a bullet' }),
      el('p', { class: 'wh-error', role: 'alert', hidden: true }), editorFoot(e, isNew),
    ]);
    return el('li', { class: 'wh-eng wh-eng-editing' }, [form]);
  }

  var BLANK = { project: '', role: '', industry: '', location: '', start: '', end: '', months: null, tech: [], bullets: [], job: null, public: true };
  function itemsFor(list, newJob) {
    var items = list.map(function (e) { return isEditing('engagement', e.index) ? keep(function () { return editor(e, false, e.job ? e.job.index : null); }) : card(e); });
    if (isEditing('engagement', 'new') && E.editing.job === newJob) items.unshift(keep(function () { return editor(BLANK, true, newJob); }));
    return items;
  }

  /**
   * @description The Client engagements part of one job's card on Work history: the engagements placed under it, with Add an
   * engagement, or nothing when it has none and none is being added to it.
   * @param {number} jobIndex the job's place in Work history @returns {HTMLElement|null}
   */
  function underJob(jobIndex) {
    var list = under(jobIndex), items = itemsFor(list, jobIndex);
    if (!items.length) return null;
    return el('section', { class: 'wh-eng-group', 'aria-label': 'Client engagements under ' + jobName(jobIndex) }, [
      el('h3', { class: 'wh-eng-head', text: 'Client engagements (' + list.length + ')' }),
      el('ol', { class: 'wh-engs' }, items),
      el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'add', 'data-job': String(jobIndex), text: 'Add an engagement' }),
    ]);
  }

  function placeControl(count) {
    var select = el('select', { id: 'whPlaceJob', 'aria-label': 'Job to place them under' }, [el('option', { value: '', text: 'Choose a job' })]
      .concat(jobs().map(function (role, n) { return el('option', { value: String(n), text: [role.title, role.org].filter(Boolean).join(' · ') }); })));
    return el('div', { class: 'wh-place' }, [el('label', { for: 'whPlaceJob', text: 'Place all ' + count + ' under' }), select,
      el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'place', text: 'Place them' })]);
  }

  function renderEngagements() {
    var all = expanded().engagements, loose = under(null), items = itemsFor(loose, null), placed = all.length - loose.length;
    $('whEngCount').textContent = 'Client engagements (' + all.length + ')';
    $('whEngIntro').textContent = !all.length ? 'No client engagements yet. Add one for each client or project you worked on.'
      : placed ? placed + ' of them show on the card of the job you did them in, above.' : 'Place each one under the job you did it in, and it shows on that job\'s card.';
    $('whLooseHead').hidden = !loose.length;
    $('whLooseHead').textContent = 'Not placed under a job yet (' + loose.length + ')';
    $('whPlace').replaceChildren.apply($('whPlace'), loose.length && jobs().length ? [placeControl(loose.length)] : []);
    $('whLoose').replaceChildren.apply($('whLoose'), items);
  }

  function groupView(group) {
    return el('li', { class: 'wh-group', 'data-key': group.key }, [
      el('div', { class: 'wh-job-head' }, [el('h4', { text: group.label + ' (' + group.items.length + ')' }),
        el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'group-edit', 'data-key': group.key, 'aria-label': 'Edit ' + group.label, text: 'Edit' })]),
      el('ul', { class: 'wh-names' }, group.items.map(function (name) { return el('li', { text: name }); })),
    ]);
  }

  function groupEditor(group) {
    var isNew = !group, names = el('textarea', { name: 'names', rows: String(Math.min(14, (group ? group.items.length : 0) + 3)), 'aria-label': 'Names, one per line' });
    names.value = group ? group.items.join('\n') : '';
    return el('li', { class: 'wh-group wh-eng-editing' }, [el('form', { class: 'wh-eng-form', novalidate: true, 'aria-label': isNew ? 'Add a group' : 'Edit ' + group.label }, [
      el('h4', { text: isNew ? 'Add a group of client accounts' : 'Edit ' + group.label }),
      isNew ? input('group', 'Group name', '', { maxlength: '80' }) : null,
      el('label', { class: 'wh-label' }, [el('span', { text: 'Names, one per line' }), names]),
      el('p', { class: 'wh-error', role: 'alert', hidden: true }),
      el('div', { class: 'wh-form-foot' }, [el('button', { type: 'submit', class: 'ck-primary', text: isNew ? 'Add this group' : 'Save group' }),
        el('button', { type: 'button', class: 'ck-btn', 'data-eng': 'cancel', text: 'Cancel' }),
        isNew ? null : el('button', { type: 'button', class: 'ck-danger wh-remove', 'data-eng': 'group-remove', text: 'Remove this group' })]),
    ])]);
  }

  function renderAccounts() {
    var groups = expanded().accounts, total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    $('whAccCount').textContent = 'Client accounts (' + total + ')';
    $('whAccIntro').textContent = groups.length ? 'The companies and agencies you worked with, by group.' : 'No client accounts yet. Add a group of the companies you worked with.';
    var items = groups.map(function (g) { return isEditing('group', g.key) ? keep(function () { return groupEditor(g); }) : groupView(g); });
    if (isEditing('group', 'new')) items.unshift(keep(function () { return groupEditor(null); }));
    $('whGroups').replaceChildren.apply($('whGroups'), items);
  }

  function $(id) { return doc.getElementById(id); }

  /** @description Draw Expanded experience and the summary line from the page's last read; called by the page's render(). */
  function render() {
    var d = page().state.doc, has = Boolean(page().state.revision);
    if (!E.editing) E.node = null;
    $('whExpanded').hidden = !has;
    $('whSummary').hidden = !has;
    if (!has) return;
    var x = expanded(), accounts = x.accounts.reduce(function (n, g) { return n + g.items.length; }, 0);
    $('whSumJobs').textContent = jobs().length + (jobs().length === 1 ? ' job' : ' jobs');
    $('whSumEng').textContent = x.engagements.length + (x.engagements.length === 1 ? ' client engagement' : ' client engagements');
    $('whSumAcc').textContent = accounts + (accounts === 1 ? ' client account' : ' client accounts');
    renderEngagements(); renderAccounts();
    $('whAddendum').hidden = !x.addendum;
    $('whAddendumLink').href = x.addendum || '#';
    var active = $('whExpanded').querySelector('.wh-eng-editing input[name=project], .wh-eng-editing textarea[name=names], .wh-eng-editing input[name=group]');
    if (active && E.focus) { E.focus = false; active.focus(); }
    return d;
  }

  function open(editing) {
    if (page().state.editing != null) { page().notice('Save or cancel the job you are editing first.'); return; }
    E.editing = editing; E.node = null; E.focus = true; page().render();
  }
  function close() { E.editing = null; E.node = null; }

  function readForm(form) {
    var v = function (name) { var field = form.elements[name]; return field ? String(field.value || '').trim() : ''; };
    var months = v('months'), job = v('job');
    return {
      project: v('project'), role: v('role'), industry: v('industry'), location: v('location'),
      start: W.composeMonth(v('engStartYear'), v('engStartMonth')), end: W.composeMonth(v('engEndYear'), v('engEndMonth')),
      months: months === '' ? null : Number(months.replace(',', '.')),
      tech: v('tech').split(',').map(function (item) { return item.trim(); }).filter(Boolean),
      job: job === '' ? null : { index: Number(job), title: jobs()[Number(job)].title },
      public: !form.elements.notPublic.checked,
      bullets: Array.from(form.querySelectorAll('.wh-eng-bullet')).map(function (area) { return { orig: area.dataset.orig === '' ? null : Number(area.dataset.orig), text: area.value }; }),
      monthsTyped: months, startMonthOnly: Boolean(v('engStartMonth') && !v('engStartYear')), endMonthOnly: Boolean(v('engEndMonth') && !v('engEndYear')),
    };
  }
  function problemOf(data) {
    if (!data.project) return 'Enter the client or project name.';
    if (data.startMonthOnly || data.endMonthOnly) return 'Enter the year as well as the month.';
    if (data.monthsTyped && !(data.months > 0 && data.months <= 600)) return 'Enter the length as a number of months, such as 3 or 0.5, or leave it empty.';
    return '';
  }

  function fail(form, text) { var box = form.querySelector('.wh-error'); box.textContent = text || ''; box.hidden = !text; if (text) box.scrollIntoView({ block: 'nearest' }); }

  async function send(form, edits, done) {
    var ok = await page().save(edits, done, close);
    if (!ok && form && form.isConnected) fail(form, page().state.lastError);
  }

  function submitEngagement(form) {
    var data = readForm(form), problem = problemOf(data), all = expanded().engagements;
    fail(form, problem);
    if (problem) return;
    var saved = E.editing.index === 'new' ? null : all.find(function (e) { return e.index === E.editing.index; });
    var edits = saved ? W.engagementEdits(saved, data) : W.newEngagementEdits(all.length, data);
    if (!edits.length) { close(); page().render(); return; }
    send(form, edits, (saved ? 'Saved ' : 'Added ') + data.project + '.');
  }

  function submitGroup(form) {
    var names = W.namesOf(form.elements.names.value), label = form.elements.group ? String(form.elements.group.value || '').trim() : '';
    var group = E.editing.index === 'new' ? null : expanded().accounts.find(function (g) { return g.key === E.editing.index; });
    var problem = !group && !label ? 'Enter a name for the group.' : !group && !names.length ? 'Enter at least one name, one per line.' : '';
    fail(form, problem);
    if (problem) return;
    var edits = group ? W.groupEdits(group, names) : [{ op: 'add', field: 'accounts', key: label, before: [], value: names }];
    if (!edits.length) { close(); page().render(); return; }
    send(form, edits, group ? (names.length ? 'Saved ' + group.label + '.' : 'Removed ' + group.label + '.') : 'Added ' + label + '.');
  }

  function confirmRemove(title, text, edits, done) {
    var dialog = $('whConfirm');
    $('whConfirmTitle').textContent = title; $('whConfirmText').textContent = text; dialog.returnValue = '';
    dialog.onclose = function () { if (dialog.returnValue === 'remove') send(E.node && E.node.querySelector('form'), edits, done); };
    dialog.showModal();
  }

  function bulletTool(button, action) {
    var row = button.closest('.wh-bullet'), list = row.parentElement;
    if (action === 'bullet-remove') row.remove();
    else if (action === 'bullet-up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    else if (action === 'bullet-down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    if (button.isConnected) button.focus();
  }

  function place() {
    var value = $('whPlaceJob').value, loose = under(null);
    if (value === '') { page().notice('Choose the job to place them under.'); $('whPlaceJob').focus(); return; }
    var role = jobs()[Number(value)];
    send(null, W.placeEdits(loose, { index: Number(value), title: role.title }), 'Placed ' + loose.length + (loose.length === 1 ? ' engagement' : ' engagements') + ' under ' + jobName(Number(value)) + '.');
  }

  function act(button) {
    var action = button.dataset.eng, all = expanded().engagements, current = E.editing && all.find(function (e) { return e.index === E.editing.index; });
    if (action === 'edit') open({ kind: 'engagement', index: Number(button.dataset.index) });
    else if (action === 'add') open({ kind: 'engagement', index: 'new', job: button.dataset.job === '' ? null : Number(button.dataset.job) });
    else if (action === 'group-edit') open({ kind: 'group', index: button.dataset.key });
    else if (action === 'group-add') open({ kind: 'group', index: 'new' });
    else if (action === 'cancel') { close(); page().render(); }
    else if (action === 'add-bullet') { var row = bulletRow('', null); button.previousElementSibling.append(row); row.querySelector('textarea').focus(); }
    else if (action.indexOf('bullet-') === 0) bulletTool(button, action);
    else if (action === 'place') place();
    else if (action === 'move' && current) send(null, [{ op: 'move', field: 'engagement', index: current.index, before: current.project, to: Number(button.dataset.to) }], 'Moved ' + current.project + '.');
    else if (action === 'remove' && current) confirmRemove('Remove this engagement?', 'Remove ' + current.project + ' and its bullets from your expanded experience? Undo puts it back.',
      [{ op: 'remove', field: 'engagement', index: current.index, before: current.project }], 'Removed ' + current.project + '.');
    else if (action === 'group-remove') {
      var group = expanded().accounts.find(function (g) { return g.key === E.editing.index; });
      if (group) confirmRemove('Remove this group?', 'Remove ' + group.label + ' and its ' + group.items.length + ' names? Undo puts them back.',
        [{ op: 'remove', field: 'accounts', key: group.key, before: group.items }], 'Removed ' + group.label + '.');
    }
  }

  function boot() {
    doc.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-eng]');
      if (!button || page().state.busy) return;
      event.preventDefault(); act(button);
    });
    doc.addEventListener('submit', function (event) {
      var form = event.target.closest('.wh-eng-form');
      if (!form) return;
      event.preventDefault();
      if (page().state.busy || !E.editing) return;
      if (E.editing.kind === 'group') submitGroup(form); else submitEngagement(form);
    });
  }

  win.CareerEngagements = {
    render: render, underJob: underJob, readForm: readForm, problemOf: problemOf,
    /** @description Whether an engagement or account form is open (the concierge waits, as it does for a job form). @returns {boolean} */
    draftOpen: function () { return Boolean(E.editing); },
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
}(window));
