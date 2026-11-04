/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained per-employer pull outcomes from a published corpus without migrating or writing an older snapshot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read the latest nightly source review for the same administrator list.
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

/** The latest source review report; null before the first one, a marked result if it cannot be read. */
function latestSourceReview(db) {
  try {
    const exists = db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='source_review_runs'").get();
    if (!exists) return null;
    const row = db.prepare('SELECT report FROM corpus.source_review_runs ORDER BY finished_at DESC, run_id DESC LIMIT 1').get();
    return row ? JSON.parse(row.report) : null;
  } catch {
    return { unreadable: true }; // The page says so: a bad report must not hide the company list.
  }
}

module.exports = { sourceHealthByCompany, latestSourceReview };
