/* trading/ui/symbol-search.js — a reusable ticker/name autocomplete for the Trading surface.
 *
 * Classic script; loads AFTER app.js (uses its api() and esc()) and BEFORE the view modules, so
 * ticket.js and view-research.js can attach it to their symbol inputs. Two globals:
 *   attachSymbolSearch(inputEl, onPick) — wraps the input, wires a debounced GET /symbols/search
 *     dropdown, and calls onPick({ symbol, name, exchange, kind }) when a row is chosen (a click, or
 *     Enter on a highlighted row).
 *   detachSymbolSearch(inputEl) — removes the listeners/timers and unwraps the input. Call it before
 *     re-attaching, or before the host that owns the input is re-rendered, so no timer or dropdown leaks.
 * All per-input state lives in the SS_STATE WeakMap keyed by the input element — never a shared module
 * global — so two inputs (the ticket and the research box) never step on each other. A failed fetch is
 * swallowed (no dropdown), a stale response (a superseded query, a value that moved on, or an input no
 * longer in the document) is ignored, and nothing here throws into the page.
 */

var SS_STATE = new WeakMap();
var SS_DEBOUNCE = 180;

/* Public: attach the autocomplete to inputEl. Re-attaching is safe — it detaches first. */
function attachSymbolSearch(inputEl, onPick) {
  if (!inputEl || typeof onPick !== 'function') return;
  detachSymbolSearch(inputEl);
  var wrap = ssWrap(inputEl);
  var drop = document.createElement('div'); drop.className = 'ss-drop'; drop.hidden = true; wrap.appendChild(drop);
  var st = { onPick: onPick, wrap: wrap, drop: drop, timer: null, closeTimer: null, seq: 0, items: [], active: -1, h: {} };
  st.h.input = function () { ssOnInput(inputEl); };
  st.h.keydown = function (e) { ssOnKeydown(inputEl, e); };
  st.h.blur = function () { ssOnBlur(inputEl); };
  st.h.focus = function () { ssOnFocus(inputEl); };
  st.h.mousedown = function (e) { ssOnDropMousedown(inputEl, e); };
  SS_STATE.set(inputEl, st);
  inputEl.addEventListener('input', st.h.input);
  inputEl.addEventListener('blur', st.h.blur);
  inputEl.addEventListener('focus', st.h.focus);
  wrap.addEventListener('keydown', st.h.keydown, true);
  drop.addEventListener('mousedown', st.h.mousedown);
}

/* Public: tear down — clear timers, drop the listeners, unwrap. Safe on an already-detached input. */
function detachSymbolSearch(inputEl) {
  var st = inputEl && SS_STATE.get(inputEl); if (!st) return;
  clearTimeout(st.timer); clearTimeout(st.closeTimer);
  inputEl.removeEventListener('input', st.h.input);
  inputEl.removeEventListener('blur', st.h.blur);
  inputEl.removeEventListener('focus', st.h.focus);
  if (st.wrap) st.wrap.removeEventListener('keydown', st.h.keydown, true);
  if (st.drop) { st.drop.removeEventListener('mousedown', st.h.mousedown); if (st.drop.parentNode) st.drop.parentNode.removeChild(st.drop); }
  ssUnwrap(inputEl, st.wrap);
  SS_STATE.delete(inputEl);
}

/* Wrap the input in a .ss-wrap so the absolute dropdown anchors to it; carry the input's flex/width
   sizing onto the wrapper so the surrounding layout (a flex row, a max-width box) is unchanged. */
function ssWrap(inputEl) {
  var wrap = document.createElement('div'); wrap.className = 'ss-wrap';
  var s = inputEl.style;
  ['flex', 'minWidth', 'maxWidth', 'width'].forEach(function (k) { if (s[k]) { wrap.style[k] = s[k]; s[k] = ''; } });
  if (inputEl.parentNode) inputEl.parentNode.insertBefore(wrap, inputEl);
  wrap.appendChild(inputEl);
  return wrap;
}

/* Undo ssWrap: move the sizing back onto the input, put the input back where the wrapper was. */
function ssUnwrap(inputEl, wrap) {
  if (!wrap) return;
  ['flex', 'minWidth', 'maxWidth', 'width'].forEach(function (k) { if (wrap.style[k]) inputEl.style[k] = wrap.style[k]; });
  if (wrap.parentNode) { wrap.parentNode.insertBefore(inputEl, wrap); wrap.parentNode.removeChild(wrap); }
}

/* Debounced input handler: schedule a query, or close at once when the box is empty. */
function ssOnInput(inputEl) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  clearTimeout(st.timer); clearTimeout(st.closeTimer);
  if (String(inputEl.value || '').trim().length < 1) { ssClose(inputEl); return; }
  st.timer = setTimeout(function () { ssQuery(inputEl); }, SS_DEBOUNCE);
}

/* One search: GET /symbols/search, guarded against races — a superseded request, a value that moved on,
   or an input no longer in the document is dropped. A failed fetch simply shows no dropdown. */
async function ssQuery(inputEl) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  if (!inputEl.isConnected) return;
  var q = String(inputEl.value || '').trim();
  if (q.length < 1) { ssClose(inputEl); return; }
  var seq = ++st.seq, results = null;
  try { var j = await api('/symbols/search?q=' + encodeURIComponent(q) + '&limit=12'); results = (j && j.results) || []; }
  catch (e) { return; }
  if (SS_STATE.get(inputEl) !== st || st.seq !== seq) return;
  if (!inputEl.isConnected || String(inputEl.value || '').trim() !== q) return;
  ssRender(inputEl, results);
}

/* Paint the rows and open the dropdown; no rows means nothing to show. */
function ssRender(inputEl, results) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  st.items = results || []; st.active = -1;
  if (!st.items.length) { ssClose(inputEl); return; }
  st.drop.innerHTML = st.items.map(function (h, i) { return ssRowHtml(h, i, st.active); }).join('');
  st.drop.hidden = false;
}

/* One result row: SYMBOL · Name · exchange, with an ETF tag when the hit is an ETF. */
function ssRowHtml(hit, i, active) {
  return '<div class="ss-item' + (i === active ? ' on' : '') + '" data-i="' + i + '">' +
    '<b>' + esc(hit.symbol) + '</b>' +
    '<span class="nm">' + esc(hit.name || '') + '</span>' +
    (hit.kind === 'etf' ? '<span class="ss-etf">ETF</span>' : '') +
    '<span class="ex">' + esc(hit.exchange || '') + '</span></div>';
}

/* Arrow keys move the highlight, Enter picks it, Esc closes — handled in the capture phase on the
   wrapper so this wins over the input's own Enter handler ONLY when a row is highlighted. Every other
   key (including Enter with nothing highlighted) falls through to the input's own handlers untouched. */
function ssOnKeydown(inputEl, e) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  var open = st.drop && !st.drop.hidden && st.items.length;
  if (e.key === 'ArrowDown') { if (open) { e.preventDefault(); e.stopPropagation(); ssMove(inputEl, 1); } return; }
  if (e.key === 'ArrowUp') { if (open) { e.preventDefault(); e.stopPropagation(); ssMove(inputEl, -1); } return; }
  if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); ssClose(inputEl); } return; }
  if (e.key === 'Enter' && open && st.active >= 0) { e.preventDefault(); e.stopPropagation(); ssPick(inputEl, st.active); }
}

/* Move the highlighted row, wrapping at the ends, and keep it in view. */
function ssMove(inputEl, delta) {
  var st = SS_STATE.get(inputEl); if (!st || !st.items.length || st.drop.hidden) return;
  var n = st.items.length, rows = st.drop.children;
  st.active = (st.active + delta + n) % n;
  for (var i = 0; i < rows.length; i++) rows[i].className = 'ss-item' + (i === st.active ? ' on' : '');
  var el = rows[st.active]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

/* Keep focus on mousedown (so the click lands before blur closes the list) and pick that row. */
function ssOnDropMousedown(inputEl, e) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  var row = e.target && e.target.closest ? e.target.closest('.ss-item') : null;
  if (!row) return;
  e.preventDefault();
  var i = Number(row.getAttribute('data-i'));
  if (i >= 0) ssPick(inputEl, i);
}

/* Hand the chosen hit to the caller and close. */
function ssPick(inputEl, i) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  var hit = st.items[i]; if (!hit) return;
  ssClose(inputEl);
  st.onPick(hit);
}

/* Close on blur, but a short delay lets a dropdown click register first. */
function ssOnBlur(inputEl) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  clearTimeout(st.closeTimer);
  st.closeTimer = setTimeout(function () { ssClose(inputEl); }, 150);
}

/* Re-open the last results when focus returns and the box still has text. */
function ssOnFocus(inputEl) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  clearTimeout(st.closeTimer);
  if (st.items.length && String(inputEl.value || '').trim().length >= 1) st.drop.hidden = false;
}

/* Hide the dropdown and drop the highlight. */
function ssClose(inputEl) {
  var st = SS_STATE.get(inputEl); if (!st) return;
  st.active = -1;
  if (st.drop) st.drop.hidden = true;
}
