"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.careerTenant = careerTenant;
exports.userStoreSegment = userStoreSegment;
exports.userPaths = userPaths;
exports.openUserDb = openUserDb;
exports.listStoreUsers = listStoreUsers;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extract caller identity and per-user Career store access into a dependency leaf so route modules do not import the route registrar.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Encode unsafe OIDC subjects with the shared CLI path mapper and assert every resolved user path remains inside its tenant root.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Share signed raw-directory aliases and legacy database compatibility across request and cron access paths.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Isolate ambiguous or corrupt store entries so one bad identity marker cannot suppress every cron user.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Describe signed unsafe raw stores accurately as in-place compatibility aliases.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Migrate per-user application provenance before reads and conservatively classify only contained regular confirmation files as verified.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Reject confirmation evidence reached through a symlinked path component before historical rows can be classified as verified submissions.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Keep unauthenticated historical notes unverified; only contained confirmation evidence can strengthen a legacy applied record.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Ensure route-opened user stores also carry the durable Apply run id and exact claim token.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | callerSub now resolves the verified trusted-service identity ahead of the OIDC session (eats/spotify tool idiom): the framework tool-executor's api-type tools call these routes with X-Service-Secret + the signed-in user's sub, and the OIDC-only read returned null for exactly those calls — which is why no career tool could ever reach the resume rails. The mount is already service-or-oidc; the kernel helper verifies the secret before trusting the header.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const caller_sub_1 = require("@/app/routes/caller-sub");
const storePath = require('../lib/user-store-path');
const logger = (0, logger_1.createChildLogger)({ module: 'career-user-store' });
const TENANT = 'default';
const migratedProvenanceDbs = new Set();
const PROVENANCE_COLUMNS = {
    confirmation_path: 'TEXT',
    application_source: 'TEXT',
    application_task_id: 'TEXT',
    apply_run_id: 'TEXT',
    apply_claim_token: 'TEXT',
};
/** Resolve per call so runner tests and boot configuration observe the same environment value. */
function careerStoreRoot() {
    return process.env.JOBHUNTER_STORE_ROOT
        || path_1.default.resolve(process.cwd(), 'apps', 'career-hunter', 'data');
}
/**
 * @description The caller identity every Career route resolves — trusted-service identity
 * FIRST, then the OIDC session. The trusted-service half is what lets the framework
 * tool-executor's api-type tools (career_resume_save) call these routes on the signed-in
 * user's behalf: the executor sends X-Service-Secret plus the user's sub, and the kernel's
 * getTrustedServiceUserSub verifies the secret before trusting the header (fail-closed) —
 * the same idiom the eats/spotify tool-backed routes use. The mount is already
 * `service-or-oidc` (ADR-085 D2), so the middleware admits both caller classes.
 * @param req - Express request carrying either a verified service identity or an OIDC session.
 * @returns The authenticated caller subject, or null when neither identity is present.
 */
function callerSub(req) {
    const trusted = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trusted)
        return trusted;
    return (0, caller_sub_1.callerSub)(req);
}
/**
 * @description Returns the Career store tenant used consistently by filesystem and SQL scopes.
 * @returns The current Career tenant identifier.
 */
function careerTenant() {
    return TENANT;
}
/**
 * @description Converts the raw OIDC subject to the same canonical path segment used by the
 * package CLI, preserving portable lowercase legacy segments and encoding every unsafe value.
 * @param userSub - Raw authenticated OIDC subject retained for token brokerage and database RLS.
 * @returns A traversal-safe, collision-resistant filesystem segment.
 */
function userStoreSegment(userSub) {
    return storePath.userStoreSegment(userSub);
}
/**
 * @description Resolves the shared corpus and caller-isolated database paths from one store root.
 * @param userSub - Authenticated caller subject that owns the per-user Career store.
 * @returns Absolute paths for the tenant corpus and the caller's isolated store.
 */
function userPaths(userSub) {
    const { tenantDir, userDir, userDb } = storePath.resolveUserStoreLayout(careerStoreRoot(), TENANT, userSub);
    return {
        userDir,
        corpusDb: storePath.resolveContainedPath(tenantDir, 'corpus.db'),
        userDb,
    };
}
/**
 * @description Opens a caller's signals database with the shared corpus attached. The tuned cache
 * avoids repeatedly reading the multi-gigabyte corpus indexes while preserving per-request handles
 * so nightly corpus replacement cannot leave a pooled connection on a stale inode.
 * @param userSub - Authenticated caller subject that owns the signals database.
 * @param readonly - Whether SQLite must reject writes through this handle.
 * @returns An attached SQLite handle, or null until both store databases have been seeded.
 */
function openUserDb(userSub, readonly = true) {
    const { corpusDb, userDb, userDir } = userPaths(userSub);
    if (!fs_1.default.existsSync(corpusDb) || !fs_1.default.existsSync(userDb))
        return null;
    migrateApplicationProvenance(userDb, userDir);
    const db = new better_sqlite3_1.default(userDb, { readonly });
    db.exec(`ATTACH DATABASE '${corpusDb.replace(/'/g, "''")}' AS corpus`);
    tuneDatabase(db);
    return db;
}
/** Return true when a path is a strict descendant of the supplied root. */
function isContained(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    return !!relative && relative !== '..' && !relative.startsWith(`..${path_1.default.sep}`)
        && !path_1.default.isAbsolute(relative);
}
/** Reject a candidate when any descendant component is a symbolic link. */
function hasLinkedComponent(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    let current = root;
    for (const segment of relative.split(path_1.default.sep)) {
        current = path_1.default.join(current, segment);
        if (fs_1.default.lstatSync(current).isSymbolicLink())
            return true;
    }
    return false;
}
/** Return true only for a link-free historical confirmation file inside this user's store. */
function hasContainedConfirmation(userDir, candidate) {
    if (typeof candidate !== 'string' || !candidate)
        return false;
    try {
        const lexicalRoot = path_1.default.resolve(userDir);
        const lexicalCandidate = path_1.default.resolve(lexicalRoot, candidate);
        if (!isContained(lexicalRoot, lexicalCandidate)
            || hasLinkedComponent(lexicalRoot, lexicalCandidate))
            return false;
        const realRoot = fs_1.default.realpathSync.native(lexicalRoot);
        const realCandidate = fs_1.default.realpathSync.native(lexicalCandidate);
        return isContained(realRoot, realCandidate) && fs_1.default.statSync(realCandidate).isFile();
    }
    catch {
        return false;
    }
}
/** Classify one old applied row without treating an unresolvable machine-local path as proof. */
function historicalApplicationSource(userDir, row) {
    if (hasContainedConfirmation(userDir, row.confirmation_path))
        return 'verified-submission';
    return 'unverified';
}
/** Add provenance columns and backfill old applied rows once per database in this process. */
function migrateApplicationProvenance(userDb, userDir) {
    if (migratedProvenanceDbs.has(userDb))
        return;
    const db = new better_sqlite3_1.default(userDb);
    try {
        db.pragma('busy_timeout=120000');
        let columns = new Set(db.prepare('PRAGMA table_info(user_signals)').all()
            .map((row) => row.name));
        for (const [name, declaration] of Object.entries(PROVENANCE_COLUMNS)) {
            if (columns.has(name))
                continue;
            try {
                db.exec(`ALTER TABLE user_signals ADD COLUMN ${name} ${declaration}`);
            }
            catch (error) {
                columns = new Set(db.prepare('PRAGMA table_info(user_signals)').all()
                    .map((row) => row.name));
                if (!columns.has(name))
                    throw error;
            }
        }
        const rows = db.prepare(`SELECT posting_id, confirmation_path, notes FROM user_signals
      WHERE status='applied' AND application_source IS NULL`).all();
        const update = db.prepare('UPDATE user_signals SET application_source=? WHERE posting_id=?');
        db.transaction(() => rows.forEach((row) => update.run(historicalApplicationSource(userDir, row), row.posting_id)))();
        migratedProvenanceDbs.add(userDb);
    }
    finally {
        db.close();
    }
}
/** Apply best-effort read-cache tuning without making an older SQLite build a boot blocker. */
function tuneDatabase(db) {
    try {
        db.pragma('cache_size=-65536');
        db.pragma('mmap_size=268435456');
    }
    catch (err) {
        logger.warn({ err }, 'career db pragma tuning skipped');
    }
}
/**
 * @description Lists real per-user store directories for cron fan-out while excluding parked
 * underscore-prefixed backup directories that must never become synthetic users.
 * @returns Authenticated subject directory names currently present in the Career tenant store.
 */
function listStoreUsers() {
    const root = careerStoreRoot();
    const tenantDir = storePath.resolveContainedPath(root, TENANT);
    try {
        const users = [];
        for (const entry of fs_1.default.readdirSync(tenantDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('_'))
                continue;
            try {
                const userSub = storePath.userSubFromStoreSegment(entry.name)
                    || storePath.legacyUserSubFromStoreEntry(tenantDir, entry.name);
                if (!userSub)
                    continue;
                storePath.resolveUserStoreLayout(root, TENANT, userSub);
                users.push(userSub);
            }
            catch (err) {
                logger.error({ err, entry: entry.name }, 'career user store entry rejected');
            }
        }
        return users;
    }
    catch (err) {
        logger.warn({ err, tenantDir }, 'career user store enumeration skipped');
        return [];
    }
}
//# sourceMappingURL=career-user-store.js.map