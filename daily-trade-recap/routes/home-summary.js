"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Count the records the production recap actually writes. The tiles counted `workflow_runs` for ticket_type 'daily-trade-recap', but the nightly recap is a host scheduled task that creates no ticket and no workflow run, so every tile read 0 on a good night and a bad one alike - there has never been a single row of that type. Home now reads the two records the pipeline really leaves behind: a trading session in `oshal_trading_daily_equity` (written by the trading schedule, independent of the recap) and the day's published-report row in `oshal_trading_strategy_journal` (written by the recap's own publish step). A recorded recap moves a tile, a session that finished the day with no recap is counted and named as an item, and the ticket path's own `approval_required` backlog - the June tickets the workflow-run states could never see - is counted and listed. A market holiday records no session, so it raises nothing.
 */
/** Saved daily-trade-recap evidence. GET is owner-scoped, bounded, and side-effect free. */
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
// Every window is an Eastern trading day, because that is the unit both records are keyed on.
const ET = "($2::timestamptz AT TIME ZONE 'America/New_York')::date";
// A session is judged only once its day is OVER: the trading schedule records equity during the
// session, hours before the after-close recap runs, so counting today would report every normal
// afternoon as a miss.
const CLOSED = `et_day < ${ET} AND et_day > (${ET} - 7)`;
const REPORT = (a) => `${a}kind='report' AND ${a}source='daily-report'`;
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date();
        const result = await Promise.allSettled([
            `SELECT (SELECT count(DISTINCT et_day)::text FROM oshal_trading_daily_equity WHERE user_sub = $1 AND ${CLOSED}) AS sessions,`
                + ` (SELECT count(DISTINCT et_day)::text FROM oshal_trading_strategy_journal WHERE user_sub = $1 AND ${REPORT('')} AND ${CLOSED}) AS recaps,`
                + ` (SELECT count(*)::text FROM (SELECT DISTINCT et_day FROM oshal_trading_daily_equity WHERE user_sub = $1 AND ${CLOSED}) e`
                + ` WHERE NOT EXISTS (SELECT 1 FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND ${REPORT('j.')} AND j.et_day = e.et_day)) AS missed`,
            "SELECT count(*)::text AS review FROM tickets WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND status='approval_required' AND created_at <= $2",
            `SELECT to_char(e.et_day,'YYYY-MM-DD') AS session_day,`
                + ` (SELECT max(j.created_at) FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND ${REPORT('j.')} AND j.et_day = e.et_day) AS recap_at,`
                + ` (SELECT left(max(j.summary),400) FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND ${REPORT('j.')} AND j.et_day = e.et_day) AS recap_summary`
                + ` FROM (SELECT DISTINCT et_day FROM oshal_trading_daily_equity WHERE user_sub = $1 AND ${CLOSED}) e ORDER BY e.et_day DESC LIMIT 5`,
            "SELECT title, status, created_at FROM tickets WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND status='approval_required' AND created_at <= $2 ORDER BY created_at DESC, ticket_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const cell = (i, key) => result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable';
        const metrics = [[0, "missed", "recaps-missed", "Sessions with no recap / 7 days"], [0, "recaps", "recaps-recorded", "Recaps recorded / 7 days"], [0, "sessions", "trading-sessions", "Trading sessions / 7 days"], [1, "review", "recaps-awaiting-review", "Recaps awaiting review"]].map(([i, key, id, label]) => ({ id, label, value: cell(Number(i), String(key)) }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "recap-review", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(2).forEach(r => r.recap_at
            ? item('Recap recorded for ' + clip(r.session_day, 10), 'recorded ' + date(r.recap_at), clip(r.recap_summary) + ' A recorded report is not proof that an email arrived or a video was published.', ['prepare-document', 'prepare-episode'])
            : item('No recap recorded for ' + clip(r.session_day, 10), 'closed session with no published report', 'The trading schedule recorded this session, and the recap pipeline recorded no published report for it. Re-run scripts/run-daily-recap.ps1 for that date, or check the run log.', ['prepare-document', 'prepare-episode'], 'warn'));
        rows(3).forEach(r => item(r.title || 'Daily trade recap ticket', clip(r.status) + ' since ' + date(r.created_at), 'This recap ticket is parked at its approval gate and nothing downstream of the gate has run. Approving or cancelling it is the only thing that clears it.', ['prepare-document', 'prepare-episode'], 'warn'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "recap-review" });
        else if (!items.length)
            items.push({ text: 'No recorded trading session in the window. Open the app to begin.', tone: 'neutral', fix: "recap-review" });
        items.push({ text: "Counts exact-owner Eastern trading days: sessions recorded by the trading schedule, published reports recorded by the recap pipeline, and recap tickets parked at their approval gate. Today is excluded because the after-close recap has not run yet. A recorded report is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.", tone: 'neutral', fix: "recap-review" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map