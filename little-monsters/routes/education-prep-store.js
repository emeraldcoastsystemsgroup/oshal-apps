"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.history = history;
exports.activeSessions = activeSessions;
exports.getSession = getSession;
exports.questionBank = questionBank;
exports.answerHistory = answerHistory;
exports.startSession = startSession;
exports.updateSession = updateSession;
exports.readProfile = readProfile;
exports.saveProfile = saveProfile;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner/tenant-scoped durable test-prep state with optimistic concurrency.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retry rolled-back native collection conflicts from fresh reads; keep completed saves immutable and idempotent.
 */
const crypto_1 = require("crypto");
const education_transactions_1 = require("./education-transactions");
const education_prep_model_1 = require("./education-prep-model");
const education_prep_progress_1 = require("./education-prep-progress");
const scope = 'student_id = $1 AND tenant_id = $2';
function params(actor) { return [actor.studentId, actor.tenantId]; }
function decoded(row) { return { ...row, state: typeof row.state === 'string' ? JSON.parse(row.state) : row.state }; }
/** Retry only definite native transaction conflicts, never uncertain commits or stale student revisions. */
async function prepTransaction(pool, action) {
    for (let attempt = 0;; attempt++) {
        try {
            return await (0, education_transactions_1.schoolTransaction)(pool, action);
        }
        catch (err) {
            const conflict = (0, education_transactions_1.isNativeSchoolStore)(pool) && err instanceof Error &&
                err.message === 'refused: conflict: scoped collection revision or expected body changed';
            if (!conflict)
                throw err;
            if (attempt === 3)
                throw new education_prep_model_1.PrepError('Practice changed while saving. Reload and try again.', 409);
            await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
}
async function history(pool, actor) {
    const result = await pool.query(`SELECT session_id, state, revision FROM lm_prep_sessions WHERE ${scope} AND status = 'complete' ORDER BY completed_at DESC LIMIT 200`, params(actor));
    return result.rows.map(decoded);
}
async function activeSessions(pool, actor) {
    const result = await pool.query(`SELECT session_id, state, revision FROM lm_prep_sessions WHERE ${scope} AND status IN ('ready', 'active') ORDER BY created_at DESC LIMIT 20`, params(actor));
    return result.rows.map(decoded).map(r => ({ id: r.session_id, exam: r.state.exam, mode: r.state.mode, status: r.state.status, createdAt: r.state.createdAt }));
}
async function getSession(pool, actor, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new education_prep_model_1.PrepError('Practice session not found.', 404);
    const result = await pool.query(`SELECT session_id, state, revision FROM lm_prep_sessions WHERE ${scope} AND session_id = $3`, [...params(actor), id]);
    if (!result.rows[0])
        throw new education_prep_model_1.PrepError('Practice session not found.', 404);
    return decoded(result.rows[0]);
}
async function questionBank(pool) {
    const result = await pool.query('SELECT question_id, question FROM lm_prep_questions WHERE catalog_version = $1', [education_prep_model_1.catalog.version]);
    const bank = result.rows.map(row => {
        const q = typeof row.question === 'string' ? JSON.parse(row.question) : row.question;
        const key = education_prep_model_1.catalog.questions.find(item => item.id === row.question_id);
        if (!key || q.id !== key.id || q.prompt !== key.prompt || JSON.stringify(q.options) !== JSON.stringify(key.options) || q.skill !== key.skill) {
            throw new education_prep_model_1.PrepError('The shared question bank needs its matching curriculum release.', 503);
        }
        // The bank is common and read-only. Keys/explanations come only from the server curriculum.
        return { ...key, prompt: q.prompt, options: q.options };
    });
    if (bank.length !== education_prep_model_1.catalog.questions.length)
        throw new education_prep_model_1.PrepError('The shared question bank has not finished installation.', 503);
    return bank;
}
/** Session state and its per-question ledger always commit together. */
async function recordAnswers(client, actor, id, state, blockIndex, questionId) {
    for (const [index, block] of state.blocks.entries()) {
        if (blockIndex !== undefined && index !== blockIndex)
            continue;
        for (const [position, q] of block.questions.entries()) {
            if (questionId && questionId !== q.id)
                continue;
            const a = block.answers[q.id], reflection = state.reflections[q.id], complete = state.status === 'complete';
            await client.query(`INSERT INTO lm_prep_answers
        (session_id, question_id, student_id, tenant_id, catalog_version, exam, section, skill, block_index, question_position,
         choice, active_ms, target_ms, confidence, flagged, correct, graded_at, mistake_reason, reflection, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (session_id, question_id) DO UPDATE SET choice=EXCLUDED.choice, active_ms=EXCLUDED.active_ms,
          confidence=EXCLUDED.confidence, flagged=EXCLUDED.flagged, correct=EXCLUDED.correct, graded_at=EXCLUDED.graded_at,
          mistake_reason=EXCLUDED.mistake_reason, reflection=EXCLUDED.reflection, updated_at=EXCLUDED.updated_at`, [id, q.id, actor.studentId, actor.tenantId, state.version, state.exam, q.sections[state.exam], q.skill, index, position,
                a?.choice ?? null, a?.ms || 0, Math.round(q.targetSeconds * state.multiplier * 1000), a?.confidence || 'unsure', a?.flagged || false,
                complete ? a?.choice === q.answer : null, complete ? new Date(state.completedAt).toISOString() : null,
                reflection?.reason || '', reflection?.note || '', new Date().toISOString()]);
        }
    }
}
async function answerHistory(pool, actor, exam, skill) {
    if (skill && !education_prep_model_1.catalog.lessons.some(l => l.id === skill && l.sections[exam]))
        throw new education_prep_model_1.PrepError('Unknown exam skill.');
    const result = await pool.query(`SELECT session_id, question_id, catalog_version, exam, section, skill, choice, active_ms, target_ms,
    confidence, flagged, correct, graded_at, mistake_reason, reflection FROM lm_prep_answers
    WHERE ${scope} AND exam = $3 AND graded_at IS NOT NULL${skill ? ' AND skill = $4' : ''} ORDER BY graded_at DESC LIMIT 200`, [...params(actor), exam, ...(skill ? [skill] : [])]);
    return result.rows.map(row => ({ ...row, reviewUrl: `/api/education/test-prep?session=${row.session_id}` }));
}
async function startSession(pool, actor, input, prepared = false) {
    const rows = await history(pool, actor), now = Date.now();
    const progress = (0, education_prep_progress_1.summarize)(rows, input.exam, now, input.science === true);
    const state = (0, education_prep_model_1.createSession)(input, new Set(progress.seen), progress.skills.map((s) => s.id), now, await questionBank(pool));
    if (prepared) {
        state.status = 'ready';
        state.blocks[0].startedAt = null;
    }
    const id = (0, crypto_1.randomUUID)();
    await prepTransaction(pool, async (client) => {
        await client.query(`INSERT INTO lm_prep_sessions (session_id, student_id, tenant_id, status, state, revision, created_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, 0, $6)`, [id, actor.studentId, actor.tenantId, state.status, JSON.stringify(state), new Date(now).toISOString()]);
        await recordAnswers(client, actor, id, state);
    });
    return { session_id: id, state, revision: 0 };
}
async function updateSession(pool, actor, id, input) {
    if (!Number.isInteger(input.revision) || input.revision < 0)
        throw new education_prep_model_1.PrepError('A session revision is required.');
    return prepTransaction(pool, async (client) => {
        const row = await getSession(client, actor, id);
        if (row.revision !== input.revision)
            throw new education_prep_model_1.PrepError('This practice changed in another tab. Reload to resume the saved version.', 409);
        if (row.state.status === 'complete' && ['save', 'finish', 'continue'].includes(input.action))
            return row;
        const state = (0, education_prep_model_1.changeSession)(row.state, input, Date.now());
        const result = await client.query(`UPDATE lm_prep_sessions SET state = $4::jsonb, status = $5, revision = revision + 1, completed_at = $7
      WHERE ${scope} AND session_id = $3 AND revision = $6 RETURNING revision`, [...params(actor), id, JSON.stringify(state), state.status, row.revision, state.completedAt === null ? null : new Date(state.completedAt).toISOString()]);
        if (result.rows.length !== 1)
            throw new education_prep_model_1.PrepError('Practice changed. Reload to resume.', 409);
        await recordAnswers(client, actor, id, state, state.status === 'complete' ? undefined : state.current, input.action === 'reflect' ? input.questionId : undefined);
        return { session_id: id, state, revision: Number(result.rows[0].revision) };
    });
}
async function readProfile(pool, actor) {
    const result = await pool.query(`SELECT profile FROM lm_prep_profiles WHERE ${scope}`, params(actor));
    const profile = result.rows[0]?.profile;
    return profile ? typeof profile === 'string' ? JSON.parse(profile) : profile : { exam: 'SAT', dailyMinutes: 15, testDate: '', lessons: {} };
}
async function saveProfile(pool, actor, input) {
    return prepTransaction(pool, async (client) => {
        // Serialize profile changes through the existing learner row on PostgreSQL;
        // native storage transactions validate the read set at commit.
        if (!(0, education_transactions_1.isNativeSchoolStore)(pool))
            await client.query('SELECT student_id FROM lm_students WHERE student_id = $1 AND tenant_id = $2 FOR UPDATE', params(actor));
        const profile = await readProfile(client, actor);
        if (input.action === 'lesson') {
            if (!education_prep_model_1.catalog.lessons.some(l => l.id === input.lessonId))
                throw new education_prep_model_1.PrepError('Unknown lesson.');
            profile.lessons[input.lessonId] = { completedAt: Date.now(), version: education_prep_model_1.catalog.version };
        }
        else {
            if (!['SAT', 'ACT'].includes(input.exam) || ![10, 15, 20, 30].includes(input.dailyMinutes))
                throw new education_prep_model_1.PrepError('Choose an exam and daily study budget.');
            if (typeof input.testDate !== 'string' || (input.testDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.testDate) || !Number.isFinite(Date.parse(input.testDate)) || new Date(input.testDate).toISOString().slice(0, 10) !== input.testDate)))
                throw new education_prep_model_1.PrepError('Use a valid test date.');
            Object.assign(profile, { exam: input.exam, dailyMinutes: input.dailyMinutes, testDate: input.testDate });
        }
        await client.query(`INSERT INTO lm_prep_profiles (student_id, tenant_id, profile) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (student_id, tenant_id) DO UPDATE SET profile = EXCLUDED.profile`, [...params(actor), JSON.stringify(profile)]);
        return profile;
    });
}
//# sourceMappingURL=education-prep-store.js.map