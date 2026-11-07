/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Authenticated SAT/ACT curriculum, practice, progress and lesson endpoints.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Publish curriculumVideos in GET /prep/catalog for the 168-topic video curriculum.
 */
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { resolveAuthedStudent } from './education-access';
import { sendStudyError } from './education-study-errors';
import { catalog, curriculumVideos, examOf, PrepError, publicSession, FORMATS, research, officialPractice } from './education-prep-model';
import { summarize } from './education-prep-progress';
import * as store from './education-prep-store';
import * as training from './education-prep-training';
const logger = createChildLogger({ module: 'education-prep' });
export function createEducationPrepRoutes(ctx: AppContext): Router {
  const router = Router();
  function endpoint(method: 'get' | 'post', path: string, action: (req: Request, actor: any) => Promise<any>) {
    router[method](path, async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      try {
        const actor = await resolveAuthedStudent(req, ctx.pool, { readOnly: true });
        res.json(await action(req, actor));
      } catch (error) {
        if (error instanceof PrepError) { res.status(error.status).json({ error: error.message }); return; }
        if (sendStudyError(res, error)) return;
        logger.error({ err: error }, 'Study Lab request failed');
        res.status(500).json({ error: 'Study Lab could not save or load your work. Please retry.' });
      }
    });
  }
  endpoint('get', '/prep/catalog', async () => ({ version: catalog.version, lessons: catalog.lessons, curriculumVideos, formats: FORMATS, research, officialPractice }));
  endpoint('get', '/prep/topics', async req => ({ topics: training.topics(examOf(req.query.exam || 'SAT'), typeof req.query.query === 'string' ? req.query.query : ''), studyUrl: '/api/education/test-prep' }));
  endpoint('get', '/prep/progress', async (req, actor) => {
    const exam = examOf(req.query.exam || 'SAT');
    const [rows, profile, active, packs] = await Promise.all([store.history(ctx.pool, actor), store.readProfile(ctx.pool, actor), store.activeSessions(ctx.pool, actor), training.listTraining(ctx.pool, actor, exam)]);
    const { seen, ...progress } = summarize(rows, exam, Date.now(), req.query.science === 'true');
    const recent = progress.history.slice(0, 5), count = recent.reduce((n: number, r: any) => n + r.count, 0);
    const method = research.strategies.find((s: any) => s.lessonId === progress.focus[0]?.id && s.sections[exam]);
    return { ...progress, profile, active: active.filter(s => s.exam === exam), training: packs,
      dashboard: { sessions: progress.history.length, activeMinutes: Math.round(progress.history.reduce((n: number, r: any) => n + r.activeSeconds, 0) / 60),
        recentAccuracy: count ? Math.round(recent.reduce((n: number, r: any) => n + r.correct, 0) / count * 100) : null,
        reviewedPacks: packs.filter(p => p.progress.completedAt).length },
      coach: { name: 'Test Prep Coach', message: !progress.history.length ? 'Start with the diagnostic. We will use your answers and pace to choose your next step.' :
        progress.focus[0] ? `Focus on ${progress.focus[0].title.toLowerCase()}: ${progress.focus[0].reason}.` : 'Your sampled skills are ready for a mixed practice set.',
        topicId: method?.id || null, tip: method?.shortcut || null, caution: method?.caution || null },
      studyUrl: '/api/education/test-prep' };
  });
  endpoint('get', '/prep/answers', async (req, actor) => ({ answers: await store.answerHistory(ctx.pool, actor, examOf(req.query.exam || 'SAT'), typeof req.query.skill === 'string' ? req.query.skill : undefined), window: 'Latest 200 graded answers for the selected exam and optional skill.' }));
  endpoint('post', '/prep/profile', async (req, actor) => ({ profile: await store.saveProfile(ctx.pool, actor, req.body || {}), studyUrl: '/api/education/test-prep' }));
  endpoint('post', '/prep/launch', async (req, actor) => {
    examOf(req.body?.exam);
    const r = await store.startSession(ctx.pool, actor, req.body || {}, true);
    return { sessionId: r.session_id, exam: r.state.exam, mode: r.state.mode, status: r.state.status,
      questionCount: r.state.blocks.reduce((n, b) => n + b.questions.length, 0),
      practiceUrl: `/api/education/test-prep?session=${r.session_id}`, message: 'Saved and ready. The clock starts when you press Begin practice.' };
  });
  endpoint('get', '/prep/training', async (req, actor) => ({ training: await training.listTraining(ctx.pool, actor, examOf(req.query.exam || 'SAT')) }));
  endpoint('post', '/prep/training', async (req, actor) => {
    const user = (req as any).oidc?.user, sub = user?.sub || user?.oid;
    if (!sub) throw new PrepError('Not authenticated.', 401);
    return training.createTraining(ctx, actor, String(sub), req.body || {});
  });
  endpoint('get', '/prep/training/:trainingId', async (req, actor) => training.getTraining(ctx.pool, actor, String(req.params.trainingId)));
  endpoint('post', '/prep/training/:trainingId', async (req, actor) => training.updateTraining(ctx.pool, actor, String(req.params.trainingId), req.body || {}));
  endpoint('post', '/prep/sessions', async (req, actor) => {
    examOf(req.body?.exam);
    const r = await store.startSession(ctx.pool, actor, req.body || {});
    return publicSession(r.state, r.session_id, r.revision, Date.now());
  });
  endpoint('get', '/prep/sessions/:sessionId', async (req, actor) => {
    const r = await store.getSession(ctx.pool, actor, String(req.params.sessionId));
    return publicSession(r.state, r.session_id, r.revision, Date.now());
  });
  endpoint('post', '/prep/sessions/:sessionId', async (req, actor) => {
    const r = await store.updateSession(ctx.pool, actor, String(req.params.sessionId), req.body || {});
    return publicSession(r.state, r.session_id, r.revision, Date.now());
  });
  return router;
}
