/**
 * Sports Edge routes — /api/sports-edge.
 *
 * The surface is deliberately narrow because the app is: you follow teams, you look at their next
 * games, and you read the preview behind one of them. Everything else on these routes exists to
 * keep that honest — the scorecard that says whether any of this beats the market, and the ledger
 * that shows every call that has ever been made.
 *
 * THERE IS NO ORDER ROUTE, AND THAT IS THE POINT. Phase 1 stakes nothing. The Kelly numbers are
 * computed and recorded so the forward test is real, but there is no endpoint that moves money and
 * no code path that could. When the ledger earns a PROVEN verdict, the rail is Kalshi's existing
 * confirm-gated order path, not something new here.
 *
 * Mounted behind service-or-oidc per the manifest; handlers ALSO self-gate via callerSub, so a
 * mounting mistake cannot expose a person's followed teams anonymously.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — surface, team picker, follow/unfollow, upcoming games for followed teams, the full game preview with an on-demand rebuild, the scorecard's strategy verdicts, the ledger read, and scoped settings.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Mount the line-capture reads: GET /lines/status (how long we have been watching, which cannot be improved retroactively) and GET /lines/:eventId (the observation series plus its movement summary).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Mount the fantasy routes (/fantasy/*): ESPN Fantasy league link, the lineup advisor, and its graded record.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | GET /games returns upstreamOk, so an unreachable schedule service is never rendered as "your team is not playing" — an empty list is only an answer when the read actually succeeded.
 *
 * @module sports-routes
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, servePage } from '@/app/routes/trading-routes-helpers';
import { isOperator } from '@/shared/middleware/authz';
import type { League } from './sports-odds';
import { classify, rollup, type StrategyVerdict } from './sports-ledger';
import {
  DEPLOYMENT_SCOPE, ensureSchema, followTeam, gradedRows, listFollowed, predictionsForEvent,
  readSettings, unfollowTeam, writeSettings,
} from './sports-store';
import { listTeams } from './sports-espn';
import {
  currentSeason, followedGames, previewFor, refreshRatings, startSportsRefresh, refreshStatus,
} from './sports-refresh';
import { registerFantasyRoutes } from './sports-fantasy-routes';
import { summariseMovement } from './sports-line-history';
import { captureStats, ensureLineSchema, observationsFor } from './sports-line-store';

const log = createChildLogger({ module: 'sports-routes' });

/** Leagues this package will answer for. Anything else is a 400, never a silent empty result. */
const LEAGUES: League[] = ['nfl', 'ncaaf', 'nba'];

/** Package dir captured at load, as a fallback when ctx does not carry one. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Locate the directory holding the surface HTML, tolerating the three places a
 * package can be mounted from.
 * @param appPackageDir - Package directory from the app context, when present.
 * @returns Directory containing sports-edge.html.
 */
function surfaceDir(appPackageDir: string | undefined): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
    path.resolve(__dirname, '../tools'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(path.join(d, 'sports-edge.html'))) || candidates[candidates.length - 1];
}

/** Rejects an unknown league rather than returning an empty result that reads like "no games". */
function parseLeague(value: unknown, res: Response): League | null {
  const league = String(value || '').toLowerCase() as League;
  if (!LEAGUES.includes(league)) {
    res.status(400).json({ error: `league must be one of ${LEAGUES.join(', ')}` });
    return null;
  }
  return league;
}

/** Resolves the caller or answers 401. Returns null when it has already answered. */
function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: 'authentication required' }); return null; }
  return sub;
}

/**
 * @description Build the package's router.
 * @param ctx - App context supplying the pool and package directory.
 * @returns The mounted router.
 */
export function createSportsEdgeRoutes(ctx: AppContext): Router {
  const pool: Pool = ctx.pool;
  const toolsDir = surfaceDir(ctx.appPackageDir);
  const router = Router();
  ensureSchema(pool).catch((err) => log.error({ err }, 'sports-edge schema ensure failed'));
  ensureLineSchema(pool).catch((err) => log.error({ err }, 'sports-edge line schema ensure failed'));
  // Started here, by the app's own factory, so the refresh loop exists exactly while this package
  // is installed and active — never on a deployment that does not have it.
  startSportsRefresh(ctx);

  router.get('/', servePage(toolsDir, 'sports-edge.html'));
  router.get('/ui', servePage(toolsDir, 'sports-edge.html'));

  registerTeamRoutes(router, pool);
  registerGameRoutes(router, pool);
  registerRecordRoutes(router, pool);
  registerSettingsRoutes(router, pool);
  // The fantasy half. Its reads need the caller's ESPN cookies, resolved per request from the
  // connector broker; the public projection feed it leans on needs no credential at all.
  registerLineRoutes(router, pool);
  registerFantasyRoutes(router, pool);
  return router;
}

/**
 * @description The line-capture reads: how much history exists, and one game's movement.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerLineRoutes(router: Router, pool: Pool): void {
  router.get('/lines/status', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    try {
      const stats = await captureStats(pool);
      // "since" is the honest headline: this dataset's whole value is how long we have been
      // watching, and it cannot be improved retroactively.
      res.json({ ...stats, note: 'Opening lines cannot be backfilled — this history starts when capture started.' });
    } catch (err) {
      log.error({ err }, 'line status failed');
      res.status(500).json({ error: 'could not read the capture status' });
    }
  });

  router.get('/lines/:eventId', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    try {
      const book = typeof req.query.book === 'string' && req.query.book ? req.query.book : undefined;
      const rows = await observationsFor(pool, String(req.params.eventId), book);
      if (!rows.length) { res.status(404).json({ error: 'no line history captured for that game' }); return; }
      res.json({
        eventId: String(req.params.eventId),
        observations: rows,
        movement: summariseMovement(rows, typeof req.query.kickoff === 'string' ? req.query.kickoff : null),
      });
    } catch (err) {
      log.error({ err, eventId: req.params.eventId }, 'line history failed');
      res.status(500).json({ error: 'could not read the line history' });
    }
  });
}

/**
 * @description Team discovery and the follow list — the app's entry point, since nothing else
 * happens until a team is followed.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerTeamRoutes(router: Router, pool: Pool): void {
  router.get('/teams', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    const league = parseLeague(req.query.league, res);
    if (!league) return;
    try {
      const teams = await listTeams(league, { log: (e, f) => log.debug(f, e) });
      res.json({ league, teams });
    } catch (err) {
      log.error({ err, league }, 'team list failed');
      res.status(502).json({ error: 'could not reach the schedule service' });
    }
  });

  router.get('/follow', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      res.json({ teams: await listFollowed(pool, sub) });
    } catch (err) {
      log.error({ err }, 'followed list failed');
      res.status(500).json({ error: 'could not read followed teams' });
    }
  });

  router.post('/follow', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const league = parseLeague(req.body?.league, res);
    if (!league) return;
    const team = String(req.body?.team || '').toUpperCase().trim();
    const teamId = String(req.body?.teamId || '').trim();
    if (!team || !teamId) { res.status(400).json({ error: 'team and teamId are required' }); return; }
    try {
      await followTeam(pool, sub, { league, team, teamId, displayName: req.body?.displayName || null });
      log.info({ sub, league, team }, 'team followed');
      res.json({ ok: true, teams: await listFollowed(pool, sub) });
    } catch (err) {
      log.error({ err, league, team }, 'follow failed');
      res.status(500).json({ error: 'could not follow that team' });
    }
  });

  router.delete('/follow/:league/:team', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      const removed = await unfollowTeam(pool, sub, String(req.params.league), String(req.params.team).toUpperCase());
      res.json({ ok: true, removed, teams: await listFollowed(pool, sub) });
    } catch (err) {
      log.error({ err }, 'unfollow failed');
      res.status(500).json({ error: 'could not unfollow that team' });
    }
  });
}

/**
 * @description The games and previews — what a followed team plays next, and the full picture
 * behind one of those games.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerGameRoutes(router: Router, pool: Pool): void {
  router.get('/games', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const started = Date.now();
    try {
      const followed = await listFollowed(pool, sub);
      if (!followed.length) { res.json({ teams: [], games: [], awaitingFollow: true }); return; }
      const { rows, upstreamOk } = await followedGames(pool, followed, Number(req.query.days) || undefined);
      log.info({ sub, teams: followed.length, games: rows.length, upstreamOk, ms: Date.now() - started }, 'games served');
      // `upstreamOk` is what stops an unreachable schedule service from rendering as "your team is
      // not playing". An empty list is only an ANSWER when the read actually succeeded.
      res.json({ teams: followed, games: rows, awaitingFollow: false, upstreamOk });
    } catch (err) {
      log.error({ err, sub }, 'games failed');
      res.status(500).json({ error: 'could not assemble upcoming games' });
    }
  });

  router.get('/preview/:eventId', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    const league = parseLeague(req.query.league, res);
    if (!league) return;
    try {
      const built = await previewFor(pool, league, String(req.params.eventId), req.query.refresh === '1');
      if (!built) { res.status(404).json({ error: 'that game is not on the upcoming schedule' }); return; }
      const calls = await predictionsForEvent(pool, String(req.params.eventId));
      res.json({ ...built, calls });
    } catch (err) {
      log.error({ err, eventId: req.params.eventId }, 'preview failed');
      res.status(502).json({ error: 'could not build the preview' });
    }
  });

  router.get('/status', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    res.json({ season: { nfl: currentSeason('nfl'), nba: currentSeason('nba') }, refresh: refreshStatus() });
  });

  router.post('/ratings/refresh', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    if (!isOperator(req)) { res.status(403).json({ error: 'rebuilding ratings is operator-only' }); return; }
    const league = parseLeague(req.body?.league, res);
    if (!league) return;
    try {
      const built = await refreshRatings(pool, league);
      res.json({ ok: true, league, games: built.games, carriedOver: built.carriedOver });
    } catch (err) {
      log.error({ err, league }, 'ratings refresh failed');
      res.status(502).json({ error: 'could not rebuild ratings' });
    }
  });
}

/**
 * @description The record — the scorecard's verdicts and the raw ledger. These are the routes that
 * make the package answerable rather than merely opinionated.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerRecordRoutes(router: Router, pool: Pool): void {
  router.get('/scorecard', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    try {
      const rows = await gradedRows(pool);
      const byStrategy = new Map<string, typeof rows>();
      for (const r of rows) {
        if (!byStrategy.has(r.strategy)) byStrategy.set(r.strategy, []);
        (byStrategy.get(r.strategy) as typeof rows).push(r);
      }
      const verdicts: StrategyVerdict[] = [...byStrategy.entries()]
        .map(([strategy, rs]) => classify(rollup(strategy, rs)))
        .sort((a, b) => a.rollup.brier - b.rollup.brier);
      res.json({ verdicts, settledCalls: rows.length });
    } catch (err) {
      log.error({ err }, 'scorecard failed');
      res.status(500).json({ error: 'could not read the scorecard' });
    }
  });

  router.get('/ledger', async (req: Request, res: Response) => {
    if (!requireSub(req, res)) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    try {
      const r = await pool.query(
        `SELECT strategy, league, event_id, game_date, home_team, away_team, market, side, selection,
                model_prob, market_prob, edge, price_at_pick, stake_fraction, settled, won, brier,
                market_brier, clv, pnl_units, graded_at, created_at
         FROM sports_predictions ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      res.json({ rows: r.rows });
    } catch (err) {
      log.error({ err }, 'ledger failed');
      res.status(500).json({ error: 'could not read the ledger' });
    }
  });
}

/**
 * @description Settings, split by scope: cadence knobs are operator-only because one refresh
 * serves everyone, while horizon and alert knobs are the caller's own.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerSettingsRoutes(router: Router, pool: Pool): void {
  const DEPLOYMENT_KEYS = new Set(['refreshEnabled', 'refreshIntervalMinutes', 'ratingsRefreshHours']);

  router.get('/settings', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      res.json({
        deployment: await readSettings(pool, DEPLOYMENT_SCOPE),
        user: await readSettings(pool, sub),
        canEditDeployment: isOperator(req),
      });
    } catch (err) {
      log.error({ err }, 'settings read failed');
      res.status(500).json({ error: 'could not read settings' });
    }
  });

  router.put('/settings', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const patch = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const deployment: Record<string, unknown> = {};
    const user: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) (DEPLOYMENT_KEYS.has(k) ? deployment : user)[k] = v;
    if (Object.keys(deployment).length && !isOperator(req)) {
      res.status(403).json({ error: 'the refresh cadence is operator-only' });
      return;
    }
    try {
      if (Object.keys(deployment).length) await writeSettings(pool, DEPLOYMENT_SCOPE, deployment);
      if (Object.keys(user).length) await writeSettings(pool, sub, user);
      log.info({ sub, deployment: Object.keys(deployment), user: Object.keys(user) }, 'settings updated');
      res.json({ ok: true, deployment: await readSettings(pool, DEPLOYMENT_SCOPE), user: await readSettings(pool, sub) });
    } catch (err) {
      log.error({ err }, 'settings write failed');
      res.status(500).json({ error: 'could not save settings' });
    }
  });
}
