/* trading/ui/quote-stream.js — same-origin, display-only quote relay (ADR-143).
 *
 * Classic script loaded after app.js and before the view/ticket modules. The browser opens one
 * EventSource for the selected book and the ticket-first union of its visible symbols. It receives
 * only the kernel's allowlisted print payload; venue URLs and credentials do not belong here.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-143 Phase 2: same-origin EventSource and in-place ticket/positions print updates with poll fallback.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | ADR-143 D3/D9 client half. hello's feed and staleAfterSec are kept; a one-second sweep greys every [data-stream-symbol] cell whose last print is older than staleAfterSec and rewrites the ticket as-of to "stale · last <FEED> print <time>"; the feed pill is built here from hello's feed name and shown only while a print is fresh; qsIsStreaming is freshness-gated so the ticket's 5 s poll resumes on a silent stream (off-session IEX carries nothing and the price must never freeze unlabelled); the request list is kept apart from hello's accepted list so a dropped tail no longer reopens the source on every sync; the .stream-stale rule is injected once (style-src keeps 'unsafe-inline'; the shell markup is untouched).
 */

let QS = qsFresh();

function qsFresh() { return { source: null, requested: [], symbols: [], streaming: false, feed: '', staleAfterSec: 60, helloAt: 0, lastBySymbol: {}, stale: {}, sweep: null }; }
function qsUp(sym) { return String(sym || '').trim().toUpperCase(); }
function qsEsc(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s); }
function qsSymbols() {
  const out = [];
  if (typeof TKT !== 'undefined' && TKT && TKT.symbol) out.push(TKT.symbol);
  if (typeof STATE !== 'undefined' && STATE && Array.isArray(STATE.positions)) STATE.positions.forEach((p) => out.push(p.symbol));
  return [...new Set(out.map(qsUp).filter(Boolean))];
}
/* The greying rule lives here because the shell markup is not this module's to edit; style-src keeps 'unsafe-inline'. */
function qsEnsureStyle() {
  if (typeof document === 'undefined' || document.getElementById('qsStreamStyle')) return;
  const style = document.createElement('style'); style.id = 'qsStreamStyle';
  style.textContent = '.stream-stale{opacity:.55}';
  (document.head || document.documentElement).appendChild(style);
}
function qsClose() {
  if (QS.source) QS.source.close();
  if (QS.sweep) clearInterval(QS.sweep);
  QS = qsFresh();
}
function qsSync() {
  if (typeof EventSource === 'undefined') return;
  const symbols = qsSymbols();
  if (!symbols.length) { qsClose(); return; }
  if (QS.source && QS.requested.join(',') === symbols.join(',') && QS.source.readyState !== EventSource.CLOSED) return;
  qsClose(); QS.requested = symbols; QS.symbols = symbols; qsEnsureStyle();
  const source = QS.source = new EventSource('/api/trading/stream?book=' + encodeURIComponent(BOOK) + '&symbols=' + encodeURIComponent(symbols.join(',')));
  source.addEventListener('hello', (event) => { try { qsApplyHello(JSON.parse(event.data || '{}'), symbols); } catch { /* a malformed hello leaves the poll in charge */ } });
  source.addEventListener('print', (event) => { try { qsApplyPrint(JSON.parse(event.data || '{}')); } catch { /* a malformed venue frame is ignored */ } });
  source.addEventListener('status', (event) => { try { const next = JSON.parse(event.data || '{}'); if (next.state === 'entitlement_blocked') QS.streaming = false; } catch { /* status is advisory */ } });
  source.onerror = () => { QS.streaming = false; };
}
function qsApplyHello(hello, requested) {
  QS.streaming = hello.streaming === true;
  QS.symbols = Array.isArray(hello.symbols) ? hello.symbols.map(qsUp) : requested;
  QS.feed = String(hello.feed || '');
  QS.staleAfterSec = Number(hello.staleAfterSec) > 0 ? Number(hello.staleAfterSec) : 60;
  QS.helloAt = Date.now();
  if (QS.sweep) clearInterval(QS.sweep);
  QS.sweep = QS.streaming ? setInterval(qsStaleSweep, 1000) : null;
}
function qsApplyPrint(print) {
  const sym = qsUp(print.symbol); if (!sym || !(Number(print.price) > 0)) return;
  QS.lastBySymbol[sym] = { asOf: String(print.asOf || ''), at: Date.now() };
  QS.stale[sym] = false;
  if (typeof TKT !== 'undefined' && TKT && TKT.symbol === sym) {
    TKT.quote = { symbol: sym, price: Number(print.price), asOf: print.asOf, size: Number(print.size || 0), live: true };
    TKT.quoteAt = Date.now(); TKT.quoteErr = '';
    if (typeof tktApplyQuote === 'function') tktApplyQuote();
  }
  if (typeof STATE !== 'undefined' && STATE && Array.isArray(STATE.positions)) {
    const position = STATE.positions.find((p) => qsUp(p.symbol) === sym);
    if (position) {
      position.price = Number(print.price);
      position.marketValue = position.price * Number(position.qty || 0);
      position.unrealizedPl = (position.price - Number(position.avgEntryPrice || 0)) * Number(position.qty || 0);
      position.retPct = Number(position.avgEntryPrice) > 0 ? (position.price / Number(position.avgEntryPrice) - 1) * 100 : 0;
      const u = typeof UNIVERSE !== 'undefined' ? (UNIVERSE[sym] || (UNIVERSE[sym] = { symbol: sym })) : null;
      if (u) { u.price = position.price; u.mktValue = position.marketValue; u.uPl = position.unrealizedPl; u.retPct = position.retPct; }
      if (typeof renderPortfolioTable === 'function') renderPortfolioTable();
    }
  }
  qsStaleTick(sym, false);
}
/* Age of the newest thing the stream told us about a symbol: its last print, else the hello itself. */
function qsAgeMs(sym) {
  const last = QS.lastBySymbol[qsUp(sym)];
  if (last) return Date.now() - last.at;
  return QS.helloAt ? Date.now() - QS.helloAt : Infinity;
}
function qsIsFresh(sym) { return QS.streaming && qsAgeMs(sym) <= QS.staleAfterSec * 1000; }
/* Streaming means "a print for this symbol is current": on a silent stream the poll takes over. */
function qsIsStreaming(sym) { const s = qsUp(sym); return QS.streaming && QS.symbols.includes(s) && qsIsFresh(s); }
function qsFeedLabel() { return (QS.feed || 'iex').toUpperCase(); }
/* The feed pill: only while the ticket's quote came from a print that is still fresh. */
function qsPillHtml(sym) {
  const s = qsUp(sym);
  if (!QS.lastBySymbol[s] || !qsIsStreaming(s)) return '';
  return ' <span class="pill" style="color:var(--buy);border-color:var(--buy)" data-stream-pill="' + qsEsc(s) + '">live · ' + qsEsc(qsFeedLabel()) + '</span>';
}
/* The ticket's as-of line while the stream is the source; '' hands the wording back to the ticket's own poll. */
function qsAsOfText(sym) {
  const s = qsUp(sym), last = QS.lastBySymbol[s];
  if (!last || !QS.streaming) return '';
  const when = typeof fmtDate === 'function' ? fmtDate(last.asOf) : last.asOf;
  if (qsIsFresh(s)) return 'as of ' + when;
  const q = (typeof TKT !== 'undefined' && TKT && TKT.quote && qsUp(TKT.quote.symbol) === s) ? TKT.quote : null;
  if (q && !q.live && q.asOf && Date.parse(q.asOf) > Date.parse(last.asOf)) return '';
  return 'stale · last ' + qsFeedLabel() + ' print ' + when;
}
function qsStaleSweep() {
  if (!QS.streaming) return;
  let ticketFlipped = false;
  Object.keys(QS.lastBySymbol).forEach((sym) => {
    const stale = !qsIsFresh(sym);
    if (QS.stale[sym] !== stale) { QS.stale[sym] = stale; if (typeof TKT !== 'undefined' && TKT && TKT.symbol === sym) ticketFlipped = true; }
    qsStaleTick(sym, stale);
  });
  if (ticketFlipped && typeof tktApplyQuote === 'function') tktApplyQuote();
}
function qsStaleTick(sym, stale) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-stream-symbol="' + qsUp(sym).replace(/[^A-Z0-9.-]/g, '') + '"]').forEach((el) => el.classList.toggle('stream-stale', stale));
}
