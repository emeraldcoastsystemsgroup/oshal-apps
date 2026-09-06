/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-141 per-user readiness for the Intelligent Career group's setup dashboard: GET /readiness answers `stories` (how many of the caller's roles carry a story — read from the profile the review conversation will write, so it reports "0 of N" honestly until ADR-141 D7 ships) and `materials` (documents the caller has added under uploads/artifacts). Reads the caller's OWN store only; nothing is cached, nothing spends a token.
 */

/**
 * Per-user readiness probes (ADR-141 D3). The kernel setup dashboard asks these in the signed-in
 * user's session; a step is done only when the pointer resolves to boolean true.
 * @module career-readiness
 */
import { type Request, type Response, type Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { createChildLogger } from '@/shared/logger';
import { callerSub, userPaths } from './career-user-store';

const logger = createChildLogger({ module: 'career-readiness' });

interface StoriesReadiness { ready: boolean; roles: number; withStory: number; detail: string }
interface MaterialsReadiness { ready: boolean; count: number; detail: string }

/**
 * @description How many of the caller's roles carry at least one story (`roles[].stories[]`) — the
 * evidence the story-by-story review leaves behind. Reads the same career profile Strengthen and the
 * generators read, so the count is what the profile actually holds.
 * @param userDir - The caller's isolated store directory.
 * @returns The stories readiness.
 */
export async function readStoriesReadiness(userDir: string): Promise<StoriesReadiness> {
  let roles: Array<Record<string, unknown>> = [];
  try {
    const data = JSON.parse(await fs.readFile(path.join(userDir, 'career_db.json'), 'utf8')) as { roles?: unknown };
    roles = Array.isArray(data.roles) ? data.roles.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err }, 'career profile unreadable for stories readiness');
  }
  const withStory = roles.filter((r) => Array.isArray(r.stories) && r.stories.some((s) => !!s)).length;
  const ready = roles.length > 0 && withStory === roles.length;
  const detail = roles.length === 0
    ? 'Index a resume first — the review walks your roles one by one.'
    : `${withStory} of ${roles.length} roles have a story.`;
  return { ready, roles: roles.length, withStory, detail };
}

/**
 * @description How many documents the caller has added (uploads/artifacts — performance reports,
 * anything sent to Career through "Add to Career profile"). Counts regular files only.
 * @param userDir - The caller's isolated store directory.
 * @returns The materials readiness.
 */
export async function readMaterialsReadiness(userDir: string): Promise<MaterialsReadiness> {
  let count = 0;
  try {
    const dir = await fs.opendir(path.join(userDir, 'uploads', 'artifacts'));
    for await (const entry of dir) if (entry.isFile() && !entry.name.startsWith('.')) count += 1;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err }, 'career artifacts unreadable for materials readiness');
  }
  const detail = count === 0
    ? 'Nothing added yet — performance reports, project write-ups, anything that shows your work.'
    : `${count} document${count === 1 ? '' : 's'} added to your profile.`;
  return { ready: count > 0, count, detail };
}

/**
 * @description Registers GET /readiness — the probes the Intelligent Career group's setup steps
 * "Review your resume story by story" and "Add performance reports and other documents" read.
 * @param router - The package router (mounted at /api/career-hunter).
 */
export function registerCareerReadinessRoutes(router: Router): void {
  router.get('/readiness', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const { userDir } = userPaths(userSub);
    try {
      const [stories, materials] = await Promise.all([readStoriesReadiness(userDir), readMaterialsReadiness(userDir)]);
      res.json({ stories, materials });
    } catch (err) {
      logger.error({ err, userSub }, 'career readiness failed');
      res.status(500).json({ error: 'readiness unavailable' });
    }
  });
}
