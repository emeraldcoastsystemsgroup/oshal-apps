/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped resume indexing and board onboarding state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Read durable child lifecycle status so an existing profile cannot clear a pending re-upload marker.
 */

/**
 * Resume and board onboarding state routes.
 * @module career-onboarding-routes
 */
import { type Request, type Response, type Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { createChildLogger } from '@/shared/logger';
import { callerSub, openUserDb, userPaths } from './career-user-store';
import { readResumeIngestState } from './career-resume-upload';

const logger = createChildLogger({ module: 'career-onboarding-routes' });

interface ResumeState {
  hasResume: boolean;
  roles: number;
  name: string;
}

async function readResumeState(userDir: string): Promise<ResumeState> {
  const careerDb = path.join(userDir, 'career_db.json');
  try {
    const data = JSON.parse(await fs.readFile(careerDb, 'utf8')) as Record<string, any>;
    const roles = Array.isArray(data.roles) ? data.roles.length : 0;
    const name = data.profile?.name || '';
    const hasResume = roles > 0 || !!data.profile?.experience_summary;
    return { hasResume, roles, name };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { hasResume: false, roles: 0, name: '' };
    logger.error({ err }, 'career onboarding profile is unreadable');
    return { hasResume: false, roles: 0, name: '' };
  }
}

function countScoredJobs(userSub: string): number {
  try {
    const db = openUserDb(userSub);
    if (!db) return 0;
    try {
      const row = db.prepare(
        'SELECT COUNT(*) AS n FROM user_signals WHERE ai_fit_score IS NOT NULL',
      ).get() as { n?: number };
      return row?.n || 0;
    } finally { db.close(); }
  } catch (err) {
    logger.error({ err, userSub }, 'career scored-job count failed');
    return 0;
  }
}

async function getResumeState(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const { userDir } = userPaths(userSub);
  const [resume, ingest] = await Promise.all([
    readResumeState(userDir), readResumeIngestState(userSub),
  ]);
  res.json({
    ...resume,
    indexing: ingest.state === 'pending',
    ingest,
    scored: countScoredJobs(userSub),
  });
}

/**
 * @description Registers the resume-indexing and scored-board onboarding state route.
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
export function registerCareerOnboardingRoutes(router: Router): void {
  router.get('/resume/state', getResumeState);
}
