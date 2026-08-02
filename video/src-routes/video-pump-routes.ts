/**
 * Joke-shorts pump routes — the operator's controls for the automated production loop.
 *
 * The pump engine is framework-resident (src/app/series-pump.ts + vids-node-availability.ts, ADR-093:
 * the conductor and its driver are the runtime). This package owns the CONTENT and the CONTROLS: the
 * show library in shows/*.yaml, the enrolment switches, and the tuning view.
 *
 * The one thing worth reading twice is the enrolment split. `POST /shows/import` writes only a show's
 * CONTENT — premise, cast, style, seeds. It never sets `enabled`, `standingAuthorization` or
 * `dailyCap`, because those three are the operator's authorization for real render spend and must
 * never arrive as a side effect of updating a joke list.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-29 18:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | The joke-shorts pump surface: import the show library, enrol a show (opt-in, with a daily cap), read the node's availability + the run ledger, and run one cycle on demand.
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import yaml from 'js-yaml';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { resolveSpeakerPointers, type CastMember } from '@/app/series-pipeline';
import { runPumpOnce, pickNextShow } from '@/app/series-pump';
import { checkVidsNodeAvailability } from '@/app/vids-node-availability';

const logger = createChildLogger({ module: 'video-pump-routes' });

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** @description One show as the library file declares it. */
interface ShowFile {
  slug?: string;
  title?: string;
  premise?: string;
  styleLock?: string;
  scenesPerEpisode?: number;
  orientation?: string;
  introClip?: string;
  cast?: CastMember[];
  jokeSeeds?: string[];
}

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Where the show library lives, resolved the same way the surface is (D10). */
function showsDir(appPackageDir?: string): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'shows') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'shows') : '',
    path.resolve(__dirname, '../shows'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}

/**
 * @description Read and check the library. A show whose cast is ambiguous is REFUSED rather than
 * imported: the renderer addresses a speaker by one noun, so two characters resolving to the same
 * noun ships a video in which the wrong thing talks — and by then it has been paid for.
 * @param {string} dir the shows directory
 * @returns {{shows: ShowFile[], rejected: Array<{file: string, why: string}>}} what loaded
 */
export function loadShowLibrary(dir: string): { shows: ShowFile[]; rejected: Array<{ file: string; why: string }> } {
  const shows: ShowFile[] = [];
  const rejected: Array<{ file: string; why: string }> = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort(); } catch { return { shows, rejected }; }

  for (const file of files) {
    let show: ShowFile;
    try { show = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')) as ShowFile; }
    catch (err) { rejected.push({ file, why: `unreadable: ${(err as Error).message}` }); continue; }

    if (!show?.slug || !show.title || !show.premise) { rejected.push({ file, why: 'slug, title and premise are all required' }); continue; }
    const cast = Array.isArray(show.cast) ? show.cast : [];
    if (cast.length < 2) { rejected.push({ file, why: 'a show needs at least two characters' }); continue; }

    const pointers = resolveSpeakerPointers(cast);
    const seen = new Map<string, string>();
    let clash: string | null = null;
    for (const [name, ptr] of pointers) {
      if (seen.has(ptr)) clash = `${name} and ${seen.get(ptr)} both resolve to "the ${ptr}"`;
      seen.set(ptr, name);
    }
    if (clash) { rejected.push({ file, why: `${clash} — make each description's first clause end in that character's own noun` }); continue; }
    shows.push(show);
  }
  return { shows, rejected };
}

/** Upsert a show's CONTENT for one owner. Deliberately never touches the enrolment switches. */
async function upsertShow(ctx: AppContext, sub: string, show: ShowFile): Promise<'created' | 'updated'> {
  const { rows } = await ctx.pool.query(
    `INSERT INTO video_pump_shows
       (user_sub, slug, title, premise, style_lock, cast_bible, joke_seeds, scenes_per_episode,
        orientation, intro_clip)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
     ON CONFLICT (user_sub, slug) DO UPDATE
       SET title = EXCLUDED.title, premise = EXCLUDED.premise, style_lock = EXCLUDED.style_lock,
           cast_bible = EXCLUDED.cast_bible, joke_seeds = EXCLUDED.joke_seeds,
           scenes_per_episode = EXCLUDED.scenes_per_episode, orientation = EXCLUDED.orientation,
           intro_clip = EXCLUDED.intro_clip, updated_at = now()
     RETURNING (created_at = updated_at) AS is_new`,
    [sub, show.slug, show.title, show.premise, show.styleLock ?? null,
      JSON.stringify(show.cast ?? []), JSON.stringify(show.jokeSeeds ?? []),
      Number(show.scenesPerEpisode ?? 4), String(show.orientation ?? 'Landscape'), show.introClip ?? null],
  );
  return (rows[0] as { is_new?: boolean })?.is_new ? 'created' : 'updated';
}

/**
 * @description The joke-shorts pump router.
 * @param {AppContext} ctx per-package app context
 * @returns {Router} the router, mounted at /api/video/pump
 */
export function createVideoPumpRoutes(ctx: AppContext): Router {
  const router = Router();
  const dir = showsDir((ctx as { appPackageDir?: string }).appPackageDir);

  /** GET /shows — the library on disk, joined to what this caller has enrolled. */
  router.get('/shows', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const { shows, rejected } = loadShowLibrary(dir);
      const { rows } = await ctx.pool.query(
        `SELECT slug, title, enabled, standing_authorization, daily_cap, min_interval_minutes,
                episodes_made, consecutive_failures, paused_reason, last_started_at, last_success_at,
                jsonb_array_length(joke_seeds) AS seeds, seed_cursor
           FROM video_pump_shows WHERE user_sub = $1 ORDER BY slug`, [sub],
      );
      const enrolled = new Map((rows as Array<Record<string, unknown>>).map((r) => [String(r.slug), r]));
      res.json({
        ok: true,
        shows: shows.map((s) => ({
          slug: s.slug, title: s.title, cast: (s.cast ?? []).map((c) => c.name),
          seeds: (s.jokeSeeds ?? []).length, scenesPerEpisode: s.scenesPerEpisode ?? 4,
          enrollment: enrolled.get(String(s.slug)) ?? null,
        })),
        rejected,
      });
    } catch (err) {
      logger.error({ err }, 'list pump shows failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /shows/import — bring the library into this caller's shows. Content only: enrolment stays
   * exactly as it was, so re-importing after editing a joke list can never switch a show on.
   */
  router.post('/shows/import', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const { shows, rejected } = loadShowLibrary(dir);
      const results: Array<{ slug: string; result: string }> = [];
      for (const show of shows) {
        // eslint-disable-next-line no-await-in-loop
        results.push({ slug: String(show.slug), result: await upsertShow(ctx, sub, show) });
      }
      logger.info({ sub, imported: results.length, rejected: rejected.length }, 'pump show library imported');
      res.json({
        ok: true, imported: results, rejected,
        message: rejected.length
          ? `${results.length} show(s) imported; ${rejected.length} refused — fix the cast and re-import.`
          : `${results.length} show(s) imported. Each one is still OFF until you enrol it.`,
      });
    } catch (err) {
      logger.error({ err }, 'import pump shows failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /shows/:slug/enroll — the operator's opt-in, and the only place render spend is authorized.
   * `standingAuthorization` lets the pump approve this show's episodes up to `dailyCap` per day and
   * nothing else; without it the pump still writes scripts (free) and parks them.
   */
  router.post('/shows/:slug/enroll', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const dailyCap = b.dailyCap === undefined ? 1 : Number(b.dailyCap);
    const interval = b.minIntervalMinutes === undefined ? 240 : Number(b.minIntervalMinutes);
    if (!Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > 24) {
      res.status(400).json({ error: 'dailyCap must be an integer 0–24' }); return;
    }
    if (!Number.isInteger(interval) || interval < 0) { res.status(400).json({ error: 'minIntervalMinutes must be a non-negative integer' }); return; }

    try {
      const { rows } = await ctx.pool.query(
        `UPDATE video_pump_shows
            SET enabled = $3, standing_authorization = $4, daily_cap = $5,
                min_interval_minutes = $6, updated_at = now()
          WHERE user_sub = $1 AND slug = $2
          RETURNING slug, enabled, standing_authorization, daily_cap, min_interval_minutes`,
        [sub, String(req.params.slug), b.enabled !== false, Boolean(b.standingAuthorization), dailyCap, interval],
      );
      if (!rows.length) { res.status(404).json({ error: 'show not found — import the library first' }); return; }
      logger.info({ sub, slug: req.params.slug, enrollment: rows[0] }, 'pump show enrolment changed');
      res.json({ ok: true, show: rows[0] });
    } catch (err) {
      logger.error({ err }, 'enroll pump show failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** POST /shows/:slug/resume — clear an auto-pause once the cause is fixed. */
  router.post('/shows/:slug/resume', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const { rows } = await ctx.pool.query(
        `UPDATE video_pump_shows SET paused_reason = NULL, consecutive_failures = 0, updated_at = now()
          WHERE user_sub = $1 AND slug = $2 RETURNING slug`, [sub, String(req.params.slug)],
      );
      if (!rows.length) { res.status(404).json({ error: 'show not found' }); return; }
      res.json({ ok: true, slug: String(req.params.slug), message: 'resumed' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /status — the tuning view: is the node free, what is due next, and what did the last cycles
   * actually do. `?probe=1` asks the node itself (slow, up to two minutes); the default answer uses
   * only the registry, the schedule and the database.
   */
  router.get('/status', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const node = await checkVidsNodeAvailability(ctx.pool, { skipProbe: req.query.probe !== '1' });
      const due = await pickNextShow(ctx.pool);
      const runs = await ctx.pool.query(
        `SELECT show_slug, episode_title, joke_seed, outcome, outcome_stage, outcome_reason,
                drive_url, duration_ms, created_at
           FROM video_pump_runs WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 25`, [sub],
      );
      const totals = await ctx.pool.query(
        `SELECT outcome, count(*)::int AS n FROM video_pump_runs WHERE user_sub = $1 GROUP BY outcome`, [sub],
      );
      res.json({
        ok: true,
        pumpEnabled: (process.env.VIDEO_PUMP_ENABLED || '').toLowerCase() === 'true',
        node: { available: node.available, check: node.check, reason: node.reason, probe: node.probe ?? null, probed: req.query.probe === '1' },
        dueNext: due ? { slug: due.slug, title: due.title, standingAuthorization: due.standingAuthorization } : null,
        totals: (totals.rows as Array<{ outcome: string; n: number }>).reduce<Record<string, number>>((a, r) => { a[r.outcome] = r.n; return a; }, {}),
        runs: runs.rows,
      });
    } catch (err) {
      logger.error({ err }, 'pump status failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /run — run one cycle now. Still fully gated: if the node is busy this returns the reason
   * rather than starting anything, which is also how an operator tests the gate on purpose.
   */
  router.post('/run', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const cycle = await runPumpOnce(ctx);
      logger.info({ sub, cycle }, 'pump cycle run on demand');
      res.json({ ok: true, cycle });
    } catch (err) {
      logger.error({ err }, 'pump run failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
