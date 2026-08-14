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
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Added the MASTER document: id=master loads the durable profile through `resume base`, save whitelists back through `resume base-save` (changelog returned to the surface), and the guide bot is told it is editing the profile every tailored resume is generated from — with cover and title/org/span edits stripped for the master case.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Track the engine's corrected 96 KiB master-document ceiling. The document reaches the engine as an environment string across execve, which Linux caps at 128 KiB, so the previous 256 KiB pair described a limit neither side could enforce.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | THE EDITOR TALKS BACK. Operator, 2026-08-13: "the concierge will take the commands but doesn't talk to me or respond — I just tell it what to do and it does it. OK but not great." The prompt was the cause: it asked for "one short conversational sentence" and the model complied exactly, making a command executor out of something that should be a conversation. `reply` is now the half that carries the work (what changed and WHY, the tradeoff, the replaced words quoted), a clarifying question with actions:[] is an explicitly valid turn, and a question/opinion/review answers without editing. Also fixed the matching bug: a model reply with no JSON had its words DISCARDED and replaced with "Updated." — throwing away the answer and claiming an edit that never happened; the prose is now kept as the reply.
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
/** Sentinel document id the surface sends for the durable master profile (never a posting id). */
const MASTER_ID = 'master';
/** Route-side payload ceiling, slightly under the engine's 96 KiB guard. Defence in depth,
 *  not the first wall: the control plane's global JSON body limit (~100 KB unless
 *  OSHAL_JSON_BODY_LIMIT raises it) rejects most oversize bodies before this handler runs, so
 *  this guard is operative only on deployments that widen that limit — the engine-side refusal
 *  in bin/oshal-jobhunter.js remains the authoritative cap either way.
 *  Both ceilings sit under Linux's 128 KiB cap on a single environment string: the engine
 *  receives this document through CH_RESUME_DOC across execve, so a larger limit would be
 *  unenforceable rather than generous. */
const MASTER_DOC_MAX_BYTES = 98_000;

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

/** Frame the guide bot for either a job-tailored packet or the durable MASTER profile. */
function guidePromptIntro(meta: Record<string, unknown>): string[] {
  if (meta.master === true) {
    return [
      'You are editing the candidate\'s MASTER resume in a live editor. This is NOT a job-tailored',
      'packet: it is the durable career profile every future tailored resume is generated from, and',
      'every change you make here updates that durable profile. Do NOT tailor to any specific job,',
      'company, or posting — keep every edit generally true of the whole career. Never change a',
      'role\'s title, org, or span (they anchor the durable profile); edit bullets and text fields.',
    ];
  }
  return [
    'You are editing the candidate\'s tailored RESUME + COVER LETTER for a specific job, in a live editor.',
    `Target role: ${String(meta.title || '')} at ${String(meta.company || '')}.`,
  ];
}

function guidePrompt(
  message: string,
  resume: Record<string, unknown>,
  cover: Record<string, unknown>,
  meta: Record<string, unknown>,
  history: string,
): string {
  const master = meta.master === true;
  return [
    ...guidePromptIntro(meta),
    '',
    'HARD TRUTH RULES (never violate): edit ONLY the facts already present â€” NEVER invent or add an',
    'employer, title, date, metric, skill, certification, clearance, or claim. You may reorder, sharpen,',
    'reword, and re-emphasize. Real titles only (exactly as they appear in the profile),',
    'never inflated to CTO/VP/Chief unless the profile says so. Player-coach voice ("led the team',
    'that built", "led the effort"), never "I built X" as if solo. First person implied, no third-person pronoun or name.',
    'NEVER use em or en dashes. Keep bullets to 1-2 lines, strong past-tense lead verbs, outcome first.',
    '',
    'CURRENT RESUME (JSON):', JSON.stringify(resume).slice(0, 12000),
    ...(master ? [] : ['CURRENT COVER (JSON):', JSON.stringify(cover).slice(0, 4000)]),
    history ? `\nCONVERSATION SO FAR:\n${history}` : '',
    `\nUSER: ${message}`,
    '',
    // TALK BACK. The old contract asked for "one short conversational sentence" and the editor
    // obeyed it literally: it executed commands and said "Updated." Operator, 2026-08-13 — "the
    // concierge will take the commands but doesn't talk to me or respond, so I just tell it what
    // to do and it does it. OK but not great." A resume is a conversation, so `reply` is now the
    // half that carries the work, and zero actions is an explicitly VALID turn.
    'Reply with ONLY a JSON object (no prose, no code fences):',
    '{"reply":"<what you would say out loud>","actions":[ ...zero or more edits... ]}',
    'HOW TO TALK: `reply` is a real answer, not a receipt. Say what you changed and WHY it is',
    'stronger, name the tradeoff you made, and when the request is ambiguous ASK rather than guess',
    '(answer with a question and NO actions — that is a valid, expected turn). When you are asked a',
    'question, or for an opinion or a review, answer it with actions:[] and change nothing. Never',
    'reply with a bare "Updated." Two or three sentences is right; do not pad it.',
    'When you DO edit, quote the words you replaced so the user can see the change without hunting',
    'for it in the preview.',
    'Allowed actions (use the minimal set that satisfies the request):',
    '- {"op":"set_headline","text":"..."}',
    '- {"op":"set_summary","text":"3-4 sentence executive summary"}',
    '- {"op":"set_clearance","text":"exact clearance as already stated"}',
    '- {"op":"set_competencies","items":["8-12 short phrases"]}',
    '- {"op":"set_skills","items":["concise skills"]}',
    master
      ? '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]} (bullets ONLY — the master keeps titles, orgs, and spans fixed)'
      : '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]}',
    ...(master ? [] : ['- {"op":"set_cover_paragraphs","items":["exactly 3 tight paragraphs, under ~230 words total"]}']),
  ].join('\n');
}

function toStrings(value: unknown, count = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, count)
    .map((item) => String(item ?? '').slice(0, 600))
    .filter(Boolean);
}

function experienceAction(raw: Record<string, unknown>, master: boolean): ResumeAction | null {
  if (Number(raw.index) < 1) return null;
  const action: ResumeAction = {
    op: 'update_experience',
    index: Math.floor(Number(raw.index)),
  };
  // The master save matches roles by index+title, so title/org/span edits are stripped there —
  // they would only poison the payload into a refused save.
  if (raw.title && !master) action.title = String(raw.title).slice(0, 200);
  if (raw.org && !master) action.org = String(raw.org).slice(0, 200);
  if (raw.span && !master) action.span = String(raw.span).slice(0, 60);
  if (raw.bullets) action.bullets = toStrings(raw.bullets, 8);
  return action;
}

function cleanAction(raw: Record<string, unknown>, master: boolean): ResumeAction | null {
  const op = String(raw.op || '');
  const text = (max: number): string => String(raw.text ?? '').slice(0, max);
  if (op === 'set_headline') return { op, text: text(400) };
  if (op === 'set_summary') return { op, text: text(1600) };
  if (op === 'set_clearance') return { op, text: text(200) };
  if (op === 'set_competencies') return { op, items: toStrings(raw.items) };
  if (op === 'set_skills') return { op, items: toStrings(raw.items) };
  if (op === 'set_cover_paragraphs') return master ? null : { op, items: toStrings(raw.items, 6) };
  if (op === 'update_experience') return experienceAction(raw, master);
  return null;
}

function cleanActions(raw: unknown, master: boolean): ResumeAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((action) => cleanAction(action as Record<string, unknown>, master))
    .filter((action): action is ResumeAction => action !== null);
}

function guideHistory(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.slice(-8).map((entry: { role?: string; text?: string }) => {
    const speaker = entry.role === 'bot' ? 'Editor' : 'You';
    return `${speaker}: ${String(entry.text || '').slice(0, 500)}`;
  }).join('\n');
}

function parseGuideResponse(
  response: unknown, master: boolean,
): { reply: string; actions: ResumeAction[] } {
  let reply = 'Updated.';
  let actions: ResumeAction[] = [];
  const raw = String(response || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  // No JSON at all means the model just TALKED — which is now an expected turn (a question back, an
  // opinion, a review). Keep its words: replacing them with "Updated." both threw the answer away
  // and claimed an edit that never happened.
  if (!match) return { reply: raw ? raw.slice(0, 1200) : reply, actions };
  try {
    const parsed = JSON.parse(match[0]) as { reply?: string; actions?: unknown };
    reply = String(parsed.reply || reply).slice(0, 1200);
    actions = cleanActions(parsed.actions, master);
  } catch (err) {
    logger.warn({ err }, 'resume guide bot JSON is unparseable');
  }
  return { reply, actions };
}

/** Read the engine child's JSON document out of its stdout tail, or null when it printed none. */
function parseEngineJson(out: string): Record<string, unknown> | null {
  const start = out.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(out.slice(start)) as Record<string, unknown>; } catch { return null; }
}

/** Load the MASTER document through the engine's straight, model-free profile mapping. */
async function getMasterDocument(ctx: AppContext, userSub: string, res: Response): Promise<void> {
  const result = await runCareerCliAwait(ctx.pool, userSub, ['resume', 'base']);
  if (result.limitReason) {
    rejectEngineStart(res, { started: false, limitReason: result.limitReason }, 'master resume load');
    return;
  }
  const parsed = result.ok ? parseEngineJson(result.out) : null;
  if (!parsed) {
    logger.error({ err: result.err.slice(-300), userSub }, 'master resume load failed');
    res.status(500).json({ error: 'master resume load failed' });
    return;
  }
  res.json(parsed);
}

async function getResumeDocument(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (String(req.query.id || '') === MASTER_ID) {
    await getMasterDocument(ctx, userSub, res);
    return;
  }
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

/** Resolve the document a guide turn edits: packet metadata from disk, or the master sentinel. */
async function guideDocument(
  userSub: string, body: Record<string, unknown>,
): Promise<{ document: ResumeDocument } | { status: number; error: string }> {
  if (body.postingId === MASTER_ID) {
    if (!body.resume || typeof body.resume !== 'object') {
      return { status: 400, error: 'resume required for the master document' };
    }
    // The guide needs only document.meta for the master — the surface always sends the live
    // resume in the body, and there is no packet directory to read.
    return { document: { resume: {}, cover: {}, meta: { master: true } } };
  }
  const postingId = Number(body.postingId);
  if (!Number.isFinite(postingId)) return { status: 400, error: 'postingId + message required' };
  const dir = await packetDir(userSub, postingId);
  if (!dir) return { status: 404, error: 'no generated packet' };
  return { document: await readDoc(dir) };
}

async function guideResume(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const body = req.body || {};
  const postingId = String(body.postingId ?? '').slice(0, 32);
  const message = String(body.message || '').trim();
  if (!message) { res.status(400).json({ error: 'postingId + message required' }); return; }
  try {
    const loaded = await guideDocument(userSub, body);
    if ('status' in loaded) { res.status(loaded.status).json({ error: loaded.error }); return; }
    const { document } = loaded;
    const master = document.meta.master === true;
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
    const parsed = parseGuideResponse(result.response, master);
    logger.info({ userSub, postingId, actions: parsed.actions.length }, 'resume guide turn');
    res.json(parsed);
  } catch (err) {
    logger.error({ err, userSub, postingId }, 'resume guide failed');
    res.status(500).json({ error: 'guide failed' });
  }
}

/** Persist the MASTER document through the engine's whitelist write-back, returning its changelog. */
async function saveMasterResume(
  ctx: AppContext, userSub: string, body: Record<string, unknown>, res: Response,
): Promise<void> {
  if (!body.resume || typeof body.resume !== 'object') {
    res.status(400).json({ error: 'resume required' });
    return;
  }
  const payload = JSON.stringify({ resume: body.resume });
  if (Buffer.byteLength(payload, 'utf8') > MASTER_DOC_MAX_BYTES) {
    res.status(413).json({ ok: false, error: 'master resume payload too large' });
    return;
  }
  try {
    const result = await runCareerCliAwait(
      ctx.pool, userSub, ['resume', 'base-save'], { CH_RESUME_DOC: payload },
    );
    if (result.limitReason) {
      rejectEngineStart(res, { started: false, limitReason: result.limitReason }, 'master resume save');
      return;
    }
    const parsed = parseEngineJson(result.out) as
      { ok?: unknown; changed?: unknown; changelog?: unknown; error?: unknown } | null;
    if (!parsed || parsed.ok !== true) {
      const refusal = String(parsed?.error || '').slice(0, 400);
      logger.error({ userSub, refusal, err: result.err.slice(-300) }, 'master resume save failed');
      res.status(refusal ? 422 : 500).json({ ok: false, error: refusal || 'master resume save failed' });
      return;
    }
    const changelog = Array.isArray(parsed.changelog)
      ? parsed.changelog.slice(0, 50).map((line) => String(line).slice(0, 500)) : [];
    logger.info({ userSub, changed: parsed.changed === true, entries: changelog.length }, 'master resume saved');
    res.json({ ok: true, changed: parsed.changed === true, changelog });
  } catch (err) {
    logger.error({ err, userSub }, 'master resume save failed');
    res.status(500).json({ error: 'save failed' });
  }
}

async function saveResume(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const body = req.body || {};
  if (body.postingId === MASTER_ID) {
    await saveMasterResume(ctx, userSub, body, res);
    return;
  }
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
 * @description Mounts structured resume load, bot guide, and transactional save routes. All three
 * accept `master` as the document id alongside numeric posting ids: the master case reads and
 * writes the durable career profile through the engine's `resume base`/`resume base-save` verbs.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for bot execution and brokered engine dispatch.
 * @returns Nothing.
 */
export function registerCareerResumeStudio(router: Router, ctx: AppContext): void {
  router.get('/resume/doc', (req, res) => getResumeDocument(ctx, req, res));
  router.post('/resume/guide', (req, res) => guideResume(ctx, req, res));
  router.post('/resume/save', (req, res) => saveResume(ctx, req, res));
}
