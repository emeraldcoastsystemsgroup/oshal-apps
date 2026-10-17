/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native Futures study's SQL - one saved study per person and its run ledger (migrations/004-native-futures-research.sql). Every statement is scoped by user_sub; a run is claimed as 'running' and settled once.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Research reviews (migrations/005-native-futures-reviews.sql): one per run, claimed by an attempt id (new, failed, or interrupted for over an hour) and settled only by that attempt; one run read by id.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Forward research calls (migrations/006-native-futures-predictions.sql): record a frozen call, list the latest 50, read pending calls with their inputs, settle a pending call once.
 *
 * @module futures/store
 */
'use strict';

const SQL = {
  STUDY_GET: 'SELECT config, updated_at FROM oshal_trading_futures_native_studies WHERE user_sub = $1',
  STUDY_SAVE: `INSERT INTO oshal_trading_futures_native_studies (user_sub, config, created_at, updated_at) VALUES ($1, $2, $3, $3)
    ON CONFLICT (user_sub) DO UPDATE SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at`,
  STUDY_DELETE: 'DELETE FROM oshal_trading_futures_native_studies WHERE user_sub = $1',
  RUNNING: "SELECT run_id, created_at FROM oshal_trading_futures_native_runs WHERE user_sub = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
  RUN_INSERT: "INSERT INTO oshal_trading_futures_native_runs (run_id, user_sub, status, config, created_at) VALUES ($1, $2, 'running', $3, $4)",
  RUN_SETTLE: "UPDATE oshal_trading_futures_native_runs SET status = $3, markets = $4, error = $5, finished_at = $6 WHERE user_sub = $1 AND run_id = $2 AND status = 'running'",
  RUN_GET: 'SELECT run_id, status, config, markets, error, created_at, finished_at FROM oshal_trading_futures_native_runs WHERE user_sub = $1 AND run_id = $2',
  REVIEWS_LIST: 'SELECT run_id, status, attempt_id, requested_at, completed_at, result, error FROM oshal_trading_futures_native_reviews WHERE user_sub = $1',
  REVIEW_GET: 'SELECT run_id, status, attempt_id, requested_at, completed_at, result, error FROM oshal_trading_futures_native_reviews WHERE user_sub = $1 AND run_id = $2',
  REVIEW_INSERT: "INSERT INTO oshal_trading_futures_native_reviews (run_id, user_sub, status, attempt_id, requested_at) VALUES ($1, $2, 'reviewing', $3, $4)",
  REVIEW_RECLAIM: "UPDATE oshal_trading_futures_native_reviews SET status = 'reviewing', attempt_id = $3, requested_at = $4, completed_at = NULL, result = NULL, error = NULL WHERE user_sub = $1 AND run_id = $2 AND attempt_id = $5",
  REVIEW_SETTLE: "UPDATE oshal_trading_futures_native_reviews SET status = $4, completed_at = $5, result = $6, error = $7 WHERE user_sub = $1 AND run_id = $2 AND attempt_id = $3 AND status = 'reviewing'",
  PRED_INSERT: `INSERT INTO oshal_trading_futures_native_predictions (prediction_id, user_sub, run_id, root, contract, status, reason, issued_at, checked_at, snapshot)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
  PRED_LIST: 'SELECT prediction_id, run_id, root, contract, status, reason, issued_at, checked_at, outcome FROM oshal_trading_futures_native_predictions WHERE user_sub = $1 ORDER BY issued_at DESC LIMIT 50',
  PRED_PENDING: "SELECT prediction_id, issued_at, snapshot FROM oshal_trading_futures_native_predictions WHERE user_sub = $1 AND status = 'pending' ORDER BY issued_at LIMIT 50",
  PRED_GET: 'SELECT prediction_id, run_id, root, contract, status, reason, issued_at, checked_at, snapshot, outcome FROM oshal_trading_futures_native_predictions WHERE user_sub = $1 AND prediction_id = $2',
  PRED_SETTLE: "UPDATE oshal_trading_futures_native_predictions SET status = $3, reason = $4, outcome = $5, checked_at = $6 WHERE user_sub = $1 AND prediction_id = $2 AND status = 'pending'",
  PRED_CHECKED: "UPDATE oshal_trading_futures_native_predictions SET checked_at = $3 WHERE user_sub = $1 AND prediction_id = $2 AND status = 'pending'",
  RUNS_LIST: 'SELECT run_id, status, config, markets, error, created_at, finished_at FROM oshal_trading_futures_native_runs WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 20',
};

const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** @description The person's saved study, or null. @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<object|null>} {config, updatedAt}. */
async function loadStudy(pool, sub) {
  const row = (await pool.query(SQL.STUDY_GET, [sub])).rows[0];
  return row ? { config: parse(row.config), updatedAt: iso(row.updated_at) } : null;
}
/** @description Save (replace) the person's study. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {object} config - Normalized settings. @param {Date} at - Clock. @returns {Promise<void>} */
async function saveStudy(pool, sub, config, at) { await pool.query(SQL.STUDY_SAVE, [sub, JSON.stringify(config), at]); }
/** @description Remove the person's study (its runs stay as history). @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<number>} Rows removed. */
async function deleteStudy(pool, sub) { return (await pool.query(SQL.STUDY_DELETE, [sub])).rowCount || 0; }
/** @description The person's running run, if any. @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<object|null>} {runId, createdAt}. */
async function runningRun(pool, sub) {
  const row = (await pool.query(SQL.RUNNING, [sub])).rows[0];
  return row ? { runId: row.run_id, createdAt: iso(row.created_at) } : null;
}
/** @description Claim a run. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - New id. @param {object} config - Settings. @param {Date} at - Clock. @returns {Promise<void>} */
async function claimRun(pool, sub, runId, config, at) { await pool.query(SQL.RUN_INSERT, [runId, sub, JSON.stringify(config), at]); }
/** @description Settle a running run once. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - Run. @param {{status: string, markets?: object[], error?: string}} outcome - Result. @param {Date} at - Clock. @returns {Promise<boolean>} Whether it settled. */
async function settleRun(pool, sub, runId, outcome, at) {
  const r = await pool.query(SQL.RUN_SETTLE, [sub, runId, outcome.status, outcome.markets ? JSON.stringify(outcome.markets) : null, outcome.error || null, at]);
  return (r.rowCount || 0) === 1;
}
/** @description The person's recent runs, newest first, in the panel's shape. @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<object[]>} Runs. */
async function listRuns(pool, sub) {
  return (await pool.query(SQL.RUNS_LIST, [sub])).rows.map((r) => ({ runId: r.run_id, status: r.status, config: parse(r.config),
    markets: parse(r.markets) || [], error: r.error || null, createdAt: iso(r.created_at), finishedAt: iso(r.finished_at) }));
}

const reviewRow = (r) => ({ status: r.status, attemptId: r.attempt_id, requestedAt: iso(r.requested_at), completedAt: iso(r.completed_at),
  result: parse(r.result), error: r.error || null });
/** @description One of the person's runs. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - Run. @returns {Promise<object|null>} The run. */
async function loadRun(pool, sub, runId) {
  const r = (await pool.query(SQL.RUN_GET, [sub, runId])).rows[0];
  return r ? { runId: r.run_id, status: r.status, config: parse(r.config), markets: parse(r.markets) || [], error: r.error || null, createdAt: iso(r.created_at), finishedAt: iso(r.finished_at) } : null;
}
/** @description The person's reviews by run id. @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<Map<string, object>>} Reviews. */
async function listReviews(pool, sub) { return new Map((await pool.query(SQL.REVIEWS_LIST, [sub])).rows.map((r) => [r.run_id, reviewRow(r)])); }
/** @description One run's review. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - Run. @returns {Promise<object|null>} Review. */
async function loadReview(pool, sub, runId) { const r = (await pool.query(SQL.REVIEW_GET, [sub, runId])).rows[0]; return r ? reviewRow(r) : null; }
/** @description Claim a review attempt (new, failed, or interrupted for over an hour). @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - Run. @param {string} attemptId - Attempt. @param {Date} at - Clock. @returns {Promise<boolean>} Whether this attempt holds the review. */
async function claimReview(pool, sub, runId, attemptId, at) {
  const current = await loadReview(pool, sub, runId);
  if (!current) {
    // A concurrent first request inserts the same run's row: that one holds the review.
    try { await pool.query(SQL.REVIEW_INSERT, [runId, sub, attemptId, at]); return true; } catch { return false; }
  }
  const stale = current.status === 'reviewing' && Date.parse(current.requestedAt) < at.getTime() - 3600000;
  if (current.status !== 'failed' && !stale) return false;
  const r = await pool.query(SQL.REVIEW_RECLAIM, [sub, runId, attemptId, at, current.attemptId]);
  return (r.rowCount || 0) === 1;
}
/** @description Settle the attempt that holds the review. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} runId - Run. @param {string} attemptId - Attempt. @param {{status: string, result?: object, error?: string}} outcome - Result. @param {Date} at - Clock. @returns {Promise<boolean>} Whether it settled. */
async function settleReview(pool, sub, runId, attemptId, outcome, at) {
  const r = await pool.query(SQL.REVIEW_SETTLE, [sub, runId, attemptId, outcome.status, at, outcome.result ? JSON.stringify(outcome.result) : null, outcome.error || null]);
  return (r.rowCount || 0) === 1;
}

const predRow = (r) => ({ predictionId: r.prediction_id, runId: r.run_id, root: r.root, contract: r.contract, status: r.status, reason: r.reason || null,
  issuedAt: iso(r.issued_at), checkedAt: iso(r.checked_at), outcome: parse(r.outcome), ...(r.snapshot !== undefined ? { snapshot: parse(r.snapshot) } : {}) });
/** @description Record one frozen forward call. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {object} p - {predictionId, runId, root, contract, status, reason, snapshot}. @param {Date} at - Issuance. @returns {Promise<void>} */
async function insertPrediction(pool, sub, p, at) {
  await pool.query(SQL.PRED_INSERT, [p.predictionId, sub, p.runId, p.root, p.contract || null, p.status, p.reason || null, at, p.snapshot ? JSON.stringify(p.snapshot) : null]);
}
/** @description The person's latest 50 forward receipts (no replay inputs). @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<object[]>} Receipts. */
async function listPredictions(pool, sub) { return (await pool.query(SQL.PRED_LIST, [sub])).rows.map(predRow); }
/** @description The person's pending calls with their frozen inputs. @param {object} pool - SQL pool. @param {string} sub - Owner. @returns {Promise<object[]>} Pending. */
async function pendingPredictions(pool, sub) {
  return (await pool.query(SQL.PRED_PENDING, [sub])).rows.map((r) => ({ predictionId: r.prediction_id, issuedAt: iso(r.issued_at), snapshot: parse(r.snapshot) }));
}
/** @description One receipt with its replay inputs. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} id - Prediction. @returns {Promise<object|null>} Receipt. */
async function loadPrediction(pool, sub, id) { const r = (await pool.query(SQL.PRED_GET, [sub, id])).rows[0]; return r ? predRow(r) : null; }
/** @description Settle a pending call once (graded or unavailable), or just stamp the check. @param {object} pool - SQL pool. @param {string} sub - Owner. @param {string} id - Prediction. @param {object} outcome - {status, reason, ...}. @param {Date} at - Clock. @returns {Promise<void>} */
async function settlePrediction(pool, sub, id, outcome, at) {
  if (outcome.status === 'pending') { await pool.query(SQL.PRED_CHECKED, [sub, id, at]); return; }
  await pool.query(SQL.PRED_SETTLE, [sub, id, outcome.status, outcome.reason || null, JSON.stringify(outcome), at]);
}

module.exports = { insertPrediction, listPredictions, pendingPredictions, loadPrediction, settlePrediction, loadRun, listReviews, loadReview, claimReview, settleReview, SQL, loadStudy, saveStudy, deleteStudy, runningRun, claimRun, settleRun, listRuns };
