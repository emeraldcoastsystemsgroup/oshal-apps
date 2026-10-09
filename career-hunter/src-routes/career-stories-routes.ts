/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-141 D7 role-anchored story review: GET /stories reports every role with its stories and which role is next (with the question, built from that role's own bullets); POST /stories/answer attaches ONE story to ONE role from the candidate's own words. Both ride the engine's `stories` verb, so the profile write stays inside the leased child that owns the store.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | DELETE /stories/test-lab/:tag (1.26.0): remove only the caller's stories whose recorded answer starts with that acceptance run's Test Lab mark, through the engine's `stories remove-marked` in the same leased child. An automated live acceptance that answers the review with marked answers had no way to leave the owner's profile as it found it. A tag that marks nothing answers 404, so another user's tag reaches nothing.
 */

/**
 * The resume review conversation: one defensible story per job title.
 * @module career-stories-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { runCareerCliAwait } from './career-engine-dispatch';
import { parseEngineJson } from './career-targets';
import { callerSub } from './career-user-store';

const logger = createChildLogger({ module: 'career-stories' });

/** A spoken answer, not an essay — bounded so one turn cannot fill the store. */
const MAX_RESPONSE_CHARS = 6000;
/** An acceptance run's tag, the same grammar the engine's remove_marked accepts. */
const TEST_LAB_TAG = /^[a-z0-9][a-z0-9-]{5,63}$/;

/**
 * @description GET /stories — the review's state: every role with its stories, how many roles
 * still need one, and the next question. Read-only; it spends no tokens.
 * @param ctx - App context.
 * @param req - Express request.
 * @param res - Express response.
 */
async function listStories(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const result = await runCareerCliAwait(ctx.pool, userSub, ['stories', 'list'], {}, { slot: 'stories' });
  if (result.limitReason) {
    res.status(503).json({ error: result.limitReason === 'inflight' ? 'a review turn is already running' : 'engine busy' });
    return;
  }
  const json = result.ok ? parseEngineJson(result.out) : null;
  if (!json) {
    logger.error({ userSub, err: (result.err || '').slice(-200) }, 'career stories list failed');
    res.status(502).json({ error: 'the review is unavailable' });
    return;
  }
  res.json(json);
}

/**
 * @description POST /stories/answer — attach one story to one role. Awaited rather than detached
 * because the person is waiting to read back the story their answer became; the engine keeps the
 * answer either way, so a provider outage degrades to a verbatim story instead of a lost turn.
 * @param ctx - App context.
 * @param req - Express request.
 * @param res - Express response.
 */
async function answerStory(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const role = Number(req.body?.role);
  const response = String(req.body?.response || '').trim();
  if (!Number.isInteger(role) || role < 0) { res.status(400).json({ error: 'role index required' }); return; }
  if (!response) { res.status(400).json({ error: 'response required' }); return; }
  if (response.length > MAX_RESPONSE_CHARS) {
    res.status(400).json({ error: `response must be ${MAX_RESPONSE_CHARS} characters or fewer` });
    return;
  }

  const result = await runCareerCliAwait(
    ctx.pool, userSub, ['stories', 'answer', '--role', String(role), '--response', response], {}, { slot: 'stories' },
  );
  if (result.limitReason) {
    res.status(503).json({ error: result.limitReason === 'inflight' ? 'a review turn is already running' : 'engine busy' });
    return;
  }
  const json = result.ok ? parseEngineJson(result.out) : null;
  if (!json || json.ok !== true) {
    const error = typeof json?.error === 'string' ? json.error : 'the answer could not be recorded';
    logger.error({ userSub, role, error }, 'career story answer failed');
    res.status(json && typeof json.error === 'string' ? 400 : 502).json({ error });
    return;
  }
  logger.info({ userSub, role }, 'career story recorded');
  res.status(201).json(json);
}

/**
 * @description DELETE /stories/test-lab/:tag — remove only the caller's stories that an automated
 * acceptance run recorded with this tag's Test Lab mark. The engine matches the mark on the
 * recorded answer (the candidate's verbatim words), so an unmarked story, or one marked by another
 * run, is never touched; the caller's own profile is the only one the leased child can reach.
 * @param ctx - App context.
 * @param req - Express request.
 * @param res - Express response.
 */
async function removeMarkedStories(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tag = String(req.params?.tag || '');
  if (!TEST_LAB_TAG.test(tag)) { res.status(400).json({ error: 'tag must be 6-64 lowercase letters, digits or hyphens' }); return; }
  const result = await runCareerCliAwait(
    ctx.pool, userSub, ['stories', 'remove-marked', '--tag', tag], {}, { slot: 'stories' },
  );
  if (result.limitReason) {
    res.status(503).json({ error: result.limitReason === 'inflight' ? 'a review turn is already running' : 'engine busy' });
    return;
  }
  const json = result.ok ? parseEngineJson(result.out) : null;
  if (!json || json.ok !== true) {
    const error = typeof json?.error === 'string' ? json.error : 'the marked stories could not be removed';
    logger.error({ userSub, error }, 'career marked story removal failed');
    res.status(json && typeof json.error === 'string' ? 400 : 502).json({ error });
    return;
  }
  if (!Number(json.removed)) { res.status(404).json({ error: 'no story carries this Test Lab mark' }); return; }
  logger.info({ userSub, removed: json.removed }, 'career marked stories removed');
  res.json(json);
}

/**
 * @description Registers the story-review routes on the package router.
 * @param router - The package router (mounted at /api/career-hunter).
 * @param ctx - App context.
 */
export function registerCareerStoryRoutes(router: Router, ctx: AppContext): void {
  router.get('/stories', (req, res) => { void listStories(ctx, req, res); });
  router.post('/stories/answer', (req, res) => { void answerStory(ctx, req, res); });
  router.delete('/stories/test-lab/:tag', (req, res) => { void removeMarkedStories(ctx, req, res); });
}
