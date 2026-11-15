"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Goals, mounted at /api/finance/goals (Roger, 2026-11-12: Finance as a person's money day). A person names what they are saving for or paying down, with a target and a date when they have them and what they plan to set aside each month; "Set aside" records an amount against the goal and "Take back" takes some out again. Both are bookkeeping in Finance and the answer says so: no money moves, no transfer is asked of any bank. Progress is worked out from the amounts set aside, never stored, so it cannot drift from them. A goal's saved amount, its target and its plan each leave as a figure with its source and date; a goal with no target has no target figure and no percentage, never a zero. Nothing can be set aside or undone in a closed month. The GET only reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): a closed goal can be deleted with confirm: true (POST /:goalId/delete), with every amount recorded against it; an open goal is refused (close it first), and so is one with an amount in a closed month. Nothing moves: the goal was bookkeeping only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOALS_SQL = exports.SET_ASIDE_NOTE = exports.GOAL_KINDS = void 0;
exports.listGoals = listGoals;
exports.needGoal = needGoal;
exports.insertGoal = insertGoal;
exports.saveGoal = saveGoal;
exports.listMoves = listMoves;
exports.insertMove = insertMove;
exports.goalProgress = goalProgress;
exports.goalsWithProgress = goalsWithProgress;
exports.addGoal = addGoal;
exports.recordMove = recordMove;
exports.undoMove = undoMove;
exports.deleteGoal = deleteGoal;
exports.createFinanceGoalsRoutes = createFinanceGoalsRoutes;
/**
 * @module finance-goals
 */
const express_1 = require("express");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_day_model_1 = require("./finance-day-model");
const finance_day_kit_1 = require("./finance-day-kit");
/** What a goal can be. */
exports.GOAL_KINDS = Object.freeze(['save-up', 'pay-down', 'allowance']);
/** What every answer that records a set-aside says: it is bookkeeping. */
exports.SET_ASIDE_NOTE = 'Recorded in Finance. No money moved.';
/** What a goal's own amounts are called on a source line. */
const KEPT_IN_FINANCE = 'Set aside in Finance';
const GOAL_COLUMNS = 'goal_id, user_sub, book_id, name, kind, target_cents, target_date, monthly_cents, currency, account_id, sort_order, source, source_label, posture, state, created_at, updated_at';
const MOVE_COLUMNS = 'move_id, user_sub, book_id, goal_id, month, move_date, amount_cents, direction, currency, note, income_txn_id, source, source_label, posture, created_at';
/** Every statement this module issues. The selective text equality comes first in each WHERE. */
exports.GOALS_SQL = Object.freeze({
    goalsByBook: `SELECT ${GOAL_COLUMNS} FROM finance_goals WHERE book_id = $1 AND user_sub = $2`,
    goalRead: `SELECT ${GOAL_COLUMNS} FROM finance_goals WHERE goal_id = $1 AND user_sub = $2`,
    goalInsert: `INSERT INTO finance_goals (${GOAL_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    goalUpdate: 'UPDATE finance_goals SET name = $3, kind = $4, target_cents = $5, target_date = $6, monthly_cents = $7, account_id = $8, sort_order = $9, state = $10, updated_at = $11 WHERE goal_id = $1 AND user_sub = $2',
    movesByBook: `SELECT ${MOVE_COLUMNS} FROM finance_goal_moves WHERE book_id = $1 AND user_sub = $2`,
    moveRead: `SELECT ${MOVE_COLUMNS} FROM finance_goal_moves WHERE move_id = $1 AND user_sub = $2`,
    moveInsert: `INSERT INTO finance_goal_moves (${MOVE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    moveDelete: 'DELETE FROM finance_goal_moves WHERE move_id = $1 AND user_sub = $2',
    goalDelete: 'DELETE FROM finance_goals WHERE goal_id = $1 AND user_sub = $2',
});
/* ─── rows ──────────────────────────────────────────────────────────────────── */
/** A stored goal row as the record the modules use. */
function goalOf(row) {
    return {
        goalId: row.goal_id, bookId: row.book_id, name: row.name, kind: row.kind, targetCents: (0, finance_day_kit_1.wholeOrNull)(row.target_cents),
        targetDate: row.target_date || null, monthlyCents: (0, finance_day_kit_1.wholeOrNull)(row.monthly_cents), currency: row.currency || 'USD',
        accountId: row.account_id || '', sortOrder: Number(row.sort_order) || 0, source: row.source, sourceLabel: row.source_label || '',
        posture: row.posture || '', state: row.state || 'open', createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/** A stored move row as the record the modules use. */
function moveOf(row) {
    return {
        moveId: row.move_id, bookId: row.book_id, goalId: row.goal_id, month: row.month, date: row.move_date, amountCents: (0, finance_day_kit_1.whole)(row.amount_cents),
        direction: row.direction === 'out' ? 'out' : 'in', currency: row.currency || 'USD', note: row.note || '', incomeTxnId: row.income_txn_id || '',
        source: row.source, sourceLabel: row.source_label || '', posture: row.posture || '', createdAt: row.created_at,
    };
}
/* ─── the store ─────────────────────────────────────────────────────────────── */
/**
 * @description The goals in one of the caller's sets of records, in the order the person keeps them.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The goals.
 */
async function listGoals(db, sub, bookId) {
    const rows = (await db.query(exports.GOALS_SQL.goalsByBook, [bookId, sub])).rows;
    return rows.map(goalOf).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.goalId.localeCompare(b.goalId));
}
/**
 * @description One of the caller's goals, or a refusal in words.
 * @param db - The pool.
 * @param sub - The caller.
 * @param goalId - The goal.
 * @returns The goal.
 */
async function needGoal(db, sub, goalId) {
    const row = (await db.query(exports.GOALS_SQL.goalRead, [goalId, sub])).rows[0];
    if (!row)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_goal', 'That goal is not in your records.');
    return goalOf(row);
}
/**
 * @description Keep a new goal. A second goal with the same id is left as it is.
 * @param db - The pool.
 * @param sub - The caller.
 * @param g - The goal.
 * @returns True when it was added.
 */
async function insertGoal(db, sub, g) {
    try {
        await db.query(exports.GOALS_SQL.goalInsert, [g.goalId, sub, g.bookId, g.name, g.kind, g.targetCents, g.targetDate, g.monthlyCents, g.currency,
            g.accountId, g.sortOrder, g.source, g.sourceLabel, g.posture, g.state, g.createdAt, g.updatedAt]);
        return true;
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        return false;
    }
}
/**
 * @description Keep a goal's present values.
 * @param db - The pool.
 * @param sub - The caller.
 * @param g - The goal with its new values.
 * @returns Nothing.
 */
async function saveGoal(db, sub, g) {
    await db.query(exports.GOALS_SQL.goalUpdate, [g.goalId, sub, g.name, g.kind, g.targetCents, g.targetDate, g.monthlyCents, g.accountId, g.sortOrder, g.state, (0, finance_ledger_store_1.nowStamp)()]);
}
/**
 * @description Every amount set aside or taken back in a set of records, oldest first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The moves.
 */
async function listMoves(db, sub, bookId) {
    const rows = (await db.query(exports.GOALS_SQL.movesByBook, [bookId, sub])).rows;
    return rows.map(moveOf).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.moveId.localeCompare(b.moveId));
}
/**
 * @description Keep one amount set aside or taken back. A second move with the same id is a skip,
 * so a request sent twice records once.
 * @param db - The pool.
 * @param sub - The caller.
 * @param m - The move.
 * @returns True when it was added.
 */
async function insertMove(db, sub, m) {
    try {
        await db.query(exports.GOALS_SQL.moveInsert, [m.moveId, sub, m.bookId, m.goalId, m.month, m.date, m.amountCents, m.direction, m.currency, m.note,
            m.incomeTxnId, m.source, m.sourceLabel, m.posture, m.createdAt]);
        return true;
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        return false;
    }
}
/* ─── progress ──────────────────────────────────────────────────────────────── */
/** What a goal holds after some moves. */
function held(moves) {
    return moves.reduce((sum, move) => sum + (move.direction === 'in' ? move.amountCents : -move.amountCents), 0);
}
/** A goal's own bookkeeping as a figure: what Finance holds for it, true on the given day. */
function keptFigure(goal, cents, asOf) {
    return (0, finance_ledger_store_1.figure)(cents, goal.currency, goal.posture === 'sample' ? goal.sourceLabel || 'Sample data' : KEPT_IN_FINANCE, goal.source, asOf, goal.posture);
}
/** What the person planned for a goal as a figure, dated the day they last set it. */
function plannedFigure(goal, cents) {
    return (0, finance_day_model_1.forward)((0, finance_ledger_store_1.figure)(cents, goal.currency, goal.sourceLabel || 'Typed by you', goal.source, goal.updatedAt.slice(0, 10), goal.posture), 'planned');
}
/**
 * @description A goal's progress, worked out from the amounts set aside for it.
 * @param goal - The goal.
 * @param moves - Every move in the set of records (others' are ignored).
 * @param today - YYYY-MM-DD.
 * @returns The goal with what is saved, what is planned and what is left, each a figure.
 */
function goalProgress(goal, moves, today) {
    const mine = moves.filter((move) => move.goalId === goal.goalId), thisMonth = mine.filter((move) => move.month === (0, finance_ledger_store_1.monthOf)(today));
    const saved = held(mine), monthSaved = held(thisMonth);
    const lastMove = mine.length ? mine[mine.length - 1].date : goal.createdAt.slice(0, 10);
    const leftToTarget = goal.targetCents === null ? null : Math.max(0, goal.targetCents - saved);
    const leftThisMonth = goal.monthlyCents === null ? null : Math.max(0, goal.monthlyCents - monthSaved);
    return {
        goalId: goal.goalId, name: goal.name, kind: goal.kind, state: goal.state, accountId: goal.accountId, targetDate: goal.targetDate,
        percent: goal.targetCents ? Math.min(100, Math.floor((saved / goal.targetCents) * 100)) : null,
        done: goal.targetCents !== null && goal.targetCents > 0 && saved >= goal.targetCents,
        saved: keptFigure(goal, saved, lastMove), target: goal.targetCents === null ? null : plannedFigure(goal, goal.targetCents),
        monthly: goal.monthlyCents === null ? null : plannedFigure(goal, goal.monthlyCents),
        setAsideThisMonth: keptFigure(goal, monthSaved, today),
        leftThisMonth: leftThisMonth === null ? null : plannedFigure(goal, leftThisMonth),
        leftToTarget: leftToTarget === null ? null : plannedFigure(goal, leftToTarget),
        answeredIncome: mine.map((move) => move.incomeTxnId).filter(Boolean),
        moves: mine.map((move) => ({ moveId: move.moveId, date: move.date, direction: move.direction, note: move.note, amount: keptFigure(goal, move.amountCents, move.date) })),
    };
}
/**
 * @description Every goal in a set of records with its progress. Closed goals come last.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @returns The goals.
 */
async function goalsWithProgress(db, sub, bookId, today) {
    const [goals, moves] = [await listGoals(db, sub, bookId), await listMoves(db, sub, bookId)];
    return goals.map((goal) => goalProgress(goal, moves, today)).sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open'));
}
/* ─── writes ────────────────────────────────────────────────────────────────── */
/** The values a request may set on a goal, checked. */
function goalValues(body, base) {
    const kind = body.kind === undefined ? base.kind : String(body.kind);
    if (!exports.GOAL_KINDS.includes(kind))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_kind', 'A goal is for saving up, paying down or an allowance.');
    const state = body.state === undefined ? base.state : String(body.state);
    if (!['open', 'closed'].includes(state))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_state', 'A goal is open or closed.');
    return {
        ...base, kind, state,
        name: body.name === undefined ? base.name : (0, finance_day_kit_1.nameOf)(body.name, 'Give the goal a name.'),
        targetCents: body.targetCents === undefined ? base.targetCents : (0, finance_day_kit_1.centsOf)(body.targetCents, 'The target'),
        targetDate: body.targetDate === undefined ? base.targetDate : (0, finance_day_kit_1.dateOf)(body.targetDate, 'The target date'),
        monthlyCents: body.monthlyCents === undefined ? base.monthlyCents : (0, finance_day_kit_1.centsOf)(body.monthlyCents, 'The amount each month'),
        accountId: body.accountId === undefined ? base.accountId : (0, finance_ledger_store_1.cleanText)(body.accountId, 80),
        sortOrder: body.sortOrder === undefined ? base.sortOrder : Math.max(0, Math.floor(Number(body.sortOrder) || 0)),
    };
}
/**
 * @description Add a goal a person named.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param body - name, and optionally kind, targetCents, targetDate, monthlyCents, accountId, requestId.
 * @returns The goal.
 */
async function addGoal(db, sub, bookId, body) {
    const now = (0, finance_ledger_store_1.nowStamp)(), existing = await listGoals(db, sub, bookId);
    const blank = {
        goalId: typeof body.requestId === 'string' && body.requestId ? (0, finance_ledger_store_1.hashId)('goal', sub, 'request', body.requestId) : (0, finance_ledger_store_1.newId)('goal'), bookId,
        name: (0, finance_day_kit_1.nameOf)(body.name, 'Give the goal a name.'), kind: 'save-up', targetCents: null, targetDate: null, monthlyCents: null, currency: 'USD',
        accountId: '', sortOrder: existing.length, source: 'typed', sourceLabel: 'Typed by you', posture: 'typed', state: 'open', createdAt: now, updatedAt: now,
    };
    const goal = goalValues(body, blank);
    await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId);
    await insertGoal(db, sub, goal);
    return needGoal(db, sub, goal.goalId);
}
/**
 * @description Record an amount set aside for a goal, or taken back out of it. Bookkeeping only.
 * @param db - The pool.
 * @param sub - The caller.
 * @param goal - The goal.
 * @param direction - 'in' to set aside, 'out' to take back.
 * @param body - amountCents, and optionally date, note, incomeTxnId, requestId.
 * @param today - YYYY-MM-DD.
 * @returns The move as recorded.
 */
async function recordMove(db, sub, goal, direction, body, today) {
    if (goal.state !== 'open')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'goal_closed', 'This goal is closed. Open it again to change what it holds.');
    const amountCents = (0, finance_day_kit_1.neededCents)(body.amountCents, 'The amount'), date = (0, finance_day_kit_1.dateOf)(body.date, 'The date') || today;
    if (date > today)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_date', 'The date must be today or earlier.');
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.readBook)(db, sub, goal.bookId), (0, finance_ledger_store_1.monthOf)(date));
    if (direction === 'out' && amountCents > held((await listMoves(db, sub, goal.bookId)).filter((move) => move.goalId === goal.goalId))) {
        throw new finance_ledger_store_1.LedgerRefusal(409, 'more_than_held', 'That is more than this goal holds.');
    }
    const move = {
        moveId: typeof body.requestId === 'string' && body.requestId ? (0, finance_ledger_store_1.hashId)('move', sub, 'request', body.requestId) : (0, finance_ledger_store_1.newId)('move'),
        bookId: goal.bookId, goalId: goal.goalId, month: (0, finance_ledger_store_1.monthOf)(date), date, amountCents, direction, currency: goal.currency,
        note: (0, finance_ledger_store_1.cleanText)(body.note), incomeTxnId: direction === 'in' ? (0, finance_ledger_store_1.cleanText)(body.incomeTxnId, 80) : '',
        source: goal.source, sourceLabel: goal.sourceLabel, posture: goal.posture, createdAt: (0, finance_ledger_store_1.nowStamp)(),
    };
    await insertMove(db, sub, move);
    return move;
}
/**
 * @description Take one recorded move back out, as if it had not been made.
 * @param db - The pool.
 * @param sub - The caller.
 * @param moveId - The move.
 * @returns The goal it belonged to.
 */
async function undoMove(db, sub, moveId) {
    const row = (await db.query(exports.GOALS_SQL.moveRead, [moveId, sub])).rows[0];
    if (!row)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_move', 'That entry is not in your records.');
    const move = moveOf(row), goal = await needGoal(db, sub, move.goalId);
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.readBook)(db, sub, move.bookId), move.month);
    const rest = (await listMoves(db, sub, move.bookId)).filter((other) => other.goalId === move.goalId && other.moveId !== move.moveId);
    if (held(rest) < 0)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'more_than_held', 'Undoing this would leave the goal holding less than was taken back from it.');
    await db.query(exports.GOALS_SQL.moveDelete, [moveId, sub]);
    return goal;
}
/**
 * @description Delete a closed goal and every amount recorded against it. Bookkeeping only: no money moves.
 * @param db - The pool.
 * @param sub - The caller.
 * @param goal - The goal; it must be closed.
 * @returns How many recorded amounts were removed with it.
 */
async function deleteGoal(db, sub, goal) {
    if (goal.state !== 'closed')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'goal_open', 'Only a closed goal can be deleted. Close it first.');
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, goal.bookId), moves = (await listMoves(db, sub, goal.bookId)).filter((move) => move.goalId === goal.goalId);
    for (const move of moves)
        (0, finance_ledger_store_1.assertMonthOpen)(book, move.month);
    for (const move of moves)
        await db.query(exports.GOALS_SQL.moveDelete, [move.moveId, sub]);
    await db.query(exports.GOALS_SQL.goalDelete, [goal.goalId, sub]);
    return moves.length;
}
/* ─── the routes ────────────────────────────────────────────────────────────── */
/**
 * @description The goals routes, mounted at /api/finance/goals.
 * @param ctx - The application context (its pool).
 * @returns The router.
 */
function createFinanceGoalsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    const one = async (sub, goalId, today) => {
        const goal = await needGoal(db, sub, goalId);
        return goalProgress(goal, await listMoves(db, sub, goal.bookId), today);
    };
    /** GET / — every goal with what is saved, what is planned and what is left. */
    router.get('/', (0, finance_day_kit_1.route)('goals', async (sub, req) => {
        const bookId = (0, finance_day_kit_1.bookOf)(req), today = (0, finance_day_kit_1.dayOf)(req);
        return { book: bookId, asOf: today, goals: await goalsWithProgress(db, sub, bookId, today), note: exports.SET_ASIDE_NOTE };
    }));
    /** POST / — add a goal. */
    router.post('/', (0, finance_day_kit_1.route)('goals.add', async (sub, req) => {
        const goal = await addGoal(db, sub, (0, finance_day_kit_1.bookOf)(req), (0, finance_day_kit_1.bodyOf)(req));
        return { ok: true, goal: await one(sub, goal.goalId, (0, finance_day_kit_1.dayOf)(req)) };
    }));
    /** POST /moves/:moveId/undo — take one recorded set-aside or take-back out again. */
    router.post('/moves/:moveId/undo', (0, finance_day_kit_1.route)('goals.undo', async (sub, req) => {
        const goal = await undoMove(db, sub, String(req.params.moveId));
        return { ok: true, goal: await one(sub, goal.goalId, (0, finance_day_kit_1.dayOf)(req)), note: exports.SET_ASIDE_NOTE };
    }));
    /** POST /:goalId/set-aside — record an amount set aside. No money moves. */
    router.post('/:goalId/set-aside', (0, finance_day_kit_1.route)('goals.set-aside', async (sub, req) => {
        const goal = await needGoal(db, sub, String(req.params.goalId)), today = (0, finance_day_kit_1.dayOf)(req);
        const move = await recordMove(db, sub, goal, 'in', (0, finance_day_kit_1.bodyOf)(req), today);
        return { ok: true, moveId: move.moveId, goal: await one(sub, goal.goalId, today), note: exports.SET_ASIDE_NOTE };
    }));
    /** POST /:goalId/take-back — record an amount taken back out. No money moves. */
    router.post('/:goalId/take-back', (0, finance_day_kit_1.route)('goals.take-back', async (sub, req) => {
        const goal = await needGoal(db, sub, String(req.params.goalId)), today = (0, finance_day_kit_1.dayOf)(req);
        const move = await recordMove(db, sub, goal, 'out', (0, finance_day_kit_1.bodyOf)(req), today);
        return { ok: true, moveId: move.moveId, goal: await one(sub, goal.goalId, today), note: exports.SET_ASIDE_NOTE };
    }));
    /** POST /:goalId/delete — delete a closed goal with what was recorded against it (confirm: true). */
    router.post('/:goalId/delete', (0, finance_day_kit_1.route)('goals.delete', async (sub, req) => {
        const goal = await needGoal(db, sub, String(req.params.goalId));
        (0, finance_day_kit_1.requireConfirm)((0, finance_day_kit_1.bodyOf)(req), 'Deleting this goal');
        const removed = await deleteGoal(db, sub, goal);
        return { ok: true, goalId: goal.goalId, deleted: true, amountsRemoved: removed, note: exports.SET_ASIDE_NOTE };
    }));
    /** POST /:goalId — change a goal's name, target, date, monthly amount, or close and reopen it. */
    router.post('/:goalId', (0, finance_day_kit_1.route)('goals.change', async (sub, req) => {
        const goal = goalValues((0, finance_day_kit_1.bodyOf)(req), await needGoal(db, sub, String(req.params.goalId)));
        await saveGoal(db, sub, goal);
        return { ok: true, goal: await one(sub, goal.goalId, (0, finance_day_kit_1.dayOf)(req)) };
    }));
    return router;
}
//# sourceMappingURL=finance-goals.js.map