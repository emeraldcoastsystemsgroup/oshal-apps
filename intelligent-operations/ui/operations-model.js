/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Present authorized incident tickets individually; never turn workflow completion into verified incident recovery.
 */
(function (root) {
  'use strict';
  const KINDS = ['intelligent-operations', 'intelligent-processing'];
  const LABELS = { draft: 'Draft', queued: 'Queued', running: 'Investigating', awaiting_approval: 'Workflow approval needed',
    blocked: 'Workflow blocked', done: 'Workflow finished', failed: 'Workflow failed', cancelled: 'Cancelled' };
  function time(value) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  function tickets(payload) {
    if (!payload || !Array.isArray(payload.tickets)) throw new Error('The ticket response was incomplete.');
    return payload.tickets.filter(t => t && KINDS.includes(t.kind || t.ticketType)).map(t => {
      if (typeof (t.id || t.ticketId) !== 'string' || !(t.id || t.ticketId)) throw new Error('An incident ticket was missing its ID.');
      const status = Object.hasOwn(LABELS, t.status) ? t.status : 'unknown';
      return { id: t.id || t.ticketId, kind: t.kind || t.ticketType,
        title: typeof t.title === 'string' && t.title.trim() ? t.title : 'Incident ticket',
        status, label: LABELS[status] || 'Unknown workflow state',
        updated: time(t.updated_at ?? t.updatedAt ?? t.created_at ?? t.createdAt) };
    }).sort((a,b) => (b.updated ?? -1) - (a.updated ?? -1));
  }
  function summary(rows) {
    return { total: rows.length, active: rows.filter(t => ['draft','queued','running','awaiting_approval','blocked'].includes(t.status)).length,
      attention: rows.filter(t => ['awaiting_approval','blocked','failed','unknown'].includes(t.status)).length };
  }
  const api = { tickets, summary, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OperationsModel = api;
})(typeof window === 'undefined' ? globalThis : window);
