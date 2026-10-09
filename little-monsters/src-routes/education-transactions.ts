/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share explicit SQL transaction cleanup and native storage capability detection across school mutations.
 */
import type { Pool, PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
const logger = createChildLogger({ module: 'education-transactions' });
/** @description Identify the admitted kernel SQL contract, without guessing from failures.
 * @param pool Request-bound pool or checked-out client.
 * @returns Whether native relationship transactions apply. */
export function isNativeSchoolStore(pool: Pool | PoolClient): boolean {
  return (pool as Pool & { storageModel?: string }).storageModel === 'kernel-scoped-documents';
}
/** @description Commit related school mutations together; the native host validates its full read set atomically.
 * @param pool Admitted application pool.
 * @param action Related database operations to commit together.
 * @returns The operation result after durable commit.
 * @throws The original query or commit failure after rollback cleanup. */
export async function schoolTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { logger.error({ err: rollbackError }, 'School transaction rollback failed'); }
    throw err;
  } finally { client.release(); }
}
