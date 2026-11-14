/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (seen on blue at 412x915): the bar goes after 12 seconds, held while a finger, the pointer or the keyboard focus is on it, as a snackbar does; kept up it covered the Word editor's own Format and Insert bar on a phone.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: the one "changed, Undo" bar My résumé and Work history show after a change lands (one the person saved, or one they approved in the concierge), and the Undo request behind it. It follows the snackbar Google Docs, Gmail and LinkedIn show after an edit: one line saying what changed and an Undo button, above the phone's bottom bar, until the next change or Close. Undo is POST /api/career-hunter/resume/master-undo with the revision the change left and the one before it; the server puts the earlier version back only while nothing changed after it, and the bar says so in words when it cannot.
 */
(function (root) {
  'use strict';
  var UNDO = '/api/career-hunter/resume/master-undo';
  var DIGEST = /^[a-f0-9]{64}$/;

  /**
   * @description Ask the server to put back the version before a change.
   * @param {string} before The revision before the change. @param {string} after The revision the change left.
   * @returns {Promise<object>} The server's answer ({ok, revision}); throws an Error whose message is said to the person.
   */
  async function undoRequest(before, after) {
    if (!DIGEST.test(String(before)) || !DIGEST.test(String(after))) throw new Error('This change cannot be undone here.');
    var response = await root.fetch(UNDO, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: after, restore: before }) });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || body.ok !== true) throw new Error(body.error || 'Undo did not go through. Nothing was changed.');
    return body;
  }

  var STAY_MS = 12000;
  /** Hide after STAY_MS unless a pointer or the focus is on the bar; a new message starts the time again. */
  function schedule(node) {
    clearTimeout(node.careerTimer);
    if (node.matches(':hover') || node.contains(node.ownerDocument.activeElement)) return;
    node.careerTimer = setTimeout(function () { node.hidden = true; }, STAY_MS);
  }
  function bar(doc) {
    var node = doc.getElementById('careerChangeBar');
    if (node) return node;
    node = doc.createElement('div'); node.id = 'careerChangeBar'; node.className = 'cf-change-bar'; node.hidden = true;
    node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    node.innerHTML = '<span class="cf-change-text"></span><button type="button" class="cf-change-undo">Undo</button>' +
      '<button type="button" class="cf-change-close" aria-label="Close">×</button>';
    doc.body.appendChild(node);
    node.querySelector('.cf-change-close').addEventListener('click', function () { node.hidden = true; });
    ['pointerenter', 'focusin'].forEach(function (name) { node.addEventListener(name, function () { clearTimeout(node.careerTimer); }); });
    ['pointerleave', 'focusout'].forEach(function (name) { node.addEventListener(name, function () { if (!node.hidden) schedule(node); }); });
    return node;
  }

  /**
   * @description Show what changed with an Undo that runs `undo` once; a later change replaces it.
   * @param {{doc?:Document,text:string,undo?:Function}} options The line to show and the page's own Undo (none hides the button).
   * @returns {HTMLElement} The bar.
   */
  function show(options) {
    var doc = options.doc || root.document, node = bar(doc), button = node.querySelector('.cf-change-undo');
    node.querySelector('.cf-change-text').textContent = options.text;
    button.hidden = typeof options.undo !== 'function'; button.disabled = false;
    button.onclick = async function () {
      button.disabled = true;
      try { await options.undo(); }
      catch (error) { node.querySelector('.cf-change-text').textContent = error.message || 'Undo did not go through.'; button.hidden = true; }
    };
    node.hidden = false; schedule(node);
    return node;
  }

  /** @description Hide the bar. @param {Document} [doc] The page. @returns {void} */
  function hide(doc) { var node = (doc || root.document).getElementById('careerChangeBar'); if (node) node.hidden = true; }

  var api = { show: show, hide: hide, undoRequest: undoRequest };
  root.CareerChangeBar = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
