/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read retained per-employer pull outcomes from a published corpus without migrating or writing an older snapshot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read the latest nightly source review for the same administrator list.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read source maintenance for the same list: the newest report, the decisions waiting for a person with their evidence, and the open repair briefs. Build the daily briefing from it. A corpus maintenance has not reached has none of these, which is not an error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Read the open suggestions the engine now keeps per employer, newest first and at most 50, in place of the newest report's list: a suggestion left the page after one night, and the runbook does not return to an employer for weeks. An employer that has a board or is removed is left out.
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

const MAINTENANCE_LIST = 50;
/** The page that shows all of this, for a briefing line to open. */
const MAINTENANCE_LINK = '/cockpit/?app=career-hunter&screen=career-companies&view=health';
const BRIEFING_HOURS = 24;
/** How long "Keep trying" stops a source being raised again. The engine holds the rule (`SNOOZE_DAYS`); this is for the page's words. */
const KEEP_TRYING_DAYS = 60;

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name=?").get(name);
}

function parsed(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Decisions waiting for a person, oldest first. An employer removed since is never listed. */
function openActions(db) {
  if (!hasTable(db, 'source_actions')) return { actions: [], actionCount: 0 };
  const from = `FROM corpus.source_actions a JOIN corpus.companies c ON c.id = a.company_id
    WHERE a.state = 'open' AND COALESCE(c.discover_status, '') <> 'removed'`;
  const actions = db.prepare(`SELECT a.id, a.company_id AS companyId, c.name AS company, a.opened_at AS openedAt, a.evidence
    ${from} ORDER BY a.opened_at, a.id LIMIT ${MAINTENANCE_LIST}`).all()
    .map((row) => ({ ...row, evidence: parsed(row.evidence, {}) }));
  return { actions, actionCount: db.prepare(`SELECT COUNT(*) AS n ${from}`).get().n };
}

/**
 * @description Whether source maintenance has a decision waiting for a person on one employer.
 * @param {object} db - The corpus, attached as `corpus`.
 * @param {number} companyId - The employer.
 * @returns {boolean} False on a corpus maintenance has not reached.
 */
function decisionWaiting(db, companyId) {
  return hasTable(db, 'source_actions')
    && !!db.prepare("SELECT 1 FROM corpus.source_actions WHERE company_id = ? AND state = 'open'").get(companyId);
}

/**
 * Boards the runbook found and did not connect, newest first, in the shape the page's Accept takes. An employer that has
 * a board by now, or is removed, is left out.
 */
function openSuggestions(db) {
  if (!hasTable(db, 'source_suggestions')) return { suggestions: [], suggestionCount: 0 };
  const from = `FROM corpus.source_suggestions s JOIN corpus.companies c ON c.id = s.company_id
    WHERE COALESCE(c.ats_type, '') = '' AND COALESCE(c.discover_status, '') <> 'removed'`;
  const suggestions = db.prepare(`SELECT s.company_id AS id, c.name AS company, s.board, s.step, s.reason, s.jobs, s.owner,
    s.suggested_at AS suggestedAt ${from} ORDER BY s.suggested_at DESC, s.company_id LIMIT ${MAINTENANCE_LIST}`).all()
    .map(({ board, ...row }) => ({ ...row, options: [board] }));
  return { suggestions, suggestionCount: db.prepare(`SELECT COUNT(*) AS n ${from}`).get().n };
}

/** Repair briefs a developer has not finished, by reader. */
function openBriefs(db) {
  if (!hasTable(db, 'source_repair_briefs')) return [];
  return db.prepare(`SELECT id, reader, reason, opened_at AS openedAt, updated_at AS updatedAt, brief, employers
    FROM corpus.source_repair_briefs WHERE state = 'open' ORDER BY reader, reason LIMIT ${MAINTENANCE_LIST}`).all()
    .map((row) => ({ ...row, employers: parsed(row.employers, {}) }));
}

/** The newest report, with any employer removed since taken out of its lists. */
function newestMaintenanceReport(db) {
  const row = db.prepare('SELECT report FROM corpus.source_maintenance_runs ORDER BY finished_at DESC, run_id DESC LIMIT 1').get();
  if (!row) return null;
  const report = JSON.parse(row.report);
  const removed = new Set(db.prepare("SELECT id FROM corpus.companies WHERE discover_status = 'removed'").all().map((company) => company.id));
  const listed = (items) => (Array.isArray(items) ? items.filter((item) => item && !removed.has(item.id)) : []);
  if (report && report.discovery) {
    report.discovery.connected = listed(report.discovery.connected);
    report.discovery.suggested = listed(report.discovery.suggested);
  }
  return report;
}

/**
 * @description What source maintenance left for people: its newest report, the decisions waiting for a person, the open
 * repair briefs and the open suggestions. Read-only, from the published corpus.
 * @param {object} db - The corpus, attached as `corpus`.
 * @returns {object | null} Null before maintenance has run on this corpus; `{unreadable: true}` if it cannot be read.
 */
function sourceMaintenance(db) {
  try {
    if (!hasTable(db, 'source_maintenance_runs')) return null;
    return { report: newestMaintenanceReport(db), ...openActions(db), briefs: openBriefs(db), ...openSuggestions(db), keepTryingDays: KEEP_TRYING_DAYS };
  } catch {
    return { unreadable: true }; // The page says so: a bad report must not hide the company list.
  }
}

const plural = (count, one, many) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
/** Up to five names in a sentence, then how many more there are. */
function named(names, total = names.length) {
  return names.slice(0, 5).map((name) => String(name).slice(0, 80)).join(', ') + (total > 5 ? ` and ${(total - 5).toLocaleString('en-US')} more` : '');
}

/**
 * @description The daily briefing: what last night's maintenance newly left for a person, as short items the kernel's
 * schedule report takes (objects only, at most 32, under 30,720 bytes together; a field named like a credential is dropped).
 * A decision or a brief is told on the morning after it opened and not again, so a quiet night is an empty list.
 * @param {object} db - The corpus, attached as `corpus`.
 * @param {number} [now] - The time to judge "last night" from, in milliseconds.
 * @returns {object[]} At most 3 items; empty when nothing is new, or no report is newer than BRIEFING_HOURS.
 */
function maintenanceBriefing(db, now = Date.now()) {
  const state = sourceMaintenance(db);
  const finished = Date.parse(state?.report?.finishedAt);
  if (!state || state.unreadable || !Number.isFinite(finished) || now - finished > BRIEFING_HOURS * 3600 * 1000) return [];
  const since = String(state.report.since || '');
  const items = [];
  const decisions = hasTable(db, 'source_actions') ? db.prepare(`SELECT c.name FROM corpus.source_actions a
    JOIN corpus.companies c ON c.id = a.company_id WHERE a.state = 'open' AND a.opened_at >= ?
    AND COALESCE(c.discover_status, '') <> 'removed' ORDER BY a.id`).all(since).map((row) => row.name) : [];
  if (since && decisions.length > 0) {
    items.push({ title: `${plural(decisions.length, 'more job source needs', 'more job sources need')} your decision`, count: decisions.length,
      detail: `Career could not connect ${named(decisions)}. Archive each one or keep trying. ${plural(state.actionCount, 'decision is', 'decisions are')} waiting in all.`,
      link: MAINTENANCE_LINK });
  }
  const briefs = state.briefs.filter((brief) => since && String(brief.openedAt) >= since);
  if (briefs.length > 0) {
    items.push({ title: `${plural(briefs.length, 'new repair brief is', 'new repair briefs are')} ready for a developer`, count: briefs.length,
      detail: `Reads keep ending part way on ${named(briefs.map((brief) => `${brief.reader} (${plural(Number(brief.employers.count || 0), 'employer', 'employers')})`))}. ${plural(state.briefs.length, 'brief is', 'briefs are')} open in all.`,
      link: MAINTENANCE_LINK });
  }
  const connected = state.report.discovery?.connected ?? [];
  if (connected.length > 0) {
    items.push({ title: `${plural(connected.length, 'job source was', 'job sources were')} connected last night`, count: connected.length,
      detail: `Career found a job site for ${named(connected.map((entry) => entry.company))}.`, link: MAINTENANCE_LINK });
  }
  return items;
}

module.exports = { sourceHealthByCompany, latestSourceReview, sourceMaintenance, maintenanceBriefing, decisionWaiting, MAINTENANCE_LINK, KEEP_TRYING_DAYS };
