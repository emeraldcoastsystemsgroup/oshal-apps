/**
 * Little Monsters XP and level progression.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted canonical XP calculations and reward grants from the route aggregator
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Made XP event and balance updates atomic with optional server-derived deduplication keys
 * ---------------------------------------------------------------------------
 *
 * @module education-progress
 */

import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import type { PoolClient } from 'pg';

const logger = createChildLogger({ module: 'education-progress' });

/** XP awards by event type. */
export const XP_TABLE: Readonly<Record<string, number>> = {
  lecture_uploaded: 25,
  notes_reviewed: 10,
  flashcard_session: 50,
  quiz_completed: 30,
  quiz_high_score: 20,
  streak_bonus: 15,
  tutor_question: 5,
  study_session: 40,
  game_warmup: 10,
  game_played: 15,
};

/** Calculate a level using the exponential `100 * 1.5^(level - 1)` curve. */
export function levelFromXP(totalXP: number): number {
  let remainingXP = totalXP;
  let level = 1;
  let threshold = 100;
  while (remainingXP >= threshold) {
    remainingXP -= threshold;
    level += 1;
    threshold = Math.floor(100 * Math.pow(1.5, level - 1));
  }
  return level;
}

async function grantLevelRewards(
  ctx: AppContext,
  studentId: string,
  boxesGranted: number,
): Promise<number> {
  if (boxesGranted <= 0) return 0;
  try {
    await ctx.pool.query(
      `INSERT INTO lm_rewards (student_id, boxes) VALUES ($1, $2)
       ON CONFLICT (student_id) DO UPDATE
       SET boxes = lm_rewards.boxes + $2, updated_at = NOW()`,
      [studentId, boxesGranted],
    );
    return boxesGranted;
  } catch (err) {
    logger.error({ err, studentId }, 'Level reward grant failed; XP remains recorded');
    return 0;
  }
}

interface XpTransactionResult {
  awarded: boolean;
  xpAmount: number;
  totalXP?: number;
  level?: number;
  priorLevel?: number;
}

/** Atomically append the ledger event and update the materialized student balance. */
async function recordXpTransaction(
  client: PoolClient,
  studentId: string,
  eventType: string,
  xpAmount: number,
  metadata: unknown,
  dedupeKey?: string,
): Promise<XpTransactionResult> {
  const event = await client.query(
    `INSERT INTO lm_xp_events (student_id, event_type, xp_amount, metadata, dedupe_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING event_id`,
    [studentId, eventType, xpAmount, JSON.stringify(metadata || {}), dedupeKey || null],
  );
  if (!event.rowCount) return { awarded: false, xpAmount };
  const result = await client.query(
    'UPDATE lm_students SET xp = xp + $1, updated_at = NOW() WHERE student_id = $2 RETURNING xp',
    [xpAmount, studentId],
  );
  if (!result.rows[0]) throw new Error('XP recipient no longer exists');
  const totalXP = Number(result.rows[0].xp);
  const level = levelFromXP(totalXP);
  const priorLevel = levelFromXP(totalXP - xpAmount);
  await client.query('UPDATE lm_students SET level = $1 WHERE student_id = $2', [level, studentId]);
  return { awarded: true, xpAmount, totalXP, level, priorLevel };
}

/** Record an XP event, update the student's level, and grant level-up boxes. */
export async function awardXP(
  ctx: AppContext,
  studentId: string | null,
  eventType: string,
  metadata: unknown = {},
  dedupeKey?: string,
): Promise<{ xpAwarded: number; totalXP?: number; level?: number; boxesGranted?: number }> {
  const xpAmount = XP_TABLE[eventType] || 0;
  if (xpAmount === 0 || !studentId) return { xpAwarded: 0 };
  const client = await ctx.pool.connect();
  let output: XpTransactionResult;
  try {
    await client.query('BEGIN');
    output = await recordXpTransaction(client, studentId, eventType, xpAmount, metadata, dedupeKey);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr, cause: err, studentId }, 'XP transaction rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
  if (!output.awarded) return { xpAwarded: 0 };
  const boxesGranted = await grantLevelRewards(ctx, studentId, output.level! - output.priorLevel!);
  return { xpAwarded: xpAmount, totalXP: output.totalXP, level: output.level, boxesGranted };
}
