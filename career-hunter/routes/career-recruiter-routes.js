"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped recruiter tracker CRUD routes from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The tracker opens the caller's own database alone (recruiters never read the shared corpus), and the first write creates it with the engine's own per-user schema (engine/jobhunter/db.py USER_SCHEMA). Add recruiter answered 404 {error:'no data'} for anyone who had not ingested a resume, because openUserDb returns null until the corpus AND the per-user database exist. Guard: tests/career-recruiter-first-write.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | UX audit 2026-11-06 (grade F): after a status change every list answered 500 "unable to open database file" (production journal 05:24:25Z-05:24:47Z, principal admin) and the screen showed 0 of 18 firms. The tracker was the one Career reader that opened a person's store plainly read-only: a store whose header still says WAL (the engine writes in WAL and only switches back at exit) cannot create its -shm on the kernel's read pin. Reads now open it the way openUserDb does (immutable when the owner mount holds no pending WAL), and a tracker write leaves the file in rollback-journal mode so the generation it publishes opens anywhere. Guard: tests/career-recruiter-read-after-write.test.mjs.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineUserSchema = engineUserSchema;
exports.readSource = readSource;
exports.leavePortable = leavePortable;
exports.registerCareerRecruiterRoutes = registerCareerRecruiterRoutes;
/**
 * Caller-owned recruiter tracker routes.
 * @module career-recruiter-routes
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-recruiter-routes' });
const RECRUITER_FIELDS = new Set([
    'firm', 'bucket', 'website', 'contact_name', 'contact_role', 'contact_link', 'channel',
    'status', 'date_contacted', 'followup_date', 'next_action', 'notes',
]);
/** The engine module that owns the per-user store schema. */
const ENGINE_DB_MODULE = path_1.default.resolve(__dirname, '..', 'engine', 'jobhunter', 'db.py');
/**
 * @description The engine's own per-user schema text, so a store created here is the store the
 * engine creates (every statement is CREATE ... IF NOT EXISTS, so a later ingest completes nothing
 * twice). Read from the engine module rather than restated, so the two can never drift.
 * @param file - The engine module to read.
 * @returns The USER_SCHEMA script.
 */
function engineUserSchema(file = ENGINE_DB_MODULE) {
    const match = /\nUSER_SCHEMA = """([\s\S]*?)"""/.exec(fs_1.default.readFileSync(file, 'utf8'));
    if (!match || !/CREATE TABLE IF NOT EXISTS recruiter_firms/.test(match[1])) {
        throw new Error('the engine per-user schema is unavailable');
    }
    return match[1];
}
/**
 * @description Open the caller's own store database for the recruiter tracker. Recruiters live only
 * there and never read the shared corpus, so the corpus is not attached and need not exist. A write
 * creates the database with the engine's schema the first time; a read of a missing one is null.
 * @param userSub - The caller.
 * @param write - Whether this request writes.
 * @returns An open handle, or null for a read before anything was saved.
 */
function openRecruiterDb(userSub, write) {
    const { userDb, userDir } = (0, career_user_store_1.userPaths)(userSub);
    if (fs_1.default.existsSync(userDb))
        return write ? new better_sqlite3_1.default(userDb) : new better_sqlite3_1.default(readSource(userDb), { readonly: true });
    if (!write)
        return null;
    fs_1.default.mkdirSync(userDir, { recursive: true });
    const created = new better_sqlite3_1.default(userDb);
    try {
        created.exec(engineUserSchema());
    }
    catch (err) {
        created.close();
        fs_1.default.rmSync(userDb, { force: true });
        throw err;
    }
    logger.info({ userSub }, 'career user store created by its first recruiter write');
    return created;
}
/**
 * @description Where a read opens the store. The kernel pins a published generation for a read; a
 * file still marked WAL with nothing pending cannot create its -shm there ("unable to open database
 * file"), so it opens immutable, exactly as openUserDb does. A pending WAL is never bypassed.
 * @param userDb - The caller's store file.
 * @returns A filename or file: URI for a read-only open.
 */
function readSource(userDb) {
    const wal = `${userDb}-wal`;
    const pending = fs_1.default.existsSync(wal) && fs_1.default.lstatSync(wal).size > 0;
    if (process.env.OSHAL_CAREER_OWNER_MOUNT !== '1' || pending)
        return userDb;
    return `${(0, url_1.pathToFileURL)(userDb).href}?immutable=1`;
}
/**
 * @description Leave a store this request wrote in rollback-journal mode, as the engine leaves it at
 * exit, so the generation the kernel publishes from it opens for any reader. A refusal is harmless:
 * the next writer finds the file as it was, and reads still open it immutable.
 * @param db - The open write handle.
 * @returns Nothing.
 */
function leavePortable(db) {
    try {
        const mode = db.prepare('PRAGMA journal_mode').get();
        if (String(mode?.journal_mode || '').toLowerCase() === 'wal')
            db.exec('PRAGMA journal_mode = DELETE');
    }
    catch (err) {
        logger.warn({ err }, 'recruiter store journal mode kept');
    }
}
function listRecruiters(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = openRecruiterDb(userSub, false);
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
    let db;
    try {
        db = openRecruiterDb(userSub, true);
    }
    catch (err) {
        logger.error({ err, userSub }, 'career recruiter store could not be opened');
        res.status(500).json({ error: 'your Career store could not be opened' });
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
        leavePortable(db);
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
    const { userDb } = (0, career_user_store_1.userPaths)(userSub);
    if (!fs_1.default.existsSync(userDb)) {
        res.status(404).json({ error: 'no recruiter saved yet' });
        return;
    }
    const db = openRecruiterDb(userSub, true);
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
        leavePortable(db);
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
    const { userDb } = (0, career_user_store_1.userPaths)(userSub);
    if (!fs_1.default.existsSync(userDb)) {
        res.status(404).json({ error: 'no recruiter saved yet' });
        return;
    }
    const db = openRecruiterDb(userSub, true);
    try {
        const info = db.prepare('DELETE FROM recruiter_firms WHERE id=?').run(id);
        res.json({ ok: info.changes > 0 });
    }
    catch (err) {
        logger.error({ err, userSub, id }, 'career recruiter delete failed');
        res.status(500).json({ error: 'delete failed' });
    }
    finally {
        leavePortable(db);
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