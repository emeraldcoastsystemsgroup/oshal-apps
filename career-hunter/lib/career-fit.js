/** CHANGE LOG
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

/** A saved fingerprint records evidence; it cannot prove that evidence is still current. */
function assessment(job) {
  const ai = score(job.ai_fit_score), keyword = score(job.fit_score);
  if (ai !== null) return {
    kind: 'ai', score: ai, assessedAt: assessedAt(job.ai_scored_at), model: model(job.ai_model),
    inputRecorded: typeof job.ai_input_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(job.ai_input_fingerprint),
    currentness: 'not-revalidated',
  };
  return { kind: keyword !== null ? 'keyword' : 'none', score: keyword,
    assessedAt: null, model: null, inputRecorded: false, currentness: 'not-applicable' };
}

function decorateFit(job) {
  return { ...job, fit_assessment: assessment(job), land_prob: null, high_win: null };
}

module.exports = { assessment, decorateFit };
