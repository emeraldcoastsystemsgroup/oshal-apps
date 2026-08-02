/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:32:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: per-user persistence for pumpkin looks. Built-in presets ship in code; this stores + merges a user's saved custom looks and their last-used preset/mode, all keyed by OIDC sub. Idempotent ensureSchema() so local dev works before migration 084 runs.
 * 2026-08-01 22:15:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Persist the last-launched ROOM LABEL alongside the preset + mode (migration 104). Without it the short-form projector URL the night-of runbook tells the operator to type could not restore the room: the projector came up in 'main' while the cockpit and the phone pushed into 'front-porch', and the only symptom was a silent prop. ensureSchema ALTERs an existing table rather than only CREATE-ing, because CREATE TABLE IF NOT EXISTS is a no-op on a deployment that already has the old three-column shape.
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import type { PumpkinPreset, PumpkinSettings, PumpkinMode } from './pumpkin-engine-types';
import { BUILTIN_PRESETS, builtinPreset, normalizePreset } from './pumpkin-engine-presets';

const logger = createChildLogger({ module: 'pumpkin-preset-service' });

/** URL-safe slug guard so a name is always a safe table key + surface id. */
function slug(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);
}

/**
 * Per-user store for pumpkin looks + settings. Built-in presets are code-defined and returned
 * first; a user's saved customs are layered on top. Every method is scoped by `sub`.
 */
export class PumpkinPresetService {
  constructor(private readonly pool: Pool) {}

  /**
   * @description Create the pumpkin tables if absent (idempotent). Mirrors migration 084 so a
   * fresh local dev DB works before migrations run. Logs and swallows on failure — the surface
   * still functions on built-in presets alone.
   */
  async ensureSchema(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS pumpkin_presets (
          user_sub VARCHAR(255) NOT NULL,
          name VARCHAR(64) NOT NULL,
          config JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_sub, name)
        );
        CREATE TABLE IF NOT EXISTS pumpkin_settings (
          user_sub VARCHAR(255) PRIMARY KEY,
          active_preset VARCHAR(64) NOT NULL DEFAULT 'inflatable',
          mode VARCHAR(16) NOT NULL DEFAULT 'mimic',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE pumpkin_settings ADD COLUMN IF NOT EXISTS room_label VARCHAR(40) NOT NULL DEFAULT 'Main';
      `);
    } catch (err) {
      logger.error({ err }, 'pumpkin ensureSchema failed — falling back to built-in presets only');
    }
  }

  /**
   * @description List every look available to a user: the built-ins first, then their saved customs.
   * @param sub - The owner's OIDC sub.
   * @returns Built-in + custom presets (built-ins are read-only).
   */
  async listPresets(sub: string): Promise<PumpkinPreset[]> {
    const builtins = Object.values(BUILTIN_PRESETS).map((p) => JSON.parse(JSON.stringify(p)) as PumpkinPreset);
    try {
      const r = await this.pool.query(`SELECT config FROM pumpkin_presets WHERE user_sub = $1 ORDER BY name`, [sub]);
      const customs = r.rows.map((row) => row.config as PumpkinPreset);
      return [...builtins, ...customs];
    } catch (err) {
      logger.error({ err, sub }, 'listPresets failed');
      return builtins;
    }
  }

  /**
   * @description Resolve ONE look by name: a built-in, else the user's saved custom, else null.
   * @param sub - The owner's OIDC sub.
   * @param name - The preset slug.
   */
  async getPreset(sub: string, name: string): Promise<PumpkinPreset | null> {
    const builtin = builtinPreset(name);
    if (builtin) return builtin;
    try {
      const r = await this.pool.query(`SELECT config FROM pumpkin_presets WHERE user_sub = $1 AND name = $2`, [sub, slug(name)]);
      return r.rows[0]?.config ?? null;
    } catch (err) {
      logger.error({ err, sub, name }, 'getPreset failed');
      return null;
    }
  }

  /**
   * @description Save (upsert) a custom look under the caller. Built-in names are reserved, so a
   * save of a built-in slug is redirected to `<name>-custom`. The payload is normalized (clamped +
   * allowlisted) before it is ever persisted or rendered.
   * @param sub - The owner's OIDC sub.
   * @param name - Requested slug.
   * @param raw - Untrusted candidate preset from the control surface.
   * @returns The normalized, persisted preset.
   */
  async savePreset(sub: string, name: string, raw: unknown): Promise<PumpkinPreset> {
    let target = slug(name);
    if (!target) target = 'custom';
    if (BUILTIN_PRESETS[target]) target = `${target}-custom`;
    const preset = normalizePreset(raw, target);
    try {
      await this.pool.query(
        `INSERT INTO pumpkin_presets (user_sub, name, config) VALUES ($1, $2, $3)
         ON CONFLICT (user_sub, name) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
        [sub, target, JSON.stringify(preset)],
      );
    } catch (err) {
      logger.error({ err, sub, name: target }, 'savePreset failed');
      throw err;
    }
    return preset;
  }

  /**
   * @description Delete a user's custom look. Built-ins cannot be deleted (no-op false).
   * @returns true when a row was removed.
   */
  async deletePreset(sub: string, name: string): Promise<boolean> {
    const target = slug(name);
    if (BUILTIN_PRESETS[target]) return false;
    try {
      const r = await this.pool.query(`DELETE FROM pumpkin_presets WHERE user_sub = $1 AND name = $2`, [sub, target]);
      return (r.rowCount ?? 0) > 0;
    } catch (err) {
      logger.error({ err, sub, name: target }, 'deletePreset failed');
      return false;
    }
  }

  /**
   * @description The user's last-used preset, mode and room label — what the SHORT projector URL
   * (`{origin}/pumpkin/`, nothing after the slash) reads back so the awkward projector device is
   * typed on once rather than every time the room or the look changes.
   * @param sub - The owner's OIDC sub.
   * @returns The stored selection, or the shipped defaults when there is no row (or the read fails).
   */
  async getSettings(sub: string): Promise<PumpkinSettings> {
    try {
      const r = await this.pool.query(`SELECT active_preset, mode, room_label FROM pumpkin_settings WHERE user_sub = $1`, [sub]);
      if (r.rows[0]) {
        return {
          activePreset: r.rows[0].active_preset,
          mode: r.rows[0].mode as PumpkinMode,
          roomLabel: String(r.rows[0].room_label || 'Main'),
        };
      }
    } catch (err) {
      logger.error({ err, sub }, 'getSettings failed');
    }
    return { activePreset: 'inflatable', mode: 'mimic', roomLabel: 'Main' };
  }

  /**
   * @description Persist the user's last-used preset, mode and room label so the surfaces restore it.
   *
   * `roomLabel` is optional so an older caller cannot silently blank a working room: omitting it
   * leaves the stored value alone (COALESCE on the excluded row) rather than resetting it to 'Main'.
   * @param sub - The owner's OIDC sub.
   * @param activePreset - Requested look; slugified, defaulting to the projector look.
   * @param mode - Requested run mode; anything but 'autonomous' is mimic.
   * @param roomLabel - Optional room LABEL (not the slug — the label is what register() is given).
   * @returns Nothing; failures are logged, never thrown at the surface.
   */
  async saveSettings(sub: string, activePreset: string, mode: PumpkinMode, roomLabel?: string): Promise<void> {
    const preset = slug(activePreset) || 'inflatable';
    const m: PumpkinMode = mode === 'autonomous' ? 'autonomous' : 'mimic';
    const label = String(roomLabel ?? '').trim().slice(0, 40) || null;
    try {
      await this.pool.query(
        `INSERT INTO pumpkin_settings (user_sub, active_preset, mode, room_label)
         VALUES ($1, $2, $3, COALESCE($4, 'Main'))
         ON CONFLICT (user_sub) DO UPDATE SET
           active_preset = EXCLUDED.active_preset,
           mode = EXCLUDED.mode,
           room_label = COALESCE($4, pumpkin_settings.room_label),
           updated_at = NOW()`,
        [sub, preset, m, label],
      );
    } catch (err) {
      logger.error({ err, sub }, 'saveSettings failed');
    }
  }
}
