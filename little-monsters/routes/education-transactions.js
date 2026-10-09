"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNativeSchoolStore = isNativeSchoolStore;
exports.schoolTransaction = schoolTransaction;
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'education-transactions' });
/** @description Identify the admitted kernel SQL contract, without guessing from failures.
 * @param pool Request-bound pool or checked-out client.
 * @returns Whether native relationship transactions apply. */
function isNativeSchoolStore(pool) {
    return pool.storageModel === 'kernel-scoped-documents';
}
/** @description Commit related school mutations together; the native host validates its full read set atomically.
 * @param pool Admitted application pool.
 * @param action Related database operations to commit together.
 * @returns The operation result after durable commit.
 * @throws The original query or commit failure after rollback cleanup. */
async function schoolTransaction(pool, action) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch (rollbackError) {
            logger.error({ err: rollbackError }, 'School transaction rollback failed');
        }
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=education-transactions.js.map