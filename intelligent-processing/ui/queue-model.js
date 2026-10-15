/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The queue screen's model, kept apart from the page so it is tested as it ships: which of the caller's tickets belong to this queue (kind intelligent-processing), which are still open (a ticket is closed only when the kernel calls it done, failed or cancelled), and one row per alert (the same title, compared without case or spacing, is one alert with a count, so a repeating alert never floods the screen). The newest ticket of an alert is the one a row opens.
 */
(function (root) {
  'use strict';
  var QUEUE = 'intelligent-processing';
  var CLOSED = ['done', 'failed', 'cancelled'];

  /** The ticket's kind as either wire field names it. */
  function kind(ticket) { return String((ticket && (ticket.kind || ticket.ticketType)) || ''); }

  /** Milliseconds since the epoch, or 0 when the ticket carries no usable time. */
  function created(ticket) {
    var value = ticket && (ticket.createdAt != null ? ticket.createdAt : ticket.created_at);
    var number = typeof value === 'number' ? value : Date.parse(value);
    return isFinite(number) ? number : 0;
  }

  /** Whether the kernel still has work for this ticket. */
  function isOpen(ticket) { return CLOSED.indexOf(String(ticket && ticket.status)) < 0; }

  /** The alert a ticket reports: its title without case or repeated spacing. */
  function fingerprint(ticket) {
    return String((ticket && ticket.title) || '(untitled alert)').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * One row per alert from the caller's tickets.
   * @param {Array<object>} tickets - Every ticket the caller can read (GET /api/tickets).
   * @param {'open'|'attention'|'all'} filter - Open work, work waiting on a person, or everything.
   * @returns {Array<{title:string,count:number,status:string,latest:number,ticketId:string,open:number}>}
   */
  function rows(tickets, filter) {
    var groups = {};
    (tickets || []).filter(function (t) { return kind(t) === QUEUE; }).forEach(function (t) {
      if (filter === 'open' && !isOpen(t)) return;
      if (filter === 'attention' && ['awaiting_approval', 'blocked', 'failed'].indexOf(String(t.status)) < 0) return;
      var key = fingerprint(t);
      var group = groups[key] || (groups[key] = { title: String(t.title || '(untitled alert)'), count: 0, open: 0, latest: -1 });
      group.count += 1;
      if (isOpen(t)) group.open += 1;
      if (created(t) > group.latest) {
        group.latest = created(t); group.status = String(t.status || 'unknown'); group.ticketId = String(t.id || t.ticketId || '');
      }
    });
    return Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) { return b.latest - a.latest; });
  }

  /**
   * The body that files one alert on this queue (POST /api/v1/tickets).
   * @param {string} title - What fired.
   * @param {string} text - The alert text, the investigation's input.
   * @param {boolean} start - Start the investigation now instead of holding it.
   * @returns {object|null} The body, or null when there is no title.
   */
  function filing(title, text, start) {
    var name = String(title || '').trim();
    if (!name) return null;
    var body = { kind: QUEUE, title: name.slice(0, 200), start: !!start };
    var detail = String(text || '').trim();
    if (detail) body.description = detail.slice(0, 8000);
    return body;
  }

  root.IntelligentProcessingQueue = { QUEUE: QUEUE, isOpen: isOpen, fingerprint: fingerprint, rows: rows, filing: filing };
})(typeof window !== 'undefined' ? window : globalThis);
