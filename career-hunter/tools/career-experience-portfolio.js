/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "i had oshal and agentic federal but now we have oswarm.ai and the product changed ... the bullets for oshal now should be oswarm and updated"): the saved portfolio's Edit form on Other experience. Opening the saved-portfolio entry (the one the list makes from the main résumé) shows its fields, organization, role, dates, the three links, bullets, technology, applications and skills one per line, the summary job scoring reads, a short label and a private note, read whole with the main résumé's revision (GET /resume/master-section?field=portfolio). Save portfolio sends the whole form as one main-résumé edit (POST /resume/master-edit, field portfolio): checked by the engine first, all or nothing, backed up and audited; a main résumé that moved since the form was read is refused and the form is read again. Undo puts back the version before the save (POST /resume/master-undo). The list is read again after each change, so its title follows the saved organization.
 */
(function () {
  'use strict';
  var TEXTS = { org: 'pfOrg', title: 'pfTitle', span: 'pfSpan', person_url: 'pfPerson', platform_url: 'pfPlatform',
    product_url: 'pfProduct', scoring_blurb: 'pfBlurb', label: 'pfLabel', note: 'pfNote' };
  var LISTS = { bullets: 'pfBullets', tech: 'pfTech', applications: 'pfApplications', skills: 'pfSkills' };
  var API = '/api/career-hunter/resume/';
  var state = { present: false, copy: false, revision: '', portfolio: null, error: '', undo: null };
  var hooks = { reload: function () { return Promise.resolve(); } };

  function $(id) { return document.getElementById(id); }
  function grow(area) { area.style.height = 'auto'; area.style.height = (area.scrollHeight + 2) + 'px'; }
  function notice(text) { $('pfNotice').textContent = text; }
  function writing(on) { $('pfSave').className = on ? 'ck-primary' : 'ck-btn'; }

  /** One JSON request; a refusal throws its own words with its status. */
  async function request(url, options) {
    var response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.ok === false) {
      throw Object.assign(new Error(data.error || 'Career could not answer. Try again.'), { status: response.status });
    }
    return data;
  }

  /**
   * @description Read the saved portfolio whole, with the main résumé's revision.
   * @returns {Promise<object>} The state: present, copy (the list keeps its own copy), revision, portfolio, error.
   */
  async function load() {
    try {
      var data = await request(API + 'master-section?field=portfolio');
      Object.assign(state, { present: !!data.present, copy: !!data.copy, revision: data.revision || '', portfolio: data.portfolio || null, error: '' });
    } catch (error) {
      Object.assign(state, { present: false, copy: false, revision: '', portfolio: null, error: error.message });
    }
    return state;
  }

  /**
   * @description Whether an entry of the list is the saved portfolio this form edits: the saved-portfolio entry the
   * list makes from the main résumé (not a copy the list keeps itself), or one whose read was refused.
   * @param {object|null} entry An entry of GET /experience-bank.
   * @returns {boolean}
   */
  function handles(entry) {
    return !!entry && entry.id === 'saved-portfolio' && !state.copy && (state.present || !!state.error);
  }

  function fill() {
    var portfolio = state.portfolio || {};
    Object.keys(TEXTS).forEach(function (key) { $(TEXTS[key]).value = portfolio[key] || ''; });
    Object.keys(LISTS).forEach(function (key) { var area = $(LISTS[key]); area.value = (portfolio[key] || []).join('\n'); grow(area); });
    grow($('pfBlurb'));
  }

  function values() {
    var value = {};
    Object.keys(TEXTS).forEach(function (key) { value[key] = $(TEXTS[key]).value.trim(); });
    Object.keys(LISTS).forEach(function (key) {
      value[key] = $(LISTS[key]).value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    });
    return value;
  }

  /** @description Show the form for the saved portfolio, filled as saved. @returns {void} */
  function open() {
    $('portfolioForm').hidden = false;
    $('pfSave').disabled = !state.present;
    $('pfUndo').hidden = !state.undo;
    fill();
    writing(false);
    notice(state.error ? 'Your saved portfolio could not be opened here: ' + state.error : '');
  }

  /** @description Hide the form (another entry, or Add experience, was chosen). @returns {void} */
  function close() { $('portfolioForm').hidden = true; }

  async function save(event) {
    event.preventDefault();
    var before = state.revision;
    $('pfSave').disabled = true;
    notice('Saving your portfolio…');
    try {
      var result = await request(API + 'master-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: before, edits: [{ op: 'set', field: 'portfolio', value: values(), summary: 'Saved portfolio edited on Other experience' }] }) });
      state.undo = result.changed ? { revision: result.revision, restore: before } : state.undo;
      await load(); await hooks.reload(); open();
      notice(result.changed ? 'Saved. Job scoring and the next résumé or letter you tick this entry for use this version.' : 'Nothing changed; your portfolio already reads this way.');
    } catch (error) {
      if (error.status === 409) { await load(); open(); }
      notice(error.message);
    } finally {
      $('pfSave').disabled = !state.present;
    }
  }

  async function undo() {
    if (!state.undo) return;
    $('pfUndo').disabled = true;
    try {
      await request(API + 'master-undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.undo) });
      state.undo = null;
      await load(); await hooks.reload(); open();
      notice('Undone. Your portfolio is back as it was before that save.');
    } catch (error) {
      notice(error.message);
    } finally {
      $('pfUndo').disabled = false;
    }
  }

  /**
   * @description Wire the form once. `reload` reads the list again (its title follows the saved organization).
   * @param {{reload: function(): Promise<void>}} given Page hooks.
   * @returns {void}
   */
  function init(given) {
    hooks = Object.assign(hooks, given || {});
    $('portfolioForm').addEventListener('submit', save);
    $('portfolioForm').addEventListener('input', function (event) {
      writing(true);
      if (event.target.tagName === 'TEXTAREA') grow(event.target);
    });
    $('pfUndo').addEventListener('click', undo);
  }

  window.CareerPortfolio = { init: init, load: load, handles: handles, open: open, close: close, state: state };
}());
