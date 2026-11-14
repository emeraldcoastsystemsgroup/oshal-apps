/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: "we are missing the page to put in my expierence and when it is avialbe the concierge should be able to make the changes and reflct them on the screen in my resume"). The Work history page: the jobs the main résumé is built from, each a card with its title, employer, months and bullets, in the order the résumé shows them. Edit opens the card as a form (job title, employer, start and end month and year, I work here now, bullets you add, edit, move and remove); Add a job puts a new one first; a job moves up or down or is removed. The layout follows where LinkedIn's Experience section and the résumé builders (Indeed, Resume.io, Zety) agree: newest job first, one card per job, a month and year for each date with a "currently work here" box, bullets as their own lines. Each save is turned into the exact edits the engine's revision-checked main-résumé edit takes (POST /resume/master-edit; at most 20 a request, chained on each answer's revision) and shows the changed-with-Undo bar; the concierge's approved changes arrive through the registered document refresh and show the same bar. A change also brings the Word document on My résumé up to date when it still matched (CareerResumeOffice.syncDocument).
 */
(function (root) {
  'use strict';
  var API = '/api/career-hunter';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MAX_EDITS = 20, MAX_BYTES = 11 * 1024;

  /** @description A stored month (YYYY-MM or YYYY) as its year and month; anything else stays whole in the year. @param {string} value @returns {{year:string,month:string}} */
  function parseMonth(value) {
    var text = String(value == null ? '' : value).trim(), match = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(text);
    return match ? { year: match[1], month: match[2] || '' } : { year: text, month: '' };
  }
  /** @description The stored form of a year and an optional month. @param {string} year @param {string} month two digits or '' @returns {string} */
  function composeMonth(year, month) {
    var y = String(year || '').trim();
    return /^\d{4}$/.test(y) && month ? y + '-' + month : y;
  }
  /** @description A month as a person reads it: "Mar 2019", "2019", or the stored words. @param {string} value @returns {string} */
  function monthLabel(value) {
    var part = parseMonth(value);
    if (!/^\d{4}$/.test(part.year)) return part.year;
    return part.month ? MONTHS[Number(part.month) - 1].slice(0, 3) + ' ' + part.year : part.year;
  }
  /** @description "Mar 2019 – Present". @param {string} start @param {string} end '' is present @returns {string} */
  function spanLabel(start, end) { return (monthLabel(start) || 'Start not set') + ' – ' + (end ? monthLabel(end) : 'Present'); }

  function anchor(roleIndex, roleTitle, edit) { return Object.assign(edit, { roleIndex: roleIndex, roleTitle: roleTitle }); }

  /**
   * @description The edits that turn a job's saved bullets into the rows on its form: removals (last first), moves of
   * the kept ones into their new order, changed texts, then new ones at their places. Each edit names the exact text
   * the engine will find there at that moment, so the request is all or nothing against one revision.
   * @param {number} roleIndex @param {string} title the job's saved title @param {string[]} saved its saved bullets
   * @param {Array<{orig:number|null,text:string}>} rows the form's bullets, `orig` the saved position or null when new
   * @returns {object[]} edits for POST /resume/master-edit
   */
  function bulletEdits(roleIndex, title, saved, rows) {
    var edits = [], kept = rows.filter(function (row) { return row.text.trim(); });
    var keep = new Set(kept.filter(function (row) { return row.orig != null; }).map(function (row) { return row.orig; }));
    var cur = saved.map(function (text, orig) { return { orig: orig, text: text }; });
    for (var k = saved.length - 1; k >= 0; k--) {
      if (!keep.has(k)) { edits.push(anchor(roleIndex, title, { op: 'remove', field: 'experience', index: k, before: saved[k] })); cur.splice(k, 1); }
    }
    var order = kept.filter(function (row) { return row.orig != null; });
    order.forEach(function (row, p) {
      var j = cur.findIndex(function (item) { return item.orig === row.orig; });
      if (j !== p) { edits.push(anchor(roleIndex, title, { op: 'move', field: 'experience', index: j, to: p, before: cur[j].text })); cur.splice(p, 0, cur.splice(j, 1)[0]); }
    });
    order.forEach(function (row, p) {
      var value = row.text.trim();
      if (value !== cur[p].text) { edits.push(anchor(roleIndex, title, { op: 'set', field: 'experience', index: p, before: cur[p].text, value: value })); cur[p].text = value; }
    });
    kept.forEach(function (row, q) {
      if (row.orig != null) return;
      var value = row.text.trim();
      edits.push(anchor(roleIndex, title, { op: 'add', field: 'experience', index: q, before: q < cur.length ? cur[q].text : '', value: value }));
      cur.splice(q, 0, { orig: null, text: value });
    });
    return edits;
  }

  /**
   * @description The edits a saved job's form asks for: its bullets, then its employer and months, then its title last,
   * so every edit before names the job by the title it still has.
   * @param {number} index the job's position @param {{title:string,org:string,start:string,end:string,bullets:string[]}} role as saved
   * @param {{title:string,org:string,start:string,end:string,bullets:Array}} form as edited @returns {object[]} edits
   */
  function roleEdits(index, role, form) {
    var title = role.title, edits = bulletEdits(index, title, role.bullets || [], form.bullets);
    ['org', 'start', 'end'].forEach(function (key) {
      var before = String(role[key] == null ? '' : role[key]), value = String(form[key] || '').trim();
      if (value !== before.trim()) edits.push(anchor(index, title, { op: 'set', field: 'role', key: key, before: before, value: value }));
    });
    var next = String(form.title || '').trim();
    if (next !== title.trim()) edits.push(anchor(index, title, { op: 'set', field: 'role', key: 'title', before: title, value: next }));
    return edits;
  }

  /** @description The edits that add a new job first, with its employer, months and bullets. @param {object} form @returns {object[]} */
  function newRoleEdits(form) {
    var title = String(form.title || '').trim(), edits = [{ op: 'add', field: 'role', index: 0, before: '', value: title }];
    ['org', 'start', 'end'].forEach(function (key) {
      var value = String(form[key] || '').trim();
      if (value) edits.push(anchor(0, title, { op: 'set', field: 'role', key: key, before: '', value: value }));
    });
    form.bullets.filter(function (row) { return row.text.trim(); }).forEach(function (row, q) {
      edits.push(anchor(0, title, { op: 'add', field: 'experience', index: q, before: '', value: row.text.trim() }));
    });
    return edits;
  }

  /** @description Split edits into requests the route accepts (20 edits, under 12 KiB), in order. @param {object[]} edits @returns {object[][]} */
  function chunks(edits) {
    var out = [], part = [], size = function (list) { return new TextEncoder().encode(JSON.stringify(list)).length; };
    edits.forEach(function (edit) {
      if (part.length && (part.length >= MAX_EDITS || size(part.concat([edit])) > MAX_BYTES)) { out.push(part); part = []; }
      part.push(edit);
    });
    if (part.length) out.push(part);
    return out;
  }

  var api = { MONTHS: MONTHS, parseMonth: parseMonth, composeMonth: composeMonth, monthLabel: monthLabel, spanLabel: spanLabel,
    bulletEdits: bulletEdits, roleEdits: roleEdits, newRoleEdits: newRoleEdits, chunks: chunks, API: API };
  root.CareerWorkHistory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
