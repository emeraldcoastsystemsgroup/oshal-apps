/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained per-employer pull outcomes from a published corpus without migrating or writing an older snapshot.
 */
'use strict';

/** Read-only projection for the existing administrator Companies list. */
function sourceHealthByCompany(db) {
  const exists = db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='source_pull_state'").get();
  if (!exists) return { available: false, reason: 'not_recorded_yet', states: new Map() };
  const rows = db.prepare(`SELECT company_id,last_attempt_at,last_success_at,completed_at,status,
    last_error_code,consecutive_failures,fetched,new_count,changed_count,unchanged_count,closed_count
    FROM corpus.source_pull_state`).all();
  return { available: true, reason: null, states: new Map(rows.map(row => [row.company_id, row])) };
}

module.exports = { sourceHealthByCompany };
