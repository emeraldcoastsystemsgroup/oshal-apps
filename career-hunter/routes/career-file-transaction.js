"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotFilesAsync = snapshotFilesAsync;
exports.writeFileAtomicAsync = writeFileAtomicAsync;
exports.restoreFilesAsync = restoreFilesAsync;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add reusable byte snapshots, atomic writes, and complete rollback for route-to-engine transactions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add promise-based transaction primitives so bounded uploads and packet edits do not block the controller event loop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Remove the synchronous compatibility surface after migrating the final Resume Studio caller.
 */
/**
 * Small filesystem transaction primitives for Career route hand-offs.
 *
 * A route may need to persist an upload or edited packet before the engine child can read it.
 * These helpers preserve the exact prior bytes and use same-directory atomic replacement, so a
 * rejected spawn or failed renderer can restore the caller's durable state without a torn file.
 *
 * @module career-file-transaction
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
/** Capture one path without a time-of-check/time-of-use gap around file existence. */
async function snapshotFile(filePath) {
    try {
        return { filePath, existed: true, bytes: await fs_1.promises.readFile(filePath) };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { filePath, existed: false };
        throw error;
    }
}
/**
 * @description Capture exact prior bytes concurrently before an asynchronous route transaction.
 * @param filePaths paths whose state must be restorable
 * @returns snapshots in the same order as the input paths
 */
function snapshotFilesAsync(filePaths) {
    return Promise.all(filePaths.map(snapshotFile));
}
/**
 * @description Atomically replace a file without blocking the controller event loop.
 * @param filePath destination path
 * @param value bytes or text to persist
 * @returns a promise that settles after replacement or temporary-file cleanup
 */
async function writeFileAtomicAsync(filePath, value) {
    const temporary = path_1.default.join(path_1.default.dirname(filePath), `.${path_1.default.basename(filePath)}.${(0, crypto_1.randomUUID)()}.tmp`);
    try {
        await fs_1.promises.writeFile(temporary, value);
        await fs_1.promises.rename(temporary, filePath);
    }
    catch (error) {
        try {
            await fs_1.promises.rm(temporary, { force: true });
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'atomic write cleanup failed');
        }
        throw error;
    }
}
/**
 * @description Restore asynchronous snapshots in reverse order and attempt every rollback step.
 * @param snapshots exact states captured before the transaction
 * @returns a promise that rejects after the full rollback if any path failed
 */
async function restoreFilesAsync(snapshots) {
    let firstError;
    for (const snapshot of [...snapshots].reverse()) {
        try {
            if (snapshot.existed)
                await writeFileAtomicAsync(snapshot.filePath, snapshot.bytes);
            else
                await fs_1.promises.rm(snapshot.filePath, { force: true });
        }
        catch (error) {
            firstError ||= error;
        }
    }
    if (firstError)
        throw firstError;
}
//# sourceMappingURL=career-file-transaction.js.map