/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "even if we can only see their title .. at least run it up with a warning"): a job the nightly pass could not read, marked {"needsDetails":...} in ai_model with no AI score, has its own kind, `needs-details`, with when it was marked; every other job reads as before.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A score the settled nightly pass made names the three runs it was settled on (settledOn), and a close call it left undecided has its own kind, `undecided`, with its runs and nights, instead of reading as a job with no AI fit. A keyword-only job and every older score read as before.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Describe saved AI assessments separately from keyword matches, retain dates/model provenance and retire unsupported hiring-probability and qualification bonuses.
 */
'use strict';

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** SQLite's historical timezone-free timestamps were written in UTC. */
function assessedAt(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const instant = Date.parse(text);
  return Number.isFinite(instant) && instant <= Date.now() + 60000 ? new Date(instant).toISOString() : null;
}

function model(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.provider !== 'string' || typeof parsed.model !== 'string'
      || !parsed.provider || !parsed.model || parsed.provider.length > 128 || parsed.model.length > 128
      || /[\u0000-\u001f\u007f]/.test(parsed.provider + parsed.model)) return null;
    return { provider: parsed.provider, model: parsed.model,
      ...(typeof parsed.fallback === 'boolean' ? { fallback: parsed.fallback } : {}) };
  } catch { return null; }
}

/** How a settled nightly score was reached: the three runs it was settled on (engine/jobhunter/settle.py). */
function settledRuns(value) {
  try {
    const runs = (typeof value === 'string' ? JSON.parse(value) : value)?.settled?.runs;
    return Array.isArray(runs) && runs.length === 3 && runs.every(run => run === null || score(run) !== null) ? runs : null;
  } catch { return null; }
}

/** A close call the nightly pass left undecided: no AI score, its three runs and nights kept in ai_model. */
function undecided(value) {
  if (typeof value !== 'string' || !value.startsWith('{"undecided":') || value.length > 512) return null;
  try {
    const parsed = JSON.parse(value);
    const runs = settledRuns({ settled: { runs: parsed.runs } });
    return Number.isSafeInteger(parsed.undecided) && parsed.undecided > 0 && runs
      ? { nights: parsed.undecided, runs, at: assessedAt(parsed.at) } : null;
  } catch { return null; }
}

/** A job whose details the nightly pass could not read: no AI score, {"needsDetails":1,"at":...} in ai_model (engine/jobhunter/score.py). */
function needsDetails(value) {
  if (typeof value !== 'string' || !value.startsWith('{"needsDetails":') || value.length > 256) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && parsed.needsDetails === 1 ? { at: assessedAt(parsed.at) } : null;
  } catch { return null; }
}

/** A saved fingerprint records evidence; it cannot prove that evidence is still current. */
function assessment(job) {
  const ai = score(job.ai_fit_score), keyword = score(job.fit_score);
  if (ai !== null) {
    const runs = settledRuns(job.ai_model);
    return {
      kind: 'ai', score: ai, assessedAt: assessedAt(job.ai_scored_at), model: model(job.ai_model),
      inputRecorded: typeof job.ai_input_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(job.ai_input_fingerprint),
      currentness: 'not-revalidated', ...(runs ? { settledOn: runs } : {}),
    };
  }
  const unread = needsDetails(job.ai_model);
  if (unread) return { kind: 'needs-details', score: null, assessedAt: unread.at, model: null, inputRecorded: false,
    currentness: 'not-applicable', keyword };
  const close = undecided(job.ai_model);
  if (close) return { kind: 'undecided', score: null, assessedAt: close.at, model: null, inputRecorded: false,
    currentness: 'not-applicable', runs: close.runs, nights: close.nights };
  return { kind: keyword !== null ? 'keyword' : 'none', score: keyword,
    assessedAt: null, model: null, inputRecorded: false, currentness: 'not-applicable' };
}

function decorateFit(job) {
  return { ...job, fit_assessment: assessment(job), land_prob: null, high_win: null };
}

module.exports = { assessment, decorateFit, needsDetails };
