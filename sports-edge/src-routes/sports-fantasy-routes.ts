/**
 * Fantasy routes — /api/sports-edge/fantasy.
 *
 * THE CREDENTIAL RULE, and it governs every handler here: the caller's ESPN cookies are resolved
 * from the connector broker at the top of a request, used on exactly the outbound calls that need
 * them, and discarded. They are never logged, never returned in a response, never written to a
 * table, and never placed where a model could read them. `getValidAccessToken` is the only way in,
 * and a caller with no connection gets an honest "not connected" rather than an empty roster.
 *
 * The public projection feed needs no credential at all and is shared by everyone, so it is cached
 * per (season, week) and refreshed on a slow cadence — ESPN returns ~39MB and ignores the filter
 * header, so this can never be a per-request fetch.
 *
 * EVERY RECOMMENDATION IS REGISTERED BEFORE KICKOFF. `GET /lineup` does not just answer a question;
 * it writes what it advised into the ledger so it can be graded later against what the benched
 * player actually scored. That is the same discipline the rest of this package runs on: a call
 * nobody records is a call that never has to be right.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — connection status, league link/unlink with the caller's own team resolved from their SWID, the lineup advisor (optimal lineup + start/sit, registered before kickoff), the graded record, and the shared projection refresh.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Optimise the lineup against THIS WEEK'S OPPONENT rather than against the field. The week's fixture is read, the opponent's own best lineup is projected from the same feed, and the recommendation maximises P(win) instead of the projected total — which starts the volatile player when you are an underdog and the steady one when you are favoured. The highest-projected lineup is still computed and returned beside it, so a recommendation that gives up projected points has to show what it bought.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Tell an unreachable ESPN apart from an unconnected caller. A league read that never reached ESPN answered 403 "Connect ESPN Fantasy to read a private league.", which on 2026-09-09 sent an operator whose resolver was down to re-paste cookies that were already correct; it now answers 503 naming the transport, and only a refusal keeps the credential message. Same fix one layer up: the response says WHY there is no opponent, so a failed schedule read cannot render as a bye.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Feed the spread model real weekly scores. The refresh now stores every completed week the same response already carried, and the lineup reads the caller's roster and their opponent's out of that table, scores each week under the league's own rules, and hands it to the optimiser. Until now `pointsHistory` had no producer anywhere in the package, so every spread was a positional prior times a projection and two similar players were modelled as equally volatile — which is exactly why the first live run produced zero variance swaps.
 *
 * @module sports-fantasy-routes
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { callerSub } from '@/app/routes/trading-routes-helpers';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { getJson, type EspnFailure, type EspnOptions } from './sports-espn';
import {
  fetchProjections, findOwnTeam, opponentOutcomeFor, parseCredential, readLeagueSettings,
  readLeagueSettingsOutcome, readMatchupsOutcome, readTeams, type FantasyCredential,
  type FantasyTeam, type LeagueSettings, type MatchupsRead,
} from './sports-fantasy-espn';
import { lineupMoments, optimiseForWin, type LineupMoments, type WeighedPlayer } from './sports-fantasy-winprob';
import { historyFor, joinRoster } from './sports-fantasy-roster';
import { optimiseLineup, startSitCalls, type FantasyPlayer } from './sports-fantasy-scoring';
import {
  ensureFantasySchema, fantasyRecord, gradeCall, linkLeague, listCalls, listLeagues, openCalls,
  readPlayerWeeks, readProjections, recordCalls, unlinkLeague, writePlayerWeeks, writeProjections,
} from './sports-fantasy-store';
import { applyScoring } from './sports-fantasy-scoring';
import { currentSeason } from './sports-refresh';

const log = createChildLogger({ module: 'sports-fantasy-routes' });

/** HTTP options. A failed read logs at warn — the box runs at info, so debug would be invisible. */
const espn: EspnOptions = {
  log: (event, fields) => (event === 'espn.request.ok' ? log.debug(fields, event) : log.warn(fields, event)),
  timeoutMs: 25_000,
};

/** Hours before the shared projection cache is considered stale enough to refetch. */
const PROJECTION_MAX_AGE_HOURS = 6;

/** Guards the ~39MB refresh so concurrent callers cannot start several at once. */
let refreshing: Promise<number> | null = null;

/**
 * @description Resolve the caller's ESPN cookies, or null when they have not connected. The secret
 * never leaves this function except as the parsed credential handed straight to a bounded read.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @returns The credential, or null.
 */
async function credentialFor(pool: Pool, sub: string): Promise<FantasyCredential | null> {
  const secret = await getValidAccessToken(pool, sub, 'espn-fantasy').catch(() => null);
  return parseCredential(secret);
}

/**
 * @description Answer a league read that never reached ESPN, or reached it and got a 5xx. Neither
 * is a credential problem, and the credential message is actively harmful advice for both — it
 * sends someone to re-paste account cookies that were never the fault. A refusal is left alone:
 * that one IS about the request, and the caller answers it in its own terms.
 * @param res - The response to answer on.
 * @param failure - The classified failure, or null when the read simply returned nothing.
 * @returns True when the failure was answered here and the caller should stop.
 */
function answerUnreachable(res: Response, failure: EspnFailure | null): boolean {
  if (!failure || failure.kind === 'refused') return false;
  const error = failure.kind === 'unavailable'
    ? `Could not reach ESPN for that league — it answered ${failure.reason}. ESPN's fantasy API is failing, `
      + 'not your ESPN account, so there is nothing to re-paste; try again shortly.'
    : `Could not reach ESPN at all (${failure.reason}). That is a network fault between this swarm and `
      + 'ESPN, not your ESPN account — check connectivity, starting with DNS, rather than re-pasting cookies.';
  res.status(503).json({ error, reason: failure.kind, espnStatus: failure.status });
  return true;
}

/** Resolves the caller or answers 401. */
function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: 'authentication required' }); return null; }
  return sub;
}

/** Parses a season, defaulting to the current NFL season. */
function seasonOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 2100 ? n : currentSeason('nfl');
}

/**
 * @description Read the shared projection cache, refreshing it when missing or stale. Single-flighted
 * so a burst of callers triggers one fetch, not several ~39MB ones.
 * @param pool - Postgres pool.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns Players keyed by id (possibly empty when ESPN is unreachable) and the cache age.
 */
async function projectionsFor(
  pool: Pool, season: number, week: number,
): Promise<{ players: Record<number, FantasyPlayer>; generatedAt: string | null }> {
  const cached = await readProjections(pool, season, week);
  const ageHours = cached ? (Date.now() - Date.parse(cached.generatedAt)) / 3600000 : Infinity;
  if (cached && ageHours < PROJECTION_MAX_AGE_HOURS) {
    return { players: cached.players as Record<number, FantasyPlayer>, generatedAt: cached.generatedAt };
  }
  if (!refreshing) {
    refreshing = (async () => {
      const started = Date.now();
      const { players, weeks } = await fetchProjections(season, week, espn);
      if (Object.keys(players).length) await writeProjections(pool, season, week, players, Date.now() - started);
      // The completed weeks came back in the SAME response, so accumulating them costs no extra
      // read. They are what turns a spread from a positional prior into a measurement.
      const stored = weeks.length ? await writePlayerWeeks(pool, season, weeks) : 0;
      log.info({
        season, week, players: Object.keys(players).length, playerWeeks: stored, ms: Date.now() - started,
      }, 'projection feed refreshed');
      return Object.keys(players).length;
    })().finally(() => { refreshing = null; });
  }
  await refreshing.catch((err) => log.error({ err }, 'projection refresh failed'));
  const fresh = await readProjections(pool, season, week);
  // A stale cache still beats nothing when ESPN is down — say so rather than answering empty.
  const use = fresh || cached;
  return {
    players: (use?.players || {}) as Record<number, FantasyPlayer>,
    generatedAt: use?.generatedAt || null,
  };
}

/**
 * @description The opponent's own best lineup, as moments. This is deliberately THEIR optimal lineup
 * rather than the one they have currently set: a lineup read hours before kickoff is half-made, and
 * assuming an opponent will field their best team is the only assumption that cannot flatter us.
 * @param opponent - The opposing team, or null when the schedule gave no opponent.
 * @param projections - The shared projection feed.
 * @param settings - The league's rules.
 * @param history - Weekly point totals per player id, so their spreads are measured too.
 * @returns Their moments, or null when there is nobody to play.
 */
function opponentMoments(
  opponent: FantasyTeam | null,
  projections: Record<number, FantasyPlayer>,
  settings: LeagueSettings,
  history: Map<number, number[]>,
): LineupMoments | null {
  if (!opponent) return null;
  const roster = joinRoster(opponent.entries, projections, history);
  const best = optimiseLineup(roster, settings.slots, settings.scoring);
  return lineupMoments(best.starters.map((a) => a.player as WeighedPlayer), settings.scoring);
}

/**
 * @description Mount the fantasy routes onto the package router.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
export function registerFantasyRoutes(router: Router, pool: Pool): void {
  ensureFantasySchema(pool).catch((err) => log.error({ err }, 'fantasy schema ensure failed'));

  router.get('/fantasy/status', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      const cred = await credentialFor(pool, sub);
      const season = seasonOf(req.query.season);
      res.json({
        connected: Boolean(cred),
        // The SWID identifies the account and is not a secret; espn_s2 is NEVER returned.
        swid: cred?.swid || null,
        season,
        leagues: await listLeagues(pool, sub),
        connectHint: cred ? null : 'Connect ESPN Fantasy on the connectors page: SWID in the account field, espn_s2 as the token.',
      });
    } catch (err) {
      log.error({ err }, 'fantasy status failed');
      res.status(500).json({ error: 'could not read fantasy status' });
    }
  });

  router.post('/fantasy/link', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const season = seasonOf(req.body?.season);
    const leagueId = String(req.body?.leagueId || '').trim();
    if (!/^\d+$/.test(leagueId)) { res.status(400).json({ error: 'leagueId must be the numeric id from your league URL' }); return; }
    try {
      const cred = await credentialFor(pool, sub);
      const { settings, failure } = await readLeagueSettingsOutcome(season, leagueId, cred, espn);
      if (!settings) {
        if (answerUnreachable(res, failure)) return;
        res.status(cred ? 404 : 403).json({
          error: cred
            ? 'ESPN would not return that league — check the id and season, and that this ESPN account is in it.'
            : 'That league is private. Connect ESPN Fantasy first, then link it.',
        });
        return;
      }
      const teams = await readTeams(season, leagueId, settings.scoringPeriodId, cred, espn);
      const own = cred ? findOwnTeam(teams, cred.swid) : null;
      await linkLeague(pool, sub, {
        season, leagueId, leagueName: settings.name,
        teamId: own?.teamId ?? null, teamName: own?.name ?? null,
      });
      log.info({ sub, season, leagueId, teams: teams.length, ownTeam: own?.teamId ?? null }, 'fantasy league linked');
      res.json({ ok: true, league: settings.name, teamName: own?.name || null, teams: teams.length, leagues: await listLeagues(pool, sub) });
    } catch (err) {
      log.error({ err, season, leagueId }, 'fantasy link failed');
      res.status(502).json({ error: 'could not reach ESPN to link that league' });
    }
  });

  router.delete('/fantasy/leagues/:season/:leagueId', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      const removed = await unlinkLeague(pool, sub, seasonOf(req.params.season), String(req.params.leagueId));
      res.json({ ok: true, removed, leagues: await listLeagues(pool, sub) });
    } catch (err) {
      log.error({ err }, 'fantasy unlink failed');
      res.status(500).json({ error: 'could not unlink that league' });
    }
  });

  registerLineupRoute(router, pool);
  registerRecordRoutes(router, pool);
}

/**
 * @description The lineup advisor: the optimal legal lineup for the caller's team, the swaps that
 * would get them there, and a record of having said so before kickoff.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerLineupRoute(router: Router, pool: Pool): void {
  router.get('/fantasy/lineup', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const season = seasonOf(req.query.season);
    const leagueId = String(req.query.leagueId || '').trim();
    if (!leagueId) { res.status(400).json({ error: 'leagueId is required' }); return; }
    const started = Date.now();
    try {
      const cred = await credentialFor(pool, sub);
      const { settings, failure } = await readLeagueSettingsOutcome(season, leagueId, cred, espn);
      if (!settings) {
        // A read that never reached ESPN is not a missing credential, and must not be answered as one.
        if (answerUnreachable(res, failure)) return;
        res.status(cred ? 404 : 403).json({
          error: cred ? 'ESPN would not return that league right now.' : 'Connect ESPN Fantasy to read a private league.',
        });
        return;
      }
      const week = Number(req.query.week) || settings.scoringPeriodId;
      const teams = await readTeams(season, leagueId, week, cred, espn);
      const own = cred ? findOwnTeam(teams, cred.swid) : null;
      if (!own) { res.status(404).json({ error: 'no team in that league belongs to this ESPN account' }); return; }

      const { players, generatedAt } = await projectionsFor(pool, season, week);
      // Who you play decides the objective. A failed schedule read is not fatal — it degrades to the
      // highest-projected lineup, which is what this route did before it could see an opponent.
      const schedule = await readMatchupsOutcome(season, leagueId, cred, espn)
        .catch((): MatchupsRead => ({ matchups: [], failure: null }));
      const fixture = opponentOutcomeFor(schedule.matchups, own.teamId, week);
      const opponent = fixture.opponentTeamId === null
        ? null : teams.find((t) => t.teamId === fixture.opponentTeamId) || null;
      // Both rosters' completed weeks in one read, scored under THIS league's rules. Strictly before
      // the week being set: the current week is in progress, and a player who has not kicked off yet
      // would enter the history as a zero.
      const history = historyFor(
        await readPlayerWeeks(pool, season, week,
          [...own.rosterPlayerIds, ...(opponent?.rosterPlayerIds || [])]).catch(() => []),
        settings.scoring,
      );
      const roster = joinRoster(own.entries, players, history);
      const theirs = opponentMoments(opponent, players, settings, history);
      const win = optimiseForWin(roster, settings.slots, settings.scoring, theirs);
      const optimal = win.lineup;
      const calls = startSitCalls(own.startingPlayerIds, optimal, settings.scoring, roster);
      // Registered BEFORE kickoff so the advice can be graded, not just given.
      const registered = await recordCalls(pool, sub, season, leagueId, week, calls);

      log.info({
        sub, season, leagueId, week, roster: roster.length, calls: calls.length, registered,
        playersWithHistory: roster.filter((p) => p.pointsHistory?.length).length,
        opponentTeamId: opponent?.teamId ?? null, posture: theirs ? win.posture : 'no-opponent',
        winProbability: theirs ? win.winProbability : null, varianceSwaps: win.swaps.length,
        ms: Date.now() - started,
      }, 'lineup served');
      res.json({
        league: { name: settings.name, leagueId, season, week },
        team: { teamId: own.teamId, name: own.name },
        scoringRules: settings.scoring.length,
        slots: settings.slots,
        optimal,
        calls,
        matchup: {
          opponentTeamId: opponent?.teamId ?? null,
          opponentName: opponent?.name ?? null,
          // WHY there is no opponent. A bye, a week the schedule does not cover, and a schedule
          // nobody could read all produce the same empty matchup, and the surface was calling all
          // three a bye — a wrong reason attached to a lineup that is otherwise still correct.
          opponentReason: opponent ? 'opponent' : (schedule.failure ? 'unreadable' : fixture.reason),
          scheduleError: schedule.failure ? schedule.failure.reason : null,
          opponentProjected: theirs?.mean ?? null,
          opponentSpread: theirs?.sd ?? null,
          yourProjected: win.moments.mean,
          yourSpread: win.moments.sd,
          winProbability: theirs ? win.winProbability : null,
          // What playing the highest-projected lineup would have won instead. The pair is the whole
          // argument: if these are equal the objectives agree and nothing was given up.
          meanWinProbability: theirs ? win.meanWinProbability : null,
          posture: theirs ? win.posture : null,
          swaps: win.swaps,
          meanFallback: win.meanFallback,
        },
        meanOptimal: win.meanLineup,
        currentTotal: currentLineupTotal(own.startingPlayerIds, roster, settings),
        projectionsGeneratedAt: generatedAt,
        projectionsAvailable: Object.keys(players).length,
      });
    } catch (err) {
      log.error({ err, season, leagueId }, 'lineup failed');
      res.status(502).json({ error: 'could not build the lineup' });
    }
  });
}

/**
 * @description What the lineup the manager actually set is projected to score, so the optimal total
 * has something to be compared against.
 * @param startingIds - Player ids currently started.
 * @param roster - The whole roster.
 * @param settings - The league's rules.
 * @returns Projected points for the lineup as set.
 */
function currentLineupTotal(startingIds: number[], roster: FantasyPlayer[], settings: LeagueSettings): number {
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  let total = 0;
  for (const id of startingIds) {
    const p = byId.get(id);
    if (p) total += applyScoring(p.projectedStats, settings.scoring);
  }
  return Math.round(total * 100) / 100;
}

/**
 * @description The graded record and the raw ledger — what this advisor claimed, and what it was
 * actually worth.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerRecordRoutes(router: Router, pool: Pool): void {
  router.get('/fantasy/record', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    try {
      res.json({
        record: await fantasyRecord(pool, sub),
        calls: await listCalls(pool, sub, Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)),
      });
    } catch (err) {
      log.error({ err }, 'fantasy record failed');
      res.status(500).json({ error: 'could not read the fantasy record' });
    }
  });

  router.post('/fantasy/grade', async (req: Request, res: Response) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const season = seasonOf(req.body?.season);
    try {
      res.json({ ok: true, graded: await gradeDueCalls(pool, season) });
    } catch (err) {
      log.error({ err, season }, 'fantasy grading failed');
      res.status(502).json({ error: 'could not grade the outstanding calls' });
    }
  });
}

/**
 * @description Grade every registered call from a completed week against what the two players
 * actually scored under that league's rules. Scoring rules are read per league because two managers
 * can be advised on the same swap in leagues that price it differently.
 * @param pool - Postgres pool.
 * @param season - Season year.
 * @returns How many calls were graded.
 */
export async function gradeDueCalls(pool: Pool, season: number): Promise<number> {
  const nowWeek = await currentWeek(season);
  const open = await openCalls(pool, season, nowWeek);
  if (!open.length) return 0;
  const feeds = new Map<number, Record<number, FantasyPlayer>>();
  const rules = new Map<string, LeagueSettings | null>();
  let graded = 0;
  for (const call of open) {
    if (!feeds.has(call.week)) {
      const cached = await readProjections(pool, season, call.week);
      feeds.set(call.week, (cached?.players || {}) as Record<number, FantasyPlayer>);
    }
    const feed = feeds.get(call.week) as Record<number, FantasyPlayer>;
    const starter = feed[call.startPlayerId];
    const benched = feed[call.sitPlayerId];
    // No actuals yet means the week's feed has not caught up; try again next pass.
    if (!starter?.actualStats && !benched?.actualStats) continue;
    const key = `${call.leagueId}`;
    if (!rules.has(key)) {
      const cred = await credentialFor(pool, call.userSub);
      rules.set(key, await readLeagueSettings(season, call.leagueId, cred, espn));
    }
    const settings = rules.get(key);
    if (!settings) continue;
    await gradeCall(
      pool, call.id,
      applyScoring(starter?.actualStats, settings.scoring),
      applyScoring(benched?.actualStats, settings.scoring),
    );
    graded += 1;
  }
  if (graded) log.info({ season, graded }, 'fantasy calls graded');
  return graded;
}

/**
 * @description ESPN's current scoring period for a season, read from the season metadata endpoint
 * (which needs no credential).
 * @param season - Season year.
 * @returns The current week, defaulting to 1 when unavailable.
 */
async function currentWeek(season: number): Promise<number> {
  const body = await getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}`, espn);
  return Number(body?.currentScoringPeriod?.id) || 1;
}
