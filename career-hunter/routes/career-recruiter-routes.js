"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped recruiter tracker CRUD routes from the route composition root.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerRecruiterRoutes = registerCareerRecruiterRoutes;
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-recruiter-routes' });
const RECRUITER_FIELDS = new Set([
    'firm', 'bucket', 'website', 'contact_name', 'contact_role', 'contact_link', 'channel',
    'status', 'date_contacted', 'followup_date', 'next_action', 'notes',
]);
function listRecruiters(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ recruiters: [], buckets: [], byStatus: [], empty: true });
        return;
    }
    try {
        const where = [];
        const args = [];
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
        const bucket = typeof req.query.bucket === 'string' ? req.query.bucket.trim() : '';
        if (status) {
            where.push('status = ?');
            args.push(status);
        }
        if (bucket) {
            where.push('bucket = ?');
            args.push(bucket);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const recruiters = db.prepare(`SELECT * FROM recruiter_firms ${whereSql} ORDER BY sort_order, firm`).all(...args);
        const buckets = db.prepare("SELECT DISTINCT bucket FROM recruiter_firms WHERE bucket IS NOT NULL AND bucket<>'' ORDER BY bucket").all().map((row) => row.bucket);
        const byStatus = db.prepare("SELECT COALESCE(NULLIF(status,''),'(none)') AS status, COUNT(*) AS n " +
            "FROM recruiter_firms GROUP BY COALESCE(NULLIF(status,''),'(none)') ORDER BY n DESC").all();
        res.json({ recruiters, buckets, byStatus });
    }
    catch (err) {
        logger.error({ err, userSub }, 'career recruiters list failed');
        res.status(500).json({ error: 'read failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'recruiter database close failed');
        }
    }
}
function addRecruiter(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const firm = String(req.body?.firm || '').trim();
    if (!firm) {
        res.status(400).json({ error: 'firm required' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        const info = db.prepare(`INSERT INTO recruiter_firms
         (firm, bucket, website, contact_name, contact_link, status, sort_order, updated_at)
       VALUES (?,?,?,?,?,?,
         (SELECT COALESCE(MAX(sort_order),0)+1 FROM recruiter_firms), datetime('now'))`).run(firm, String(req.body?.bucket || 'Other').trim(), String(req.body?.website || '').trim(), String(req.body?.contact_name || '').trim(), String(req.body?.contact_link || '').trim(), String(req.body?.status || 'To contact').trim());
        res.status(201).json({ ok: true, id: info.lastInsertRowid });
    }
    catch (err) {
        logger.error({ err, userSub }, 'career recruiter add failed');
        res.status(500).json({ error: 'add failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'recruiter database close failed');
        }
    }
}
function updateRecruiter(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const updates = Object.entries(req.body || {}).filter(([key]) => RECRUITER_FIELDS.has(key));
    if (!updates.length) {
        res.status(400).json({ error: 'no valid fields' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        const setSql = `${updates.map(([key]) => `${key}=?`).join(', ')}, updated_at=datetime('now')`;
        const values = updates.map(([, value]) => (value == null ? null : String(value)));
        const info = db.prepare(`UPDATE recruiter_firms SET ${setSql} WHERE id=?`).run(...values, id);
        res.json({ ok: info.changes > 0 });
    }
    catch (err) {
        logger.error({ err, userSub, id }, 'career recruiter update failed');
        res.status(500).json({ error: 'update failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'recruiter database close failed');
        }
    }
}
function deleteRecruiter(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        const info = db.prepare('DELETE FROM recruiter_firms WHERE id=?').run(id);
        res.json({ ok: info.changes > 0 });
    }
    catch (err) {
        logger.error({ err, userSub, id }, 'career recruiter delete failed');
        res.status(500).json({ error: 'delete failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'recruiter database close failed');
        }
    }
}
/**
 * @description Registers caller-owned recruiter tracker CRUD routes.
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
function registerCareerRecruiterRoutes(router) {
    router.get('/recruiters', listRecruiters);
    router.post('/recruiters', addRecruiter);
    router.post('/recruiters/:id', updateRecruiter);
    router.delete('/recruiters/:id', deleteRecruiter);
}
//# sourceMappingURL=career-recruiter-routes.js.map