/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.7.0 (Lane FINH1b, 2026-11-14): what the record pages share (Accounts, Transactions, Bills, Spending, Goals). One reader of Finance's routes that turns a refusal into its own sentence; an amount shown with where it came from and the date it is true for ("$4,820.44 · Harbor Bank statement, to 31 Oct"), "Not known yet" for an amount Finance does not know (never zero), and a Sample data pill on sample figures; a small element builder; the person's own day. The pages hold no data: each reads the signed-in person's own records in the browser.
 */
(function (root) {
  'use strict';

  /**
   * @description Call one of Finance's routes and answer its JSON, or throw an Error whose message is Finance's own sentence.
   * @param {string} path The path under /api/finance.
   * @param {object} [body] A JSON body; given, the call is a POST.
   * @returns {Promise<object>} The answer.
   */
  function api(path, body) {
    var opt = { credentials: 'include', headers: { accept: 'application/json' } };
    if (body !== undefined) { opt.method = 'POST'; opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch('/api/finance' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || 'Finance could not do that just now. Try again.'); e.status = r.status; e.body = j; throw e; }
        return j;
      });
    });
  }

  /**
   * @description Build an element.
   * @param {string} tag The tag name.
   * @param {object} [attrs] Attributes; `on` maps event names to handlers, `text` sets the text.
   * @param {Array} [children] Children; strings become text, null is skipped.
   * @returns {HTMLElement} The element.
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'on') Object.keys(value).forEach(function (ev) { node.addEventListener(ev, value[ev]); });
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child)); });
    return node;
  }

  /** @returns {string} The person's own day, YYYY-MM-DD. */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * @param {string} date YYYY-MM-DD.
   * @returns {string} "31 Oct" (with the year when it is not this year).
   */
  function dateWords(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '';
    var d = new Date(date + 'T12:00:00');
    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  /**
   * @param {string} month YYYY-MM.
   * @returns {string} "November 2026".
   */
  function monthWords(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return '';
    return new Date(month + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  /**
   * @param {object|null} f A figure ({ cents, currency }).
   * @returns {string} The amount in words of money, or "Not known yet".
   */
  function money(f) {
    if (!f || typeof f.cents !== 'number') return 'Not known yet';
    var currency = /^[A-Z]{3}$/.test(f.currency || '') ? f.currency : 'USD';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(f.cents / 100);
  }

  /**
   * @param {object|null} f A figure.
   * @returns {string} Where it came from and its date: "Harbor Bank statement, to 31 Oct".
   */
  function sourceWords(f) {
    if (!f || !f.source) return '';
    var when = dateWords(f.asOf);
    return f.source + (when ? ', to ' + when : '');
  }

  /**
   * @description An amount as a page shows it: the amount, then its source and date in small type; a sample figure
   * wears the Sample data pill; an estimate or a planned amount says so.
   * @param {object|null} f A figure.
   * @param {string} [cls] An extra class for the amount.
   * @returns {HTMLElement} The element.
   */
  function figure(f, cls) {
    var kind = f && f.posture === 'estimate' ? 'Estimate' : f && f.posture === 'planned' ? 'Planned' : '';
    return el('span', { class: 'fr-figure' }, [
      el('span', { class: 'fr-amount' + (cls ? ' ' + cls : ''), text: money(f) }),
      f && f.posture === 'sample' ? el('span', { class: 'fr-pill', text: 'Sample data' }) : null,
      kind ? el('span', { class: 'fr-pill', text: kind }) : null,
      f ? el('small', { class: 'fr-source', text: sourceWords(f) }) : null,
    ]);
  }

  /**
   * @param {string} value A typed amount ("1,234.50" or "-20").
   * @returns {number|null} Whole cents, or null when nothing readable was typed.
   */
  function centsOf(value) {
    var text = String(value || '').replace(/[,$\s]/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
    return Math.round(Number(text) * 100);
  }

  /**
   * @description Show a sentence in the page's notice line (a refusal reads as Finance's own words).
   * @param {string} text The sentence.
   * @param {boolean} [bad] Whether it is a refusal.
   * @returns {void}
   */
  function say(text, bad) {
    var box = document.getElementById('frNotice');
    if (!box) return;
    box.textContent = text || '';
    box.className = 'fr-notice' + (bad ? ' fr-bad' : '');
    box.hidden = !text;
  }

  /**
   * @description Run a press: the button waits while the call runs, and a refusal is said in words.
   * @param {HTMLButtonElement} button The button pressed.
   * @param {Function} run Answers a promise.
   * @returns {Promise<void>} Settles when the press is done.
   */
  function press(button, run) {
    if (button) button.disabled = true;
    say('');
    return Promise.resolve().then(run).catch(function (err) { say(err && err.message ? err.message : String(err), true); })
      .then(function () { if (button) button.disabled = false; });
  }

  /**
   * @description Open another Finance page inside Finance's own bar when it frames this page, else in place.
   * @param {string} name The section's name (finance-accounts, finance-bills, ...).
   * @returns {void}
   */
  function go(name) {
    try { if (window.parent !== window && window.parent.location.pathname.indexOf('/api/finance/app') === 0) { window.parent.location.hash = '#/' + name; return; } } catch (_) { /* another origin frames this page */ }
    window.location.href = '/api/finance/p/' + name.replace(/^finance-/, '');
  }

  root.FinanceRecords = { api: api, el: el, today: today, dateWords: dateWords, monthWords: monthWords, money: money, sourceWords: sourceWords, figure: figure, centsOf: centsOf, say: say, press: press, go: go };
})(typeof window !== 'undefined' ? window : globalThis);
