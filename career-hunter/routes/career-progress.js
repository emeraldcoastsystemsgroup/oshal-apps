"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerProgressRoutes = registerCareerProgressRoutes;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Count the original owner's recorded applications over the past seven days and retain an optional bounded goal without corpus, stage or page filters.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const career_user_store_1 = require("./career-user-store");
const FILE = 'application-goal.json', MAX_BYTES = 1024, DAY = 86400000;
const validGoal = (value) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100);
/** Refuse aliases and non-files before any preference write; an explicit save may replace corrupt JSON. */
async function safeGoalFile(file) {
    try {
        const stat = await fs_1.default.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
            throw Error('Application goal is unavailable.');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
/** Read a bounded regular file without following a link or allocating from its reported size. */
async function readGoal(userDir) {
    const file = path_1.default.join(userDir, FILE);
    await safeGoalFile(file);
    let handle;
    try {
        handle = await fs_1.default.promises.open(file, fs_1.default.constants.O_RDONLY | (fs_1.default.constants.O_NOFOLLOW || 0) | (fs_1.default.constants.O_NONBLOCK || 0));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES)
            throw Error('Application goal is unavailable.');
        const bytes = Buffer.alloc(MAX_BYTES + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > MAX_BYTES)
            throw Error('Application goal is unavailable.');
        const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
        if (value?.version !== 1 || !validGoal(value.goal))
            throw Error('Application goal is unavailable.');
        return value.goal;
    }
    finally {
        await handle.close();
    }
}
/** Replace the owner's small goal file atomically, using an exclusive private temporary file. */
async function writeGoal(userDir, goal) {
    const file = path_1.default.join(userDir, FILE), temporary = path_1.default.join(userDir, '.' + FILE + '.' + (0, crypto_1.randomUUID)() + '.tmp');
    await safeGoalFile(file);
    try {
        const handle = await fs_1.default.promises.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(JSON.stringify({ version: 1, goal }) + '\n');
        }
        finally {
            await handle.close();
        }
        await fs_1.default.promises.rename(temporary, file);
    }
    finally {
        await fs_1.default.promises.rm(temporary, { force: true });
    }
}
/** Read only full original-owner application dates; invalid and future instants cannot count. */
async function getProgress(req, res) {
    const sub = (0, career_user_store_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    let db;
    try {
        const now = new Date(), asOf = now.toISOString(), since = new Date(now.getTime() - 7 * DAY).toISOString(), owner = (0, career_user_store_1.findUserPaths)(sub);
        db = owner ? (0, career_user_store_1.openUserDb)(sub, true, { corpus: false }) : null;
        const applied = db ? Number(db.prepare('SELECT COUNT(*) AS n FROM user_signals WHERE julianday(applied_at)>=julianday(?) AND julianday(applied_at)<=julianday(?)').get(since, asOf).n) : 0;
        const goal = owner ? await readGoal(owner.userDir) : null;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ period: 'past7days', since, asOf, applied, goal });
    }
    catch (_) {
        res.status(503).json({ error: 'Application progress could not be read.' });
    }
    finally {
        db?.close();
    }
}
/** Save only the authenticated owner's explicit goal; no caller-supplied identity or path is accepted. */
async function saveGoal(req, res) {
    const sub = (0, career_user_store_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'goal') || !validGoal(body.goal)) {
        res.status(400).json({ error: 'Choose a whole-number goal from 1 to 100, or turn the goal off.' });
        return;
    }
    try {
        await writeGoal((0, career_user_store_1.userPaths)(sub).userDir, body.goal);
        res.json({ ok: true, goal: body.goal });
    }
    catch (_) {
        res.status(503).json({ error: 'Application goal could not be saved.' });
    }
}
/** @description Register original-owner application progress reads and explicit optional goal changes. @param router Authenticated Career router. @returns Nothing. */
function registerCareerProgressRoutes(router) {
    router.get('/jobs/progress', (req, res) => { void getProgress(req, res); });
    router.post('/jobs/goal', (req, res) => { void saveGoal(req, res); });
}
//# sourceMappingURL=career-progress.js.map