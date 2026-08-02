"use strict";
/**
 * AI Bake-Off — the PURE half: spec validation, lane ranking, and the recommendation.
 *
 * Deliberately import-free (no `@/…`, no pg, no express) for two reasons: the honesty rules that
 * make a recommendation trustworthy are arithmetic, and arithmetic is the part that must be
 * covered by a dependency-free `node --test` suite running against the COMPILED js — the same
 * bytes the framework requires at mount.
 *
 * The rules encoded here are the reason this app is worth installing. A cost/quality table is
 * easy; a table that refuses to lie is the product:
 *   1. Mixed grading modes BLOCK the recommendation. An LLM judgement and the deterministic
 *      lexical proxy are different instruments — averaging them manufactures a number nobody
 *      measured. (Same rule the token-chase judged-savings report follows: never blend lanes.)
 *   2. A lane that FAILED is never a winner, however cheap a failure is.
 *   3. A lane BELOW the quality bar is never a winner. Cheap wrong output is the expensive kind.
 *   4. A lane reporting $0 has UNKNOWN cost, not free cost. It is excluded from the savings math
 *      and named in the caveats — a silent $0 is how a savings report becomes fiction.
 *   5. Fewer than two qualifying lanes is not a comparison. "Use the only lane you have" is not
 *      a finding, so it is blocked rather than dressed up as one.
 *   6. Every recommendation carries the sample-size caveat. One run per lane is a probe.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — the pure scoring core for the bake-off package: job-spec validation/clamping, lane summarisation with explicit cost-known tracking, judge-mode consensus, rank-with-reasons, and recommendLane's six fail-closed honesty gates. Lives apart from the engine/routes so the guards can run with plain node against routes/bake-off-scoring.js.
 *
 * @module bake-off-scoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BAKE_OFF_LIMITS = exports.BAKE_OFF_DEFAULTS = exports.JUDGE_MODE_LEXICAL = exports.JUDGE_MODE_LLM = void 0;
exports.normalizeRubric = normalizeRubric;
exports.validateJobSpec = validateJobSpec;
exports.laneKey = laneKey;
exports.summarizeResult = summarizeResult;
exports.judgeModeConsensus = judgeModeConsensus;
exports.rankLanes = rankLanes;
exports.projectSaving = projectSaving;
exports.recommendLane = recommendLane;
exports.buildReport = buildReport;
/** A grading lane produced by the real LLM judge (quality-judge bot). */
exports.JUDGE_MODE_LLM = 'llm';
/** A grading lane produced by the deterministic lexical proxy (no LLM was consulted). */
exports.JUDGE_MODE_LEXICAL = 'lexical-fallback';
/** Shipped defaults for a new bake-off job. A fresh install must be usable without tuning. */
exports.BAKE_OFF_DEFAULTS = Object.freeze({
    /** Minimum judge score (0-100) a lane must reach before it may be recommended. */
    qualityBar: 70,
    /** Runs per month, used only to turn a per-run delta into a monthly figure. */
    monthlyVolume: 100,
    /** Hard ceiling on lanes per run — every lane is a paid LLM call plus a paid grade. */
    maxLanes: 8,
    /** The default rubric: generic enough for any job, specific enough to separate lanes. */
    rubric: Object.freeze([
        'accuracy — factual correctness, no invented specifics',
        'completeness — every part of the request addressed',
        'instruction-following — the requested format and constraints honoured',
        'concision — no padding, no restatement of the prompt',
    ]),
});
/** Bounds enforced by {@link validateJobSpec}. Shared with the surface so labels match reality. */
exports.BAKE_OFF_LIMITS = Object.freeze({
    nameMax: 120,
    promptMin: 20,
    promptMax: 20000,
    referenceMax: 20000,
    rubricMax: 8,
    volumeMax: 1000000,
});
/** Coerce anything to a finite number, or `fallback`. */
function num(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}
/** Clamp `n` into [lo, hi]. */
function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}
/** Round to cents so a report never shows 14 digits of float noise. */
function money(n) {
    return Math.round(n * 100) / 100;
}
/** Round to 6dp — per-run LLM costs are routinely sub-cent, so cents would floor them to zero. */
function microMoney(n) {
    return Math.round(n * 1000000) / 1000000;
}
/**
 * @description Normalise a rubric to a non-empty list of trimmed criteria, or null when the
 * supplied value is present but unusable.
 *
 * The rubric is what makes scores comparable across lanes, so an empty or all-blank rubric must
 * be rejected rather than quietly replaced — a caller who sent `[]` meant something and should
 * be told it was wrong.
 *
 * @param raw - Candidate rubric from a request body (undefined/null = take the default).
 * @returns The cleaned rubric, or null when the supplied value cannot be used.
 */
function normalizeRubric(raw) {
    if (raw === undefined || raw === null)
        return [...exports.BAKE_OFF_DEFAULTS.rubric];
    if (!Array.isArray(raw))
        return null;
    const cleaned = raw
        .filter((r) => typeof r === 'string')
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .slice(0, exports.BAKE_OFF_LIMITS.rubricMax);
    return cleaned.length ? cleaned : null;
}
/**
 * @description Validate and clamp a bake-off job spec from an untrusted request body.
 *
 * Fail-closed on the two fields that decide whether the run means anything — a prompt too short
 * to differentiate lanes, and an unusable rubric — and clamp the rest, because a caller fat-
 * fingering `qualityBar: 900` wants a bake-off, not a 400.
 *
 * @param raw - The parsed request body.
 * @returns `{ok: true, spec}` or `{ok: false, error}` with a caller-facing message.
 */
function validateJobSpec(raw) {
    const body = (raw ?? {});
    const name = String(body.name ?? '').trim().slice(0, exports.BAKE_OFF_LIMITS.nameMax);
    if (!name)
        return { ok: false, error: 'name is required' };
    const prompt = String(body.prompt ?? '').trim();
    if (prompt.length < exports.BAKE_OFF_LIMITS.promptMin) {
        return { ok: false, error: `prompt must be at least ${exports.BAKE_OFF_LIMITS.promptMin} characters — a shorter prompt cannot separate one lane from another` };
    }
    if (prompt.length > exports.BAKE_OFF_LIMITS.promptMax) {
        return { ok: false, error: `prompt exceeds ${exports.BAKE_OFF_LIMITS.promptMax} characters` };
    }
    const rubric = normalizeRubric(body.rubric);
    if (!rubric)
        return { ok: false, error: 'rubric must be a non-empty array of criteria strings' };
    const referenceRaw = typeof body.reference === 'string' ? body.reference.trim() : '';
    const laneAgentIds = Array.isArray(body.laneAgentIds)
        ? body.laneAgentIds.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
        : [];
    return {
        ok: true,
        spec: {
            name,
            prompt,
            rubric,
            reference: referenceRaw ? referenceRaw.slice(0, exports.BAKE_OFF_LIMITS.referenceMax) : null,
            qualityBar: clamp(num(body.qualityBar, exports.BAKE_OFF_DEFAULTS.qualityBar), 0, 100),
            monthlyVolume: Math.round(clamp(num(body.monthlyVolume, exports.BAKE_OFF_DEFAULTS.monthlyVolume), 1, exports.BAKE_OFF_LIMITS.volumeMax)),
            laneAgentIds: laneAgentIds.slice(0, exports.BAKE_OFF_DEFAULTS.maxLanes),
        },
    };
}
/**
 * @description The stable display/identity key for a lane.
 *
 * A lane is a bot × harness × provider triple, not a model name: the model is whatever the
 * harness resolved at call time and is reported as observed evidence, never as the lane's
 * identity. Two bots on the same provider are still two lanes (different personas, different
 * prompts assembled), which is exactly what the operator is choosing between.
 *
 * @param lane - Any object carrying bot/harness/provider fields.
 * @returns A human-readable key, e.g. `research-bot·claude-code/claude-code`.
 */
function laneKey(lane) {
    const bot = lane.laneBot ?? lane.bot ?? 'unknown-bot';
    const harness = lane.laneHarness ?? lane.harness ?? 'unknown-harness';
    const provider = lane.laneProvider ?? lane.provider ?? 'unknown-provider';
    return `${bot}·${harness}/${provider}`;
}
/**
 * @description Reduce a persisted lane row to the fields ranking reasons over, deciding
 * `costKnown` explicitly.
 *
 * `costKnown` is the load-bearing field: a lane that returns `cost: 0` has told us nothing about
 * what it cost. Treating that as free is how a savings report ends up recommending the lane whose
 * cost capture is broken. So zero, negative, and non-finite costs all mean "unknown", and the
 * caller sees it as a caveat rather than a bargain.
 *
 * @param row - One persisted lane result.
 * @returns The summarised lane.
 */
function summarizeResult(row) {
    const cost = num(row.costUsd, 0);
    const ok = row.ok === true;
    return {
        laneKey: laneKey(row),
        bot: row.laneBot,
        agentId: row.laneAgentId,
        harness: row.laneHarness,
        provider: row.laneProvider,
        model: row.observedModel ?? null,
        ok,
        costUsd: microMoney(Math.max(0, cost)),
        costKnown: ok && cost > 0,
        score: clamp(num(row.judgeScore, 0), 0, 100),
        judgeMode: row.judgeMode ?? null,
        totalTokens: Math.max(0, Math.round(num(row.totalTokens, 0))),
        durationMs: Math.max(0, Math.round(num(row.durationMs, 0))),
        error: row.error ?? null,
    };
}
/**
 * @description Decide which instrument graded this run.
 *
 * Only lanes that actually produced output are consulted — a failed lane was never graded, so
 * its absent mode must not be what makes a run look "mixed".
 *
 * @param summaries - The run's lanes.
 * @returns `'llm'`, `'lexical-fallback'`, `'mixed'` when both instruments appear, or `'none'`.
 */
function judgeModeConsensus(summaries) {
    const modes = new Set(summaries.filter((s) => s.ok && s.judgeMode).map((s) => s.judgeMode));
    if (modes.size === 0)
        return 'none';
    if (modes.size > 1)
        return 'mixed';
    const only = [...modes][0];
    return only === exports.JUDGE_MODE_LLM ? exports.JUDGE_MODE_LLM : exports.JUDGE_MODE_LEXICAL;
}
/**
 * @description Split lanes into the ranked (cheapest-first) qualifying set and the rejected set.
 *
 * Rejection is single-reason and ordered deliberately: a failure is reported as a failure even if
 * the lane would also have missed the bar, because "it broke" and "it was mediocre" send the
 * operator to different places.
 *
 * @param summaries - The run's lanes.
 * @param qualityBar - Minimum score (0-100) a lane must reach.
 * @returns `{qualifying, rejected}` — qualifying sorted by cost ascending, then score descending.
 */
function rankLanes(summaries, qualityBar) {
    const qualifying = [];
    const rejected = [];
    for (const lane of summaries) {
        if (!lane.ok)
            rejected.push({ ...lane, reason: 'lane-failed' });
        else if (lane.score < qualityBar)
            rejected.push({ ...lane, reason: 'below-quality-bar' });
        else if (!lane.costKnown)
            rejected.push({ ...lane, reason: 'cost-unknown' });
        else
            qualifying.push(lane);
    }
    qualifying.sort((a, b) => (a.costUsd - b.costUsd) || (b.score - a.score));
    return { qualifying, rejected };
}
/**
 * @description Per-run and monthly saving from moving off `baseline` onto `winner`.
 *
 * Floored at zero: a negative "saving" means the cheapest qualifying lane is also the
 * highest-scoring one, which is good news, not a debt.
 *
 * @param baselineCostUsd - Per-run cost of the lane you would otherwise use.
 * @param winnerCostUsd - Per-run cost of the recommended lane.
 * @param monthlyVolume - Runs per month.
 * @returns `{perRunSavingUsd, monthlySavingUsd}`.
 */
function projectSaving(baselineCostUsd, winnerCostUsd, monthlyVolume) {
    const perRun = Math.max(0, num(baselineCostUsd, 0) - num(winnerCostUsd, 0));
    return {
        perRunSavingUsd: microMoney(perRun),
        monthlySavingUsd: money(perRun * Math.max(1, num(monthlyVolume, 1))),
    };
}
/** Pick the quality baseline: highest score, ties to the more expensive lane. */
function pickBaseline(qualifying) {
    return [...qualifying].sort((a, b) => (b.score - a.score) || (b.costUsd - a.costUsd))[0];
}
/** Caveats that apply to every reported run, whether or not a winner emerged. */
function baseCaveats(summaries, rejected, mode) {
    const caveats = ['One sample per lane — this is a probe, not a benchmark. Re-run before acting on a narrow margin.'];
    if (mode === exports.JUDGE_MODE_LEXICAL) {
        caveats.push('Graded by the deterministic lexical proxy, not an LLM judgement — treat scores as a smoke test, not evidence.');
    }
    const failed = rejected.filter((r) => r.reason === 'lane-failed').map((r) => r.laneKey);
    if (failed.length)
        caveats.push(`${failed.length} lane(s) failed and were excluded: ${failed.join(', ')}.`);
    const unknown = rejected.filter((r) => r.reason === 'cost-unknown').map((r) => r.laneKey);
    if (unknown.length) {
        caveats.push(`${unknown.length} lane(s) reported no cost and were excluded from the savings math (a $0 reading means cost capture failed, not that the lane is free): ${unknown.join(', ')}.`);
    }
    if (summaries.length && summaries.every((s) => s.durationMs === 0)) {
        caveats.push('No lane reported a duration — latency comparisons in this report are unavailable.');
    }
    return caveats;
}
/**
 * @description The report headline: the cheapest lane that still clears the quality bar, measured
 * against the highest-scoring lane, with the money that move saves.
 *
 * Blocks rather than guesses, in this order: nothing ran; the two grading instruments were mixed
 * (their scores are not comparable, so nothing may be concluded); no lane cleared the bar; fewer
 * than two lanes qualified (a field of one is not a comparison). Each block still returns the
 * caveats so the surface can explain itself instead of showing an empty panel.
 *
 * @param summaries - The run's summarised lanes.
 * @param opts - `qualityBar` (0-100) and `monthlyVolume` for the projection.
 * @returns The recommendation, with `winner: null` and a `blocked` reason when none is honest.
 */
function recommendLane(summaries, opts) {
    const mode = judgeModeConsensus(summaries);
    const qualityBar = clamp(num(opts?.qualityBar, exports.BAKE_OFF_DEFAULTS.qualityBar), 0, 100);
    const monthlyVolume = Math.max(1, Math.round(num(opts?.monthlyVolume, exports.BAKE_OFF_DEFAULTS.monthlyVolume)));
    const { qualifying, rejected } = rankLanes(summaries, qualityBar);
    const caveats = baseCaveats(summaries, rejected, mode);
    const empty = { winner: null, baseline: null, perRunSavingUsd: null, monthlySavingUsd: null, judgeMode: mode };
    if (!summaries.length)
        return { ...empty, blocked: 'no-results', caveats };
    if (mode === 'mixed') {
        caveats.unshift('Lanes were graded by DIFFERENT instruments (LLM judge and lexical fallback). Those scores are not comparable, so no lane is recommended — re-run with the judge bot reachable for every lane.');
        return { ...empty, blocked: 'mixed-judge-modes', caveats };
    }
    if (!qualifying.length) {
        caveats.unshift(`No lane reached the quality bar of ${qualityBar}. Lower the bar deliberately or fix the prompt — do not pick the least-bad lane by default.`);
        return { ...empty, blocked: 'no-qualifying-lane', caveats };
    }
    if (qualifying.length < 2) {
        caveats.unshift(`Only one lane qualified (${qualifying[0].laneKey}). A field of one is not a comparison, so nothing is recommended.`);
        return { ...empty, baseline: qualifying[0], blocked: 'insufficient-lanes', caveats };
    }
    const winner = qualifying[0];
    const baseline = pickBaseline(qualifying);
    const saving = projectSaving(baseline.costUsd, winner.costUsd, monthlyVolume);
    if (winner.laneKey === baseline.laneKey) {
        caveats.unshift('Your highest-scoring lane is already the cheapest that clears the bar — there is nothing to switch.');
    }
    return { winner, baseline, ...saving, judgeMode: mode, blocked: null, caveats };
}
/**
 * @description Assemble the full report object the surface and the analyst bot both read.
 *
 * One assembly point so the narrative the bot writes and the table the human sees can never
 * disagree about which lane won.
 *
 * @param rows - Persisted lane results for one run.
 * @param opts - `qualityBar` and `monthlyVolume` from the job spec.
 * @returns `{lanes, qualifying, rejected, recommendation}`.
 */
function buildReport(rows, opts) {
    const lanes = (rows ?? []).map(summarizeResult);
    const { qualifying, rejected } = rankLanes(lanes, clamp(num(opts?.qualityBar, exports.BAKE_OFF_DEFAULTS.qualityBar), 0, 100));
    return { lanes, qualifying, rejected, recommendation: recommendLane(lanes, opts) };
}
//# sourceMappingURL=bake-off-scoring.js.map