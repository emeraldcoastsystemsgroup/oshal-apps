"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.56.0, T6 (Roger: Career search remembers criteria on the account, across devices). Find jobs kept the last search and the named searches only in one browser, so another browser or device started empty. The account now holds them: a small file in the person's own Career folder, beside the search scope, changed one operation at a time under the same rules the browser applies (tools/career-search-memory.js). Guard: tests/career-search-memory-routes.test.mjs.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_MEMORY_FILE = void 0;
exports.registerCareerSearchMemoryRoutes = registerCareerSearchMemoryRoutes;
/**
 * Find jobs' remembered searches, kept on the account.
 * @module career-search-memory-routes
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_file_transaction_1 = require("./career-file-transaction");
// The browser's own rules, so the account and every browser clean and bound a search the same way.
const searchMemory = require('../tools/career-search-memory');
const logger = (0, logger_1.createChildLogger)({ module: 'career-search-memory-routes' });
exports.SEARCH_MEMORY_FILE = 'job-search-memory.json';
/** Twenty named searches of every criterion at its longest stay well under this. */
const MAX_BYTES = 256 * 1024;
const OPERATIONS = new Set(['remember', 'save', 'remove', 'clearLast', 'adopt']);
/** The person's file as the browser module's storage: reads the file, holds a write until it is saved. */
function fileStorage(userDir) {
    const file = userDir ? path_1.default.join(userDir, exports.SEARCH_MEMORY_FILE) : null;
    let pending = null;
    return {
        file,
        getItem() {
            if (pending !== null)
                return pending;
            if (!file)
                return null;
            try {
                const stat = fs_1.default.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
                    return null;
                return fs_1.default.readFileSync(file, 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return null;
                throw error;
            }
        },
        setItem(_key, value) {
            if (value.length > MAX_BYTES)
                throw new Error('too large');
            pending = value;
        },
        pending: () => pending,
    };
}
/** What a caller sees: the last search, the named ones, and whether the account holds a copy at all. */
function answer(memory, stored) {
    const state = memory.state();
    return { last: state.last, saved: state.saved, stored };
}
/** Hand the account a browser's searches from before 1.56.0, oldest named search first so the order is kept. */
function adopt(memory, state) {
    const given = searchMemory.clean(state);
    for (const row of [...given.saved].reverse())
        memory.save(row.name, row.criteria);
    if (given.last)
        memory.remember(given.last);
}
/** Apply one operation to the account's copy; adopt applies only while the account holds none. */
function apply(memory, body, stored) {
    if (body.op === 'adopt') {
        if (stored)
            return false;
        adopt(memory, body.state);
        return true;
    }
    if (body.op === 'remember')
        memory.remember(body.criteria);
    else if (body.op === 'save')
        memory.save(body.name, body.criteria);
    else if (body.op === 'remove')
        memory.remove(String(body.id || ''));
    else
        memory.clearLast();
    return true;
}
async function getMemory(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req), started = Date.now();
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const storage = fileStorage((0, career_user_store_1.findUserPaths)(userSub)?.userDir || null);
        const memory = searchMemory.create(storage, 'account');
        const stored = storage.getItem() !== null;
        logger.info({ userSub, stored, ms: Date.now() - started }, 'career search memory read');
        res.json(answer(memory, stored));
    }
    catch (err) {
        logger.error({ err, userSub }, 'career search memory read failed');
        res.status(500).json({ error: 'read failed' });
    }
}
async function postMemory(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req), started = Date.now(), body = req.body || {};
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!OPERATIONS.has(body.op)) {
        res.status(400).json({ error: 'unknown_operation', message: 'Unknown search memory operation.' });
        return;
    }
    try {
        const { userDir } = (0, career_user_store_1.userPaths)(userSub);
        const storage = fileStorage(userDir);
        const memory = searchMemory.create(storage, 'account');
        const stored = storage.getItem() !== null;
        let changed;
        try {
            changed = apply(memory, body, stored);
        }
        catch (error) {
            res.status(400).json({ error: 'refused', message: error.message });
            return;
        }
        const value = storage.pending();
        if (changed && value !== null) {
            await fs_1.default.promises.mkdir(userDir, { recursive: true, mode: 0o700 });
            await (0, career_file_transaction_1.writeFileAtomicAsync)(storage.file, value);
            await fs_1.default.promises.chmod(storage.file, 0o600);
        }
        logger.info({ userSub, op: body.op, changed, ms: Date.now() - started }, 'career search memory changed');
        res.json(answer(memory, stored || (changed && value !== null)));
    }
    catch (err) {
        logger.error({ err, userSub, op: body.op }, 'career search memory change failed');
        res.status(500).json({ error: 'write failed' });
    }
}
/**
 * @description Registers Find jobs' remembered searches on the account: GET answers the copy the account holds,
 * POST applies one operation (remember, save, remove, clearLast, or adopt a browser's searches when it holds none).
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
function registerCareerSearchMemoryRoutes(router) {
    router.get('/search-memory', getMemory);
    router.post('/search-memory', postMemory);
}
