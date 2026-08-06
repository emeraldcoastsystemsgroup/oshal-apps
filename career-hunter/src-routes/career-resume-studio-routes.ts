/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Added structured resume loading, bot-guided edits, persistence, and PDF rerendering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Routed guide turns through the agentic Career bot execution contract.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Awaited PDF rerenders through the asynchronous engine boundary.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Returned shared admission failures for busy or duplicate rerenders.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Added complete packet and signal-path rollback under the retained user-store lease.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Split the route registrar into bounded load, guide, and save handlers.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Moved packet discovery, reads, writes, snapshots, and rollback off synchronous filesystem APIs.
 */

/**
 * Career Resume Studio â€” the bot-guided live resume editor.
 *
 * Reasoning runs on the Career bot. The controller owns only caller-scoped packet reads,
 * structured edits, transactional rerendering, and exact rollback when rendering fails.
 * @module career-resume-studio-routes
 */
import { type Request, type Response, type Router } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import type { AppContext } from '@/app/composition/app-context';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineClaim, rejectEngineStart } from './career-engine-response';
import { releaseRun, tryAcquireRun, type RunLease } from './career-engine-runner';
import {
  restoreFilesAsync,
  snapshotFilesAsync,
  writeFileAtomicAsync,
  type FileSnapshot,
} from './career-file-transaction';
import { callerSub, openUserDb, userPaths } from './career-user-store';

const logger = createChildLogger({ module: 'career-resume-studio-routes' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

type ResumeAction =
  | { op: 'set_headline'; text: string }
  | { op: 'set_summary'; text: string }
  | { op: 'set_clearance'; text: string }
  | { op: 'set_competencies'; items: string[] }
  | { op: 'set_skills'; items: string[] }
  | {
      op: 'update_experience';
      index: number;
      title?: string;
      org?: string;
      span?: string;
      bullets?: string[];
    }
  | { op: 'set_cover_paragraphs'; items: string[] };

interface ResumeDocument {
  resume: Record<string, unknown>;
  cover: Record<string, unknown>;
  meta: Record<string, unknown>;
}

interface SignalPathSnapshot {
  resumePath: string | null;
  coverPath: string | null;
}

const RENDERED_PACKET_FILES = [
  'application.json',
  'Resume_ATS.html',
  'Resume_ATS.pdf',
  'Resume_Premium.html',
  'Resume_Premium.pdf',
  'Resume_1page.html',
  'Resume_1page.pdf',
  'CoverLetter.html',
  'CoverLetter.pdf',
];

async function hasApplicationPacket(appsDir: string, entryName: string): Promise<boolean> {
  try {
    await fs.access(path.join(appsDir, entryName, 'application.json'));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error({ err, entryName }, 'resume packet accessibility check failed');
    }
    return false;
  }
}

async function packetDir(userSub: string, postingId: number): Promise<string | null> {
  const appsDir = path.join(userPaths(userSub).userDir, 'applications');
  const suffix = `__${postingId}`;
  try {
    const entries = await fs.readdir(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()
        && entry.name.endsWith(suffix)
        && await hasApplicationPacket(appsDir, entry.name)) {
        return path.join(appsDir, entry.name);
      }
    }
    return null;
  } catch (err) {
    logger.error({ err, userSub, postingId }, 'resume packet directory scan failed');
    return null;
  }
}

async function readDoc(dir: string): Promise<ResumeDocument> {
  const data = JSON.parse(
    await fs.readFile(path.join(dir, 'application.json'), 'utf8'),
  ) as Record<string, unknown>;
  const generated = (data.generated || {}) as {
    resume?: Record<string, unknown>;
    cover?: Record<string, unknown>;
  };
  return {
    resume: generated.resume || {},
    cover: generated.cover || {},
    meta: {
      postingId: data.posting_id,
      company: data.company,
      title: data.title,
      url: data.url,
      include_oshal: data.include_oshal,
    },
  };
}

async function writeDoc(dir: string, resume: unknown, cover: unknown): Promise<void> {
  const filePath = path.join(dir, 'application.json');
  const data = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
  const generated = (data.generated || {}) as Record<string, unknown>;
  data.generated = { ...generated, resume, cover };
  await writeFileAtomicAsync(filePath, JSON.stringify(data, null, 2));
}

function pointPacketPaths(
  userSub: string,
  postingId: number,
  dir: string,
): SignalPathSnapshot | null {
  const db = openUserDb(userSub, false);
  if (!db) return null;
  try {
    const previous = db.prepare(
      'SELECT resume_path, cover_path FROM user_signals WHERE posting_id=?',
    ).get(postingId) as {
      resume_path?: string | null;
      cover_path?: string | null;
    } | undefined;
    if (!previous) return null;
    db.prepare('UPDATE user_signals SET resume_path=?, cover_path=? WHERE posting_id=?')
      .run(path.join(dir, 'Resume_ATS.pdf'), path.join(dir, 'CoverLetter.pdf'), postingId);
    return {
      resumePath: previous.resume_path ?? null,
      coverPath: previous.cover_path ?? null,
    };
  } finally { db.close(); }
}

function restorePacketPaths(
  userSub: string,
  postingId: number,
  previous: SignalPathSnapshot | null,
): void {
  if (!previous) return;
  const db = openUserDb(userSub, false);
  if (!db) throw new Error('resume path rollback database unavailable');
  try {
    db.prepare('UPDATE user_signals SET resume_path=?, cover_path=? WHERE posting_id=?')
      .run(previous.resumePath, previous.coverPath, postingId);
  } finally { db.close(); }
}

async function rollbackPacket(
  snapshots: FileSnapshot[],
  userSub: string,
  postingId: number,
  previousPaths: SignalPathSnapshot | null,
): Promise<void> {
  const failures: unknown[] = [];
  try { await restoreFilesAsync(snapshots); }
  catch (err) { logger.error({ err, postingId }, 'resume file rollback failed'); failures.push(err); }
  try { restorePacketPaths(userSub, postingId, previousPaths); }
  catch (err) { logger.error({ err, postingId }, 'resume path rollback failed'); failures.push(err); }
  if (failures.length) throw new AggregateError(failures, 'resume packet rollback failed');
}

async function saveAndRerenderPacket(
  ctx: AppContext,
  userSub: string,
  postingId: number,
  dir: string,
  resume: unknown,
  cover: unknown,
  lease: RunLease,
): Promise<Awaited<ReturnType<typeof runCareerCliAwait>>> {
  const paths = RENDERED_PACKET_FILES.map((name) => path.join(dir, name));
  const snapshots = await snapshotFilesAsync(paths);
  let previousPaths: SignalPathSnapshot | null = null;
  let committed = false;
  try {
    await writeDoc(dir, resume, cover);
    previousPaths = pointPacketPaths(userSub, postingId, dir);
    const result = await runCareerCliAwait(ctx.pool, userSub, ['rerender'], {
      CH_JOB: String(postingId),
    }, { preclaimed: lease });
    committed = result.ok;
    return result;
  } finally {
    if (!committed) await rollbackPacket(snapshots, userSub, postingId, previousPaths);
  }
}

function guidePrompt(
  message: string,
  resume: Record<string, unknown>,
  cover: Record<string, unknown>,
  meta: Record<string, unknown>,
  history: string,
): string {
  return [
    'You are editing the candidate\'s tailored RESUME + COVER LETTER for a specific job, in a live editor.',
    `Target role: ${String(meta.title || '')} at ${String(meta.company || '')}.`,
    '',
    'HARD TRUTH RULES (never violate): edit ONLY the facts already present â€” NEVER invent or add an',
    'employer, title, date, metric, skill, certification, clearance, or claim. You may reorder, sharpen,',
    'reword, and re-emphasize. Real titles only (exactly as they appear in the profile),',
    'never inflated to CTO/VP/Chief unless the profile says so. Player-coach voice ("led the team',
    'that built", "led the effort"), never "I built X" as if solo. First person implied, no third-person pronoun or name.',
    'NEVER use em or en dashes. Keep bullets to 1-2 lines, strong past-tense lead verbs, outcome first.',
    '',
    'CURRENT RESUME (JSON):', JSON.stringify(resume).slice(0, 12000),
    'CURRENT COVER (JSON):', JSON.stringify(cover).slice(0, 4000),
    history ? `\nCONVERSATION SO FAR:\n${history}` : '',
    `\nUSER: ${message}`,
    '',
    'Reply with ONLY a JSON object (no prose, no code fences):',
    '{"reply":"<one short conversational sentence>","actions":[ ...zero or more edits... ]}',
    'Allowed actions (use the minimal set that satisfies the request):',
    '- {"op":"set_headline","text":"..."}',
    '- {"op":"set_summary","text":"3-4 sentence executive summary"}',
    '- {"op":"set_clearance","text":"exact clearance as already stated"}',
    '- {"op":"set_competencies","items":["8-12 short phrases"]}',
    '- {"op":"set_skills","items":["concise skills"]}',
    '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]}',
    '- {"op":"set_cover_paragraphs","items":["exactly 3 tight paragraphs, under ~230 words total"]}',
  ].join('\n');
}

function toStrings(value: unknown, count = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, count)
    .map((item) => String(item ?? '').slice(0, 600))
    .filter(Boolean);
}

function experienceAction(raw: Record<string, unknown>): ResumeAction | null {
  if (Number(raw.index) < 1) return null;
  const action: ResumeAction = {
    op: 'update_experience',
    index: Math.floor(Number(raw.index)),
  };
  if (raw.title) action.title = String(raw.title).slice(0, 200);
  if (raw.org) action.org = String(raw.org).slice(0, 200);
  if (raw.span) action.span = String(raw.span).slice(0, 60);
  if (raw.bullets) action.bullets = toStrings(raw.bullets, 8);
  return action;
}

function cleanAction(raw: Record<string, unknown>): ResumeAction | null {
  const op = String(raw.op || '');
  const text = (max: number): string => String(raw.text ?? '').slice(0, max);
  if (op === 'set_headline') return { op, text: text(400) };
  if (op === 'set_summary') return { op, text: text(1600) };
  if (op === 'set_clearance') return { op, text: text(200) };
  if (op === 'set_competencies') return { op, items: toStrings(raw.items) };
  if (op === 'set_skills') return { op, items: toStrings(raw.items) };
  if (op === 'set_cover_paragraphs') return { op, items: toStrings(raw.items, 6) };
  if (op === 'update_experience') return experienceAction(raw);
  return null;
}

function cleanActions(raw: unknown): ResumeAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((action) => cleanAction(action as Record<string, unknown>))
    .filter((action): action is ResumeAction => action !== null);
}

function guideHistory(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.slice(-8).map((entry: { role?: string; text?: string }) => {
    const speaker = entry.role === 'bot' ? 'Editor' : 'You';
    return `${speaker}: ${String(entry.text || '').slice(0, 500)}`;
  }).join('\n');
}

function parseGuideResponse(response: unknown): { reply: string; actions: ResumeAction[] } {
  let reply = 'Updated.';
  let actions: ResumeAction[] = [];
  const match = String(response || '').match(/\{[\s\S]*\}/);
  if (!match) return { reply, actions };
  try {
    const parsed = JSON.parse(match[0]) as { reply?: string; actions?: unknown };
    reply = String(parsed.reply || reply).slice(0, 1200);
    actions = cleanActions(parsed.actions);
  } catch (err) {
    logger.warn({ err }, 'resume guide bot JSON is unparseable');
  }
  return { reply, actions };
}

async function getResumeDocument(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const postingId = Number(req.query.id);
  if (!Number.isFinite(postingId)) { res.status(400).json({ error: 'id required' }); return; }
  const dir = await packetDir(userSub, postingId);
  if (!dir) {
    res.status(404).json({ error: 'no generated packet â€” generate one first' });
    return;
  }
  try { res.json(await readDoc(dir)); }
  catch (err) {
    logger.error({ err, userSub, postingId }, 'resume document read failed');
    res.status(500).json({ error: 'read failed' });
  }
}

async function guideResume(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const body = req.body || {};
  const postingId = Number(body.postingId);
  const message = String(body.message || '').trim();
  if (!Number.isFinite(postingId) || !message) {
    res.status(400).json({ error: 'postingId + message required' });
    return;
  }
  const dir = await packetDir(userSub, postingId);
  if (!dir) { res.status(404).json({ error: 'no generated packet' }); return; }
  try {
    const document = await readDoc(dir);
    const resume = body.resume && typeof body.resume === 'object' ? body.resume : document.resume;
    const cover = body.cover && typeof body.cover === 'object' ? body.cover : document.cover;
    const result = await executeBotOrInline(ctx, botClient, CAREER_AGENT_ID, {
      text: guidePrompt(message, resume, cover, document.meta, guideHistory(body.history)),
      taskId: `resumeedit-${userSub}`,
      workspaceFolderId: `resumeedit-${userSub}`,
      agentId: CAREER_AGENT_ID,
      agenticMode: true,
      direct: false,
      userSub,
    } as never);
    const parsed = parseGuideResponse(result.response);
    logger.info({ userSub, postingId, actions: parsed.actions.length }, 'resume guide turn');
    res.json(parsed);
  } catch (err) {
    logger.error({ err, userSub, postingId }, 'resume guide failed');
    res.status(500).json({ error: 'guide failed' });
  }
}

async function saveResume(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const body = req.body || {};
  const postingId = Number(body.postingId);
  if (!Number.isFinite(postingId) || !body.resume || !body.cover) {
    res.status(400).json({ error: 'postingId + resume + cover required' });
    return;
  }
  const dir = await packetDir(userSub, postingId);
  if (!dir) { res.status(404).json({ error: 'no generated packet' }); return; }
  const lease = tryAcquireRun(userSub, 'user-store');
  if (rejectEngineClaim(res, lease, 'resume rerender')) return;
  try {
    const result = await saveAndRerenderPacket(
      ctx, userSub, postingId, dir, body.resume, body.cover, lease,
    );
    if (result.limitReason) {
      rejectEngineStart(
        res, { started: false, limitReason: result.limitReason }, 'resume rerender',
      );
      return;
    }
    if (!result.ok) {
      logger.error({ err: result.err, userSub, postingId }, 'resume rerender failed');
      res.status(500).json({ ok: false, error: result.err.slice(-400) });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userSub, postingId }, 'resume save failed');
    res.status(500).json({ error: 'save failed' });
  } finally { releaseRun(lease); }
}

/**
 * @description Mounts structured resume load, bot guide, and transactional save routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for bot execution and brokered packet rerendering.
 * @returns Nothing.
 */
export function registerCareerResumeStudio(router: Router, ctx: AppContext): void {
  router.get('/resume/doc', getResumeDocument);
  router.post('/resume/guide', (req, res) => guideResume(ctx, req, res));
  router.post('/resume/save', (req, res) => saveResume(ctx, req, res));
}
