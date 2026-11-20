/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24 (Roger, 2026-11-19: "i have to be able to generate accurate resumes ... i cant have random numbers 2 years vs 11 years vs 20 years getting out of place"): Work history's Years by skill section. Résumé generation has stated a person's own years since 1.68.22 and no screen wrote them. The section reads every skill with the years counted from the roles, the person's own figure and what a résumé states (GET /resume/master-section?field=years, with the main résumé's revision), draws it with DOM nodes only, and saves the whole form as one revision-checked main-résumé edit (POST /resume/master-edit, field years), then Undo (POST /resume/master-undo). The page sends what was typed and nothing else: an empty box is no figure, a box that holds no number is sent as it is so the server refuses it in words, and a refusal is shown in the server's words. After a save the table is what the server answers. Figures typed and not yet saved survive the page reading the main résumé again (a job saved, the concierge asking).
 */
(function (win) {
  'use strict';
  var doc = win.document, API = '/api/career-hunter/resume/';
  var UNSAVED = 'Not saved yet';
  var state = { revision: '', rows: [], more: 0, total: {}, limits: null, undo: null, error: '', busy: false };

  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key]; else if (key === 'class') node.className = attrs[key];
      else if (attrs[key] !== false && attrs[key] != null) node.setAttribute(key, attrs[key] === true ? '' : attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.append(child); });
    return node;
  }
  function notice(text) { $('yrNotice').textContent = text || ''; $('yrNotice').hidden = !text; }
  function years(value) { return value === 1 ? '1 year' : value + ' years'; }
  function rowEls() { return Array.from($('yrRows').querySelectorAll('tr')); }
  function box(row) { return row.querySelector('input'); }
  function find(name) {
    var wanted = name.toLocaleLowerCase();
    return rowEls().find(function (row) { return row.dataset.skill.toLocaleLowerCase() === wanted; }) || null;
  }

  /** One JSON request; a refusal throws the server's own words with its status. */
  async function request(url, options) {
    var response = await win.fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.ok === false) {
      throw Object.assign(new Error(data.error || data.message || 'Career could not answer. Try again.'), { status: response.status });
    }
    return data;
  }

  /** A years box: empty is no figure. Its bounds come from the server and only guide the stepper; the server checks. */
  function figureBox(label, saved, bounds) {
    var input = el('input', { type: 'number', inputmode: 'decimal', 'aria-label': label,
      min: bounds && bounds.min, max: bounds && bounds.max, step: bounds && bounds.step });
    input.value = saved == null ? '' : String(saved);
    input.dataset.saved = input.value;
    return input;
  }

  /** One skill. A row the person just added has no counted years and no saved figure yet, and says so. */
  function rowView(row, added) {
    var counted = added ? 'Counted when you save' : row.from_roles == null ? 'Not in your roles' : years(row.from_roles);
    var used = added ? UNSAVED : row.used_words;
    return el('tr', { 'data-skill': row.skill, 'data-added': added ? '1' : null }, [
      el('th', { scope: 'row', text: row.skill }),
      el('td', { 'data-label': 'From your roles', text: counted }),
      el('td', { 'data-label': 'Your figure' }, [figureBox('Your figure for ' + row.skill, row.yours, state.limits && state.limits.skill_years)]),
      el('td', { 'data-label': 'Used on résumés', 'data-saved': used, text: used }),
    ]);
  }

  /** Say, beside each figure that differs from the saved one, that it is not saved yet; Save stands out while any is. */
  function mark() {
    var changed = $('yrAddSkill').value.trim() !== '' || $('yrAddYears').value !== '';
    rowEls().forEach(function (row) {
      var input = box(row), cell = row.lastElementChild, differs = input.value !== input.dataset.saved;
      cell.textContent = differs ? UNSAVED : cell.dataset.saved;
      changed = changed || differs || row.dataset.added === '1';
    });
    var total = $('yrCareerYours'), used = $('yrCareerUsed'), differs = total.value !== total.dataset.saved;
    used.textContent = differs ? UNSAVED : used.dataset.saved;
    $('yrSave').className = changed || differs ? 'ck-primary' : 'ck-btn';
  }

  function busy(on) {
    state.busy = on;
    $('yrSave').disabled = on || !state.revision;
    $('yrUndo').disabled = on;
    $('yrAdd').disabled = on;
  }

  function render() {
    var total = state.total, bounds = state.limits && state.limits.career_years, input = $('yrCareerYours');
    $('yrRows').replaceChildren.apply($('yrRows'), state.rows.map(function (row) { return rowView(row, false); }));
    $('yrMore').hidden = !state.more;
    $('yrMore').textContent = state.more ? state.more + (state.more === 1 ? ' more skill' : ' more skills')
      + ' counted from your roles ' + (state.more === 1 ? 'is' : 'are') + ' not listed. Add one below to give your own figure for it.' : '';
    $('yrCareerRoles').textContent = total.career_from_roles == null ? 'No dated roles' : years(total.career_from_roles);
    ['min', 'max', 'step'].forEach(function (name) { if (bounds) input.setAttribute(name, bounds[name]); });
    input.value = total.career_yours == null ? '' : String(total.career_yours);
    input.dataset.saved = input.value;
    $('yrCareerUsed').dataset.saved = total.career_used_words || '';
    $('yrUndo').hidden = !state.undo;
    busy(state.busy);
    mark();
  }

  /** The figures the person changed and has not saved, so a later read of the main résumé does not lose them. */
  function typed() {
    var total = $('yrCareerYours');
    return { total: total.value !== total.dataset.saved ? total.value : null,
      rows: rowEls().filter(function (row) { return row.dataset.added === '1' || box(row).value !== box(row).dataset.saved; })
        .map(function (row) { return { skill: row.dataset.skill, value: box(row).value }; }) };
  }
  function retype(kept) {
    kept.rows.forEach(function (item) {
      var row = find(item.skill);
      if (!row) { row = rowView({ skill: item.skill }, true); $('yrRows').append(row); }
      box(row).value = item.value;
    });
    if (kept.total != null) $('yrCareerYours').value = kept.total;
    mark();
  }

  /**
   * @description Read the person's years by skill and in total with the main résumé's revision, and draw them.
   * Figures typed and not saved are kept over the new read unless `fresh` is asked (after this form's own save or Undo).
   * @param {{profile?: boolean, fresh?: boolean}} [given] `profile: false` when the person has no main résumé yet
   * (the section is hidden and nothing is asked); `fresh: true` to drop unsaved figures.
   * @returns {Promise<object>} The state: revision, rows, more, total, limits, undo, error.
   */
  async function load(given) {
    var options = given || {}, section = $('whYears');
    if (!section) return state;
    if (options.profile === false) { section.hidden = true; Object.assign(state, { revision: '', undo: null }); return state; }
    var keep = !options.fresh && Boolean(state.revision);
    try {
      var data = await request(API + 'master-section?field=years');
      // Read what is typed only now, so a figure typed while the read was on its way is kept too.
      var kept = keep ? typed() : null;
      Object.assign(state, { revision: data.revision || '', rows: Array.isArray(data.rows) ? data.rows : [], more: data.more || 0,
        total: data, limits: data.limits || null, error: '' });
      if (state.undo && state.undo.revision !== state.revision) state.undo = null;
      render();
      if (kept) retype(kept);
    } catch (error) {
      Object.assign(state, { revision: '', error: error.message });
      busy(state.busy);
      notice('Your years by skill could not be read. ' + error.message);
    }
    section.hidden = false;
    return state;
  }

  /** What a years box holds: null when empty, its number, or text the server refuses in words when it is no number. */
  function figure(input) {
    var raw = input.value.trim(), number = Number(raw);
    if ((input.validity && input.validity.badInput) || (raw !== '' && !Number.isFinite(number))) return 'not a number';
    return raw === '' ? null : number;
  }

  /**
   * @description The whole form as POST /resume/master-edit takes it: one row per skill with a figure in its box, the
   * skill still in the Add a skill boxes, and the total. A skill whose box is empty has no figure of the person's.
   * @returns {{years_by_skill: Array<{skill: string, years: (number|string|null)}>, career_years: (number|string|null)}}
   */
  function values() {
    var list = [];
    rowEls().forEach(function (row) {
      var value = figure(box(row));
      if (value !== null) list.push({ skill: row.dataset.skill, years: value });
    });
    var name = $('yrAddSkill').value.trim(), extra = figure($('yrAddYears'));
    if (name || extra !== null) list.push({ skill: name, years: extra });
    return { years_by_skill: list, career_years: figure($('yrCareerYours')) };
  }

  /** Work history holds the same revision: it follows this form's own change, and its Undo bar for an earlier change goes. */
  function follow(before, after) {
    var page = win.CareerWorkHistoryPage;
    if (before === after) return;
    if (page && page.state.revision === before) page.state.revision = after;
    if (win.CareerChangeBar) win.CareerChangeBar.hide();
  }

  async function save(event) {
    event.preventDefault();
    if (state.busy || !state.revision) return;
    var before = state.revision;
    busy(true); notice('Saving your years…');
    try {
      var result = await request(API + 'master-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: before, edits: [{ op: 'set', field: 'years', value: values(), summary: 'Years by skill edited on Work history' }] }) });
      if (result.changed) state.undo = { revision: result.revision, restore: before };
      follow(before, result.revision);
      $('yrAddSkill').value = ''; $('yrAddYears').value = '';
      await load({ fresh: true });
      notice(state.error ? 'Saved. Your years could not be read again: ' + state.error
        : result.changed ? 'Saved. Your next résumé and cover letter state these years.' : 'Nothing changed; your years already read this way.');
    } catch (error) {
      if (error.status === 409) await load({ fresh: true });
      notice(error.message);
    } finally { busy(false); }
  }

  async function undo() {
    if (!state.undo || state.busy) return;
    var change = state.undo;
    busy(true);
    try {
      var result = await request(API + 'master-undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
      state.undo = null;
      follow(change.revision, result.revision);
      await load({ fresh: true });
      notice('Undone. Your years are as they were before that save.');
    } catch (error) {
      if (error.status === 409) { state.undo = null; await load(); }
      notice(error.message);
    } finally { busy(false); }
  }

  /** Add a skill: its row joins the table (or its years go to the row the skill already has), unsaved until Save years. */
  function add() {
    var nameBox = $('yrAddSkill'), yearsBox = $('yrAddYears'), name = nameBox.value.trim();
    if (!name) { notice('Name the skill to add.'); nameBox.focus(); return; }
    var row = find(name);
    if (!row) { row = rowView({ skill: name }, true); $('yrRows').append(row); }
    if (yearsBox.value !== '') box(row).value = yearsBox.value;
    nameBox.value = ''; yearsBox.value = '';
    notice(''); mark();
    box(row).focus();
  }

  /**
   * @description Wire the Years by skill form once. Work history reads it (load) each time it reads the main résumé.
   * @returns {void}
   */
  function init() {
    var form = $('yearsForm');
    if (!form) return;
    form.addEventListener('submit', save);
    form.addEventListener('input', mark);
    $('yrAdd').addEventListener('click', add);
    $('yrUndo').addEventListener('click', undo);
    [$('yrAddSkill'), $('yrAddYears')].forEach(function (input) {
      input.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); add(); } });
    });
  }

  win.CareerYearsBySkill = { init: init, load: load, values: values, state: state };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
}(window));
