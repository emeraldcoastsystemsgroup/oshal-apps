"use strict";
/**
 * Education Study Store — Little Monsters Platform API
 *
 * All flashcard set/card resolution is permission-bound in SQL. Class sets are
 * readable by enrolled users but writable only by the tenant's class teacher or
 * admin. Private sets are readable/writable only by their persisted owner.
 * Historical private rows without an owner intentionally match neither scope.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add owner-aware, tenant-bound flashcard persistence and safe SM-2 review writes.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listReadableSets = listReadableSets;
exports.listReadableCards = listReadableCards;
exports.updateStudyCard = updateStudyCard;
exports.deleteStudyCard = deleteStudyCard;
exports.addStudyCard = addStudyCard;
exports.deleteStudySet = deleteStudySet;
exports.createStudySet = createStudySet;
exports.recordStudyReview = recordStudyReview;
const crypto_1 = require("crypto");
const education_access_1 = require("./education-access");
const education_study_errors_1 = require("./education-study-errors");
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CARD_TYPES = new Set(['term', 'concept', 'formula', 'fill-blank']);
const SOURCE_TYPES = new Set(['lecture', 'textbook', 'manual', 'quiz-review']);
function actorParams(actor) {
    return [
        actor.studentId,
        actor.tenantId,
        actor.role === 'admin',
        actor.role === 'teacher',
    ];
}
/** Build the common private-owner/class-membership policy with numbered binds. */
function studyScope(alias, start, mode) {
    const student = `$${start}`;
    const tenant = `$${start + 1}`;
    const admin = `$${start + 2}::boolean`;
    const teacher = `$${start + 3}::boolean`;
    const enrollment = mode === 'read'
        ? `OR EXISTS (SELECT 1 FROM lm_enrollments se
          WHERE se.student_id = ${student} AND se.class_id = ${alias}.class_id)`
        : '';
    return `(
    (${alias}.class_id IS NULL AND ${alias}.owner_student_id = ${student})
    OR (${alias}.class_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM lm_classes sc
       WHERE sc.class_id = ${alias}.class_id
         AND sc.tenant_id = ${tenant}
         AND (${admin} OR (${teacher} AND sc.teacher_student_id = ${student}) ${enrollment})
    ))
  )`;
}
function boundedText(value, max) {
    return String(value ?? '').trim().slice(0, max);
}
function normalizeHints(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(0, 10).map((hint) => boundedText(hint, 200)).filter(Boolean);
}
function normalizeCard(value, fallbackTopic) {
    const card = (value && typeof value === 'object' ? value : {});
    const front = boundedText(card.front, 500);
    const back = boundedText(card.back, 1000);
    if (!front || !back)
        throw new education_study_errors_1.StudyHttpError('Every card requires front and back', 400);
    const rawType = boundedText(card.type, 20);
    const difficulty = Math.min(Math.max(Number.parseInt(String(card.difficulty), 10) || 2, 1), 3);
    return {
        front,
        back,
        type: CARD_TYPES.has(rawType) ? rawType : 'concept',
        difficulty,
        topic: boundedText(card.topic || fallbackTopic, 100),
        hints: normalizeHints(card.hints),
    };
}
function normalizeSet(input) {
    const title = boundedText(input.title, 255);
    const rawCards = Array.isArray(input.cards) ? input.cards : [];
    if (!title || rawCards.length === 0) {
        throw new education_study_errors_1.StudyHttpError('title and cards[] are required', 400);
    }
    if (rawCards.length > 100)
        throw new education_study_errors_1.StudyHttpError('A set may contain at most 100 cards', 400);
    const topic = boundedText(input.topic, 100);
    const sourceType = boundedText(input.sourceType, 30);
    return {
        classId: input.classId ? String(input.classId) : null,
        title,
        topic: topic || null,
        sourceType: SOURCE_TYPES.has(sourceType) ? sourceType : 'manual',
        sourceReference: boundedText(input.sourceReference, 500) || null,
        cards: rawCards.map((card) => normalizeCard(card, topic)),
    };
}
function requireResourceId(value) {
    const id = String(value || '');
    if (!UUID_PATTERN.test(id))
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return id;
}
async function assertScopedSet(db, actor, setIdValue, mode) {
    const setId = requireResourceId(setIdValue);
    const result = await db.query(`SELECT fs.set_id FROM lm_flashcard_sets fs
      WHERE fs.set_id = $1 AND ${studyScope('fs', 2, mode)} LIMIT 1`, [setId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return setId;
}
async function assertScopedCard(db, actor, cardIdValue, mode) {
    const cardId = requireResourceId(cardIdValue);
    const result = await db.query(`SELECT fc.card_id FROM lm_flashcards fc
       JOIN lm_flashcard_sets fs ON fs.set_id = fc.set_id
      WHERE fc.card_id = $1 AND ${studyScope('fs', 2, mode)} LIMIT 1`, [cardId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return cardId;
}
/** List only sets visible through class membership or private ownership. */
async function listReadableSets(pool, actor, classId) {
    const classFilter = classId ? 'fs.class_id = $1 AND' : '';
    const start = classId ? 2 : 1;
    const params = classId ? [classId, ...actorParams(actor)] : actorParams(actor);
    const result = await pool.query(`SELECT fs.set_id, fs.class_id, fs.title, fs.topic, fs.source_type,
            fs.source_reference, fs.card_count, fs.created_at, c.name AS class_name
       FROM lm_flashcard_sets fs
       LEFT JOIN lm_classes c ON c.class_id = fs.class_id
      WHERE ${classFilter} ${studyScope('fs', start, 'read')}
      ORDER BY fs.created_at DESC`, params);
    return result.rows;
}
/** Resolve a set and its cards in one permission-bound read, including empty sets. */
async function listReadableCards(pool, actor, setIdValue) {
    const setId = requireResourceId(setIdValue);
    const result = await pool.query(`SELECT fs.set_id AS authorized_set_id, fc.card_id, fc.set_id, fc.front,
            fc.back, fc.card_type, fc.difficulty, fc.topic, fc.hints, fc.created_at
       FROM lm_flashcard_sets fs
       LEFT JOIN lm_flashcards fc ON fc.set_id = fs.set_id
      WHERE fs.set_id = $1 AND ${studyScope('fs', 2, 'read')}
      ORDER BY fc.difficulty, fc.card_id`, [setId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return result.rows.filter((row) => row.card_id).map(({ authorized_set_id: _ignored, ...card }) => card);
}
/** Edit a card only when the caller retains mutation rights at write time. */
async function updateStudyCard(pool, actor, cardIdValue, frontValue, backValue) {
    const cardId = await assertScopedCard(pool, actor, cardIdValue, 'write');
    const front = boundedText(frontValue, 500);
    const back = boundedText(backValue, 1000);
    if (!front || !back)
        throw new education_study_errors_1.StudyHttpError('front and back are required', 400);
    const result = await pool.query(`UPDATE lm_flashcards fc SET front = $1, back = $2
       FROM lm_flashcard_sets fs
      WHERE fc.card_id = $3 AND fs.set_id = fc.set_id
        AND ${studyScope('fs', 4, 'write')}
      RETURNING fc.card_id`, [front, back, cardId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
}
/** Delete a card and adjust its set count in the same permission-bound statement. */
async function deleteStudyCard(pool, actor, cardIdValue) {
    const cardId = await assertScopedCard(pool, actor, cardIdValue, 'write');
    const result = await pool.query(`WITH deleted AS (
       DELETE FROM lm_flashcards fc USING lm_flashcard_sets allowed
        WHERE fc.card_id = $1 AND allowed.set_id = fc.set_id
          AND ${studyScope('allowed', 2, 'write')}
       RETURNING fc.set_id
     )
     UPDATE lm_flashcard_sets fs SET card_count = GREATEST(0, fs.card_count - 1)
       FROM deleted d WHERE fs.set_id = d.set_id RETURNING fs.set_id`, [cardId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
}
/** Add a card only through an owner/teacher/admin-authorized set. */
async function addStudyCard(pool, actor, setIdValue, cardInput) {
    const setId = await assertScopedSet(pool, actor, setIdValue, 'write');
    const card = normalizeCard(cardInput, '');
    const result = await pool.query(`WITH inserted AS (
       INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty, topic, hints)
       SELECT allowed.set_id, $2, $3, $4, $5, $6, $7::jsonb
         FROM lm_flashcard_sets allowed
        WHERE allowed.set_id = $1 AND ${studyScope('allowed', 8, 'write')}
       RETURNING card_id, set_id
     )
     UPDATE lm_flashcard_sets fs SET card_count = fs.card_count + 1
       FROM inserted i WHERE fs.set_id = i.set_id RETURNING i.card_id`, [setId, card.front, card.back, card.type, card.difficulty, card.topic,
        JSON.stringify(card.hints), ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return result.rows[0].card_id;
}
/** Delete a set through its bound policy; card/progress rows cascade by schema. */
async function deleteStudySet(pool, actor, setIdValue) {
    const setId = await assertScopedSet(pool, actor, setIdValue, 'write');
    const result = await pool.query(`DELETE FROM lm_flashcard_sets fs
      WHERE fs.set_id = $1 AND ${studyScope('fs', 2, 'write')}
      RETURNING fs.set_id`, [setId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
}
async function insertStudySet(client, actor, setId, input) {
    const common = [setId, input.title, input.topic, input.sourceType,
        input.sourceReference, input.cards.length];
    const sql = input.classId
        ? `INSERT INTO lm_flashcard_sets
         (set_id, class_id, owner_student_id, title, topic, source_type, source_reference, card_count)
       SELECT $1, c.class_id, NULL, $2, $3, $4, $5, $6 FROM lm_classes c
        WHERE c.class_id = $7 AND c.tenant_id = $9
          AND ($10::boolean OR ($11::boolean AND c.teacher_student_id = $8)) RETURNING set_id`
        : `INSERT INTO lm_flashcard_sets
         (set_id, class_id, owner_student_id, title, topic, source_type, source_reference, card_count)
       VALUES ($1, NULL, $7, $2, $3, $4, $5, $6) RETURNING set_id`;
    const params = input.classId
        ? [...common, input.classId, actor.studentId, actor.tenantId,
            actor.role === 'admin', actor.role === 'teacher']
        : [...common, actor.studentId];
    const result = await client.query(sql, params);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
}
async function insertStudyCards(client, setId, cards) {
    for (const card of cards) {
        await client.query(`INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty, topic, hints)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [setId, card.front, card.back, card.type, card.difficulty, card.topic,
            JSON.stringify(card.hints)]);
    }
}
/** Create a class set for its teacher/admin, or a private set owned by the caller. */
async function createStudySet(pool, actor, rawInput) {
    const classId = rawInput.classId ? String(rawInput.classId) : null;
    if (classId)
        await (0, education_access_1.assertTeacherOfClass)(pool, actor, classId);
    const input = normalizeSet({ ...rawInput, classId });
    const setId = (0, crypto_1.randomUUID)();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await insertStudySet(client, actor, setId, input);
        await insertStudyCards(client, setId, input.cards);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    return { setId, title: input.title, cardCount: input.cards.length };
}
function calculateReview(row, score) {
    let easeFactor = Number(row?.ease_factor) || 2.5;
    let interval = Number(row?.interval_days) || 1;
    let repetitions = Number(row?.repetitions) || 0;
    if (score < 1)
        return { repetitions: 0, easeFactor, interval: 1 };
    repetitions += 1;
    interval = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(interval * easeFactor);
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (2 - score) * (0.08 + (2 - score) * 0.02)));
    return { repetitions, easeFactor, interval };
}
function dateAfterDays(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
async function writeReview(client, actor, cardId, state, nextReview) {
    const result = await client.query(`INSERT INTO lm_flashcard_progress
       (student_id, card_id, repetitions, ease_factor, interval_days, next_review, last_reviewed)
     SELECT $1, fc.card_id, $2, $3, $4, $5, NOW()
       FROM lm_flashcards fc JOIN lm_flashcard_sets fs ON fs.set_id = fc.set_id
      WHERE fc.card_id = $6 AND ${studyScope('fs', 7, 'read')}
     ON CONFLICT (student_id, card_id) DO UPDATE SET
       repetitions = EXCLUDED.repetitions, ease_factor = EXCLUDED.ease_factor,
       interval_days = EXCLUDED.interval_days, next_review = EXCLUDED.next_review,
       last_reviewed = NOW() RETURNING card_id`, [actor.studentId, state.repetitions, state.easeFactor, state.interval,
        nextReview, cardId, ...actorParams(actor)]);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
}
/** Record an authenticated caller's own SM-2 state for a readable card. */
async function recordStudyReview(pool, actor, cardIdValue, scoreValue) {
    const score = Number(scoreValue);
    if (!Number.isInteger(score) || score < 0 || score > 2) {
        throw new education_study_errors_1.StudyHttpError('cardId and score (0-2) are required', 400);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cardId = await assertScopedCard(client, actor, cardIdValue, 'read');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor.studentId}:${cardId}`]);
        const current = await client.query(`SELECT repetitions, ease_factor, interval_days FROM lm_flashcard_progress
        WHERE student_id = $1 AND card_id = $2 FOR UPDATE`, [actor.studentId, cardId]);
        const state = calculateReview(current.rows[0], score);
        const nextReview = dateAfterDays(state.interval);
        await writeReview(client, actor, cardId, state, nextReview);
        await client.query('COMMIT');
        return { nextReview, interval: state.interval, easeFactor: state.easeFactor };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=education-study-store.js.map