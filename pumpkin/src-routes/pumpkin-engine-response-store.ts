/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: per-user SAVED
 *            | RESPONSES store for the pumpkin prop (operator request: "save his responses" +
 *            | "easy to click response play list"). Every line the pumpkin speaks (mimic say,
 *            | autonomous ask/chat reply) auto-saves here, deduped by lowercased text, capped to
 *            | the most recent unpinned N; pinned lines survive the cap. The remote/control
 *            | surfaces render the list as a one-tap replay playlist (POST /rooms/replay pushes
 *            | the saved line straight to the projector — no LLM round trip).
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import type { PumpkinExpression, PumpkinResponseSource, PumpkinSavedResponse } from './pumpkin-engine-types';

const logger = createChildLogger({ module: 'pumpkin-response-store' });

/** Allowlisted face expressions (mirrors the reply parser's contract). */
const EXPRESSIONS: readonly PumpkinExpression[] = ['neutral', 'happy', 'mischief', 'spooky', 'angry', 'laugh', 'surprised'];

/** Allowlisted provenance tags for a saved line. */
const SOURCES: readonly PumpkinResponseSource[] = ['mimic', 'autonomous', 'manual'];

/** Longest saved spoken line — matches the reply parser / rooms/say cap. */
export const MAX_SAVED_SAY = 300;

/** Unpinned saved responses kept per user; older unpinned lines roll off. Pinned lines never roll. */
export const MAX_UNPINNED_RESPONSES = 40;

/** A normalized candidate ready to persist. */
export interface NormalizedSavedResponse {
  say: string;
  expression: PumpkinExpression;
  intensity: number;
  source: PumpkinResponseSource;
}

/**
 * @description Normalize an untrusted saved-response candidate: trim + collapse whitespace and cap
 * the line, allowlist the expression + source, clamp intensity to [0,1]. Returns null when there is
 * no speakable text (never persist an empty line).
 * @param raw - Untrusted candidate ({ say|text, expression, intensity, source }).
 * @returns The normalized record, or null when say is empty.
 */
export function normalizeSavedResponse(raw: unknown): NormalizedSavedResponse | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = typeof r.say === 'string' ? r.say : typeof r.text === 'string' ? r.text : '';
  const say = text.replace(/\s+/g, ' ').trim().slice(0, MAX_SAVED_SAY).trim();
  if (!say) return null;
  const expression = (typeof r.expression === 'string' && EXPRESSIONS.includes(r.expression as PumpkinExpression)
    ? r.expression
    : 'neutral') as PumpkinExpression;
  const rawIntensity = typeof r.intensity === 'number' && Number.isFinite(r.intensity) ? r.intensity : 0.6;
  const intensity = Math.min(1, Math.max(0, rawIntensity));
  const source = (typeof r.source === 'string' && SOURCES.includes(r.source as PumpkinResponseSource)
    ? r.source
    : 'manual') as PumpkinResponseSource;
  return { say, expression, intensity, source };
}

/** The dedupe key for a saved line — one row per distinct lowercased text per user. */
export function responseDedupeKey(say: string): string {
  return say.toLowerCase();
}

/** Map a pumpkin_responses row to the API shape. */
function toSavedResponse(row: Record<string, unknown>): PumpkinSavedResponse {
  return {
    id: String(row.id),
    say: String(row.say),
    expression: row.expression as PumpkinExpression,
    intensity: Number(row.intensity),
    source: row.source as PumpkinResponseSource,
    pinned: Boolean(row.pinned),
    playCount: Number(row.play_count ?? 0),
    lastPlayedAt: row.last_played_at ? new Date(row.last_played_at as string).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  };
}

/**
 * Per-user store of lines the pumpkin has spoken. Auto-populated on every speak path and replayed
 * from the playlist with zero LLM cost. Every method is scoped by the owner's OIDC sub; the table
 * additionally carries the canonical owner-or-operator RLS policy (fresh-DB chokepoint rule).
 */
export class PumpkinResponseService {
  constructor(private readonly pool: Pool) {}

  /**
   * @description Create the pumpkin_responses table + dedupe index + owner RLS if absent
   * (idempotent — mirrors migration 094 so local dev works before migrations run). Logs and
   * swallows failure: the playlist degrades to empty, the prop keeps speaking.
   */
  async ensureSchema(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS pumpkin_responses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_sub VARCHAR(255) NOT NULL,
          say TEXT NOT NULL,
          expression VARCHAR(16) NOT NULL DEFAULT 'neutral',
          intensity REAL NOT NULL DEFAULT 0.6,
          source VARCHAR(16) NOT NULL DEFAULT 'manual',
          pinned BOOLEAN NOT NULL DEFAULT FALSE,
          play_count INTEGER NOT NULL DEFAULT 0,
          last_played_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS pumpkin_responses_dedupe
          ON pumpkin_responses (user_sub, md5(lower(say)));
      `);
      for (const stmt of buildOwnerRlsPolicyStatements('pumpkin_responses', 'user_sub')) {
        await this.pool.query(stmt);
      }
    } catch (err) {
      logger.error({ err }, 'pumpkin_responses ensureSchema failed — playlist disabled until schema heals');
    }
  }

  /**
   * @description Save (or refresh) a spoken line for a user. Dedupe: a line with the same
   * lowercased text updates the existing row (expression/intensity/source + recency bump) instead
   * of inserting a duplicate. After a save, unpinned rows beyond {@link MAX_UNPINNED_RESPONSES}
   * (oldest first by recency) are pruned; pinned rows are never pruned.
   * @param sub - The owner's OIDC sub.
   * @param raw - Untrusted candidate (normalized before persisting).
   * @returns The persisted row, or null when the candidate had no speakable text.
   */
  async record(sub: string, raw: unknown): Promise<PumpkinSavedResponse | null> {
    const n = normalizeSavedResponse(raw);
    if (!n) return null;
    try {
      const r = await this.pool.query(
        `INSERT INTO pumpkin_responses (user_sub, say, expression, intensity, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_sub, md5(lower(say))) DO UPDATE
           SET expression = EXCLUDED.expression, intensity = EXCLUDED.intensity,
               source = EXCLUDED.source, updated_at = NOW()
         RETURNING *`,
        [sub, n.say, n.expression, n.intensity, n.source],
      );
      await this.pool.query(
        `DELETE FROM pumpkin_responses WHERE id IN (
           SELECT id FROM pumpkin_responses
           WHERE user_sub = $1 AND pinned = FALSE
           ORDER BY updated_at DESC OFFSET $2
         )`,
        [sub, MAX_UNPINNED_RESPONSES],
      );
      return toSavedResponse(r.rows[0]);
    } catch (err) {
      logger.error({ err, sub }, 'pumpkin record response failed');
      return null;
    }
  }

  /**
   * @description The user's playlist: pinned lines first, then most recently spoken/saved first.
   * @param sub - The owner's OIDC sub.
   */
  async list(sub: string): Promise<PumpkinSavedResponse[]> {
    try {
      const r = await this.pool.query(
        `SELECT * FROM pumpkin_responses WHERE user_sub = $1
         ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
        [sub],
      );
      return r.rows.map(toSavedResponse);
    } catch (err) {
      logger.error({ err, sub }, 'pumpkin list responses failed');
      return [];
    }
  }

  /**
   * @description Fetch one saved response by id (owner-scoped), or null.
   */
  async get(sub: string, id: string): Promise<PumpkinSavedResponse | null> {
    try {
      const r = await this.pool.query(`SELECT * FROM pumpkin_responses WHERE user_sub = $1 AND id = $2`, [sub, id]);
      return r.rows[0] ? toSavedResponse(r.rows[0]) : null;
    } catch (err) {
      logger.error({ err, sub, id }, 'pumpkin get response failed');
      return null;
    }
  }

  /**
   * @description Pin (keep forever) or unpin a saved response.
   * @returns The updated row, or null when the id isn't the caller's.
   */
  async setPinned(sub: string, id: string, pinned: boolean): Promise<PumpkinSavedResponse | null> {
    try {
      const r = await this.pool.query(
        `UPDATE pumpkin_responses SET pinned = $3, updated_at = NOW()
         WHERE user_sub = $1 AND id = $2 RETURNING *`,
        [sub, id, pinned === true],
      );
      return r.rows[0] ? toSavedResponse(r.rows[0]) : null;
    } catch (err) {
      logger.error({ err, sub, id }, 'pumpkin setPinned failed');
      return null;
    }
  }

  /**
   * @description Delete a saved response. @returns true when a row was removed.
   */
  async remove(sub: string, id: string): Promise<boolean> {
    try {
      const r = await this.pool.query(`DELETE FROM pumpkin_responses WHERE user_sub = $1 AND id = $2`, [sub, id]);
      return (r.rowCount ?? 0) > 0;
    } catch (err) {
      logger.error({ err, sub, id }, 'pumpkin remove response failed');
      return false;
    }
  }

  /**
   * @description Bump a saved response's replay stats (fire-and-forget from the replay route).
   */
  async markPlayed(sub: string, id: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE pumpkin_responses SET play_count = play_count + 1, last_played_at = NOW()
         WHERE user_sub = $1 AND id = $2`,
        [sub, id],
      );
    } catch (err) {
      logger.error({ err, sub, id }, 'pumpkin markPlayed failed');
    }
  }
}
