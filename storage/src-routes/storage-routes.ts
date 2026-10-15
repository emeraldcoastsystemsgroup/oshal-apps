/**
 * Storage Routes — the Storage settings surface + prefs CRUD + target pickers.
 *
 * Serves the settings page (where Code / Files go), reads/writes oshal_storage_prefs, and
 * provides the pickers the page needs: Dropbox folders + the caller's GitHub repos. Also serves
 * files saved to the OSHAL-local target. See ADR-041 + storage-target.ts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-16 11:35:00 | roger.murphy@agenticfederal.us   | Initial — GET /storage (settings page), GET/PUT /storage/prefs, GET /storage/dropbox/folders, GET /storage/github/repos, GET /storage/local/{list,download}.
 * 2026-07-19 13:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the storage app package (ADR-085 Wave 2). Standard (ctx) factory; surfaces served from ctx.appPackageDir/tools (load-time env fallback); shared core helpers imported via @/app/routes aliases. The storage-target/storage-browse kernel skill and /api/files stay core.
 * 2026-07-19 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | move + share actions (BACKLOG storage bot "more actions"): POST /local/move (move/rename within the caller's OSHAL-local store, traversal-guarded) + GET /local/share (resolve the authed KERNEL /api/files/download link for a stored file — the share shape). Both also wired into the assistant intent set (move/share) so the data-management bot can drive them from chat. Local-store only, caller-scoped; no new outward surface.
 * 2026-10-10 12:00:00 | maintainer@emeraldcoastsystemsgroup.com | Native kernel: with OSHAL_EGRESS=kernel the GitHub (repo list + create, also the assistant's create_repo) and Dropbox (folder picker, the assistant's list_files) calls go through the global fetch with no Authorization header; the kernel applies the caller's github / dropbox connection declared in the manifest egress block. GET /prefs reads the connected list from the connectors.metadata intent instead of the framework's oshal_connections table. A missing or unusable connection, or a kernel "not connected" refusal, gives the same not-connected answer as a missing token. The legacy broker path is unchanged.
 * 2026-10-11 12:00:00 | maintainer@emeraldcoastsystemsgroup.com | The Storage Assistant runs on this package's own declared bot, storage-assistant (a0000000-0000-0000-0000-000000000041), instead of the platform comms bot b0000000-0000-0000-0000-000000000001: the native kernel resolves a package bot turn only against the bots the package declares, so every assistant message was refused "requested bot is not declared by this application". Guarded by scripts/check-store-bots.test.mjs.
 * 2026-10-11 18:00:00 | maintainer@emeraldcoastsystemsgroup.com | "List my files" lists the store the Files bucket points at. list_files always read Dropbox, so with Files on OSHAL local (the default, and the only target on an installation where no Dropbox is connected) the assistant answered "Dropbox isn't connected" while get_prefs in the same chat said files save to OSHAL local. It now lists the caller's OSHAL-local store when Files points there, Dropbox when it points there, and for GitHub says it cannot list a repository here. The /local/list route and the assistant share listLocalFiles. Guard: tests/kernel-egress.test.cjs (list_files by bucket).
 * 2026-10-12 18:00:00 | maintainer@emeraldcoastsystemsgroup.com | Notes: POST /local/save writes a text note into the caller's OSHAL-local store (never replacing a file of the same name unless asked) and GET /local/read reads one back; the storage-save-note tool (held for the person's approval) and storage-read-file use them, because Jarvis handed "save that note somewhere I can find it again" here and the assistant had no write tool. Under the native kernel /local/list and the assistant's list_files now list the kernel's personal file store (src-routes/local-notes.ts), where saved files really are, instead of the sandbox directory that always answered empty there.
 * 2026-10-12 18:30:00 | maintainer@emeraldcoastsystemsgroup.com | DELETE /local/note removes a saved .txt or .md note from the caller's OSHAL-local store (storage.delete for the verified caller under the native kernel, the per-user directory on the legacy framework); a missing note answers 404 and nothing is deleted. The storage-delete-note tool, held for the person's approval, uses it. Guard: tests/notes.test.cjs.
 * 2026-10-12 19:00:00 | maintainer@emeraldcoastsystemsgroup.com | Change log only: the 18:00 entry is restored to its original words and the note removal is recorded in its own entry above, instead of the earlier entry being rewritten.
 * 2026-10-12 21:00:00 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: "How much space am I using?" had no answer (the assistant said it had no tool for it). GET /local/list also answers "usage": how many files sit at the top of the OSHAL-local store, their total size and the 250 MB OSHAL-local limit Storage Settings shows, with a note that files moved into folders are not counted; the in-app assistant gains a usage action that says exactly that.
 *
 * @module storage-routes
 */
import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { getStoragePrefs, setStoragePrefs, ensureStoragePrefsSchema, sanitizeSubfolder, type StoragePrefs, type StorageTarget } from '@/app/routes/storage-target';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { KERNEL_TOKEN, connectionUsable, isNotConnected, kernelEgress, readConnections, usableProviders } from './kernel-egress';
import { NoteError, WHERE as NOTE_WHERE, listLocal, readNote, removeNote, saveNote } from './local-notes';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'storage-routes' });
const LOCAL_ROOT = path.join(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'userfiles');
/** The data-management bot: this package's own declared storage-assistant (oshal-app.yaml bots). */
const DATA_MGMT_BOT = 'a0000000-0000-0000-0000-000000000041';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

const DROPBOX_LIST_FOLDER = 'https://api.dropboxapi.com/2/files/list_folder';
const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL' };

/**
 * The caller's authorization for one provider call: the brokered token on the legacy path; under the kernel the
 * sentinel unless the connection metadata says the caller has no usable connection for that connector (then null).
 */
async function providerToken(ctx: AppContext, sub: string, connector: 'github' | 'dropbox'): Promise<string | null> {
  if (!kernelEgress()) return getValidAccessToken(ctx.pool, sub, connector);
  return connectionUsable(await readConnections(ctx), connector) === false ? null : KERNEL_TOKEN;
}

/** Provider request headers: the caller's Bearer token first on the legacy path; none under the kernel, which applies the declared connection. */
function authHeaders(token: string, extra: Record<string, string>): Record<string, string> {
  return kernelEgress() ? { ...extra } : { Authorization: `Bearer ${token}`, ...extra };
}

/** Create a GitHub repo on the caller's account; shared by the POST endpoint + the assistant. */
async function createGithubRepo(ctx: AppContext, sub: string, name: string, isPrivate = true): Promise<{ name?: string; fullName?: string; url?: string }> {
  const tok = await providerToken(ctx, sub, 'github');
  if (!tok) throw new Error('GitHub not connected — connect it at /utilities first.');
  const safe = name.trim().replace(/[^\w.\-]/g, '-').slice(0, 100);
  let r: globalThis.Response;
  try {
    r = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: authHeaders(tok, { ...GITHUB_HEADERS, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: safe, private: isPrivate, description: 'Created by OSHAL', auto_init: true }),
    });
  } catch (err) {
    if (isNotConnected(err)) throw new Error('GitHub not connected — connect it at /utilities first.');
    throw err;
  }
  const j = (await r.json()) as { full_name?: string; html_url?: string; name?: string; message?: string };
  if (!r.ok) throw new Error(j.message || `github ${r.status}`);
  return { name: j.name, fullName: j.full_name, url: j.html_url };
}
const VALID_PROVIDERS = new Set(['dropbox', 'oshal-local', 'github']);

function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}
function userKey(sub: string): string { return crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32); }

/** The authed KERNEL Files download link for an oshal-local relative path (the "share" shape — matches saveContent). */
function localDownloadUrl(rel: string): string { return `/api/files/download?provider=oshal-local&path=${encodeURIComponent(rel)}`; }

/** True when a resolved path stays inside the caller's store root (traversal guard). */
function insideStore(root: string, p: string): boolean {
  const r = path.resolve(root);
  const rp = path.resolve(p);
  return rp === r || rp.startsWith(r + path.sep);
}

/**
 * @description Move/rename a file within the caller's OSHAL-local store. Both the source name and
 * the destination name are reduced to basenames (no traversal), the from/to subfolders are
 * sanitized, and the resolved paths are asserted to stay inside the caller's store root.
 * @param sub - caller sub
 * @param name - source file basename
 * @param opts - fromDir / toDir (bot-scoped subfolders) + toName (rename target; defaults to name)
 * @returns the old + new relative paths and the authed download link for the moved file
 */
function moveLocalFile(sub: string, name: string, opts: { fromDir?: string; toDir?: string; toName?: string }): { from: string; to: string; downloadUrl: string } {
  const src = path.basename(String(name || '').trim());
  if (!src || src === '.' || src === '..') throw new Error('a file name is required');
  const dstName = path.basename(String(opts.toName || name).trim()) || src;
  const fromDir = sanitizeSubfolder(opts.fromDir || '');
  const toDir = sanitizeSubfolder(opts.toDir || '');
  const root = path.join(LOCAL_ROOT, userKey(sub));
  const srcP = path.join(root, fromDir, src);
  const dstDir = path.join(root, toDir);
  const dstP = path.join(dstDir, dstName);
  if (!insideStore(root, srcP) || !insideStore(root, dstP)) throw new Error('path escapes the store');
  if (!fs.existsSync(srcP)) throw new Error('file not found');
  fs.mkdirSync(dstDir, { recursive: true });
  fs.renameSync(srcP, dstP);
  const toRel = [toDir, dstName].filter(Boolean).join('/');
  return { from: [fromDir, src].filter(Boolean).join('/'), to: toRel, downloadUrl: localDownloadUrl(toRel) };
}

/**
 * @description Resolve the authed download link for a file in the caller's OSHAL-local store — the
 * "share" action returns the same KERNEL /api/files/download shape saveContent emits (an authed,
 * caller-scoped link, not a public one).
 * @param sub - caller sub
 * @param name - file basename
 * @param dir - optional bot-scoped subfolder
 * @returns the relative path + the authed download link
 */
function shareLocalFile(sub: string, name: string, dir?: string): { path: string; downloadUrl: string } {
  const base = path.basename(String(name || '').trim());
  if (!base || base === '.' || base === '..') throw new Error('a file name is required');
  const sub2 = sanitizeSubfolder(dir || '');
  const root = path.join(LOCAL_ROOT, userKey(sub));
  const file = path.join(root, sub2, base);
  if (!insideStore(root, file)) throw new Error('path escapes the store');
  if (!fs.existsSync(file)) throw new Error('file not found');
  const rel = [sub2, base].filter(Boolean).join('/');
  return { path: rel, downloadUrl: localDownloadUrl(rel) };
}

/** Human-readable target description (for the assistant's replies). */
function descTarget(t: StorageTarget): string {
  if (t.provider === 'github') return `GitHub (${t.repo || 'pick a repo'}${t.folder ? '/' + t.folder : ''})`;
  if (t.provider === 'dropbox') return `Dropbox (${t.folder || '/'})`;
  return 'OSHAL local';
}

/** Execute one parsed storage action (the controller acts with the user's token — ADR-036). */
async function executeStorageAction(ctx: AppContext, sub: string, intent: { action?: string; args?: Record<string, unknown>; reply?: string }): Promise<{ reply: string; data?: unknown }> {
  const action = intent?.action || 'none';
  const args = (intent?.args || {}) as Record<string, string | boolean>;
  const baseReply = intent?.reply || '';
  if (action === 'get_prefs') {
    const p = await getStoragePrefs(ctx, sub);
    return { reply: `Right now: code → ${descTarget(p.code)}; files → ${descTarget(p.files)}.`, data: p };
  }
  if (action === 'set_target') {
    const bucket = args.bucket === 'code' ? 'code' : 'files';
    const provider = String(args.provider || '');
    if (!['github', 'dropbox', 'oshal-local'].includes(provider)) return { reply: 'Which backend — GitHub, Dropbox, or OSHAL local?' };
    const p = await getStoragePrefs(ctx, sub);
    p[bucket] = { provider: provider as StorageTarget['provider'], repo: args.repo ? String(args.repo) : undefined, folder: args.folder ? String(args.folder) : undefined };
    await setStoragePrefs(ctx, sub, p);
    return { reply: baseReply || `Done — your ${bucket} now saves to ${descTarget(p[bucket])}.`, data: p };
  }
  if (action === 'create_repo') {
    if (!args.name) return { reply: 'Sure — what should I name the repo?' };
    const repo = await createGithubRepo(ctx, sub, String(args.name), args.private !== false);
    return { reply: `Created ${repo.fullName} ✓  ${repo.url}`, data: repo };
  }
  if (action === 'move') {
    if (!args.name) return { reply: 'Which file should I move, and where to?' };
    const r = moveLocalFile(sub, String(args.name), { fromDir: args.fromDir ? String(args.fromDir) : undefined, toDir: args.toDir ? String(args.toDir) : undefined, toName: args.toName ? String(args.toName) : undefined });
    return { reply: baseReply || `Moved ${r.from} → ${r.to}.`, data: r };
  }
  if (action === 'share') {
    if (!args.name) return { reply: 'Which file would you like a link for?' };
    const r = shareLocalFile(sub, String(args.name), args.dir ? String(args.dir) : undefined);
    return { reply: baseReply || `Here's your link to ${r.path}: ${r.downloadUrl}`, data: r };
  }
  if (action === 'list_files') return listBucketFiles(ctx, sub);
  if (action === 'usage') {
    const usage = localUsage(await listLocalFiles(ctx, sub));
    return { reply: `Your OSHAL-local store holds ${usage.files} file(s) using ${usage.used}. ${usage.scope}`, data: usage };
  }
  return { reply: baseReply || 'I can create a GitHub repo, set where your code/files save, or list your files. What would you like?' };
}

/** The OSHAL-local limit Storage Settings names ("OSHAL (local, limited 250 MB)"), in bytes. */
export const LOCAL_LIMIT_BYTES = 250 * 1024 * 1024;
/** What the usage figure covers, said with it so a top-level total is never read as the whole store. */
const USAGE_SCOPE = 'Counts the files at the top of your OSHAL-local store; files moved into folders are not counted here.';

/**
 * @description Bytes as the short words a person reads (512 B, 1.5 KB, 3.2 MB).
 * @param bytes - A byte count.
 * @returns The words.
 */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @description How much of the OSHAL-local store the listed files use: their count, total bytes, the limit and what is covered.
 * @param files - The /local/list files (name and size).
 * @returns The usage the route answers and the assistant says.
 */
export function localUsage(files: Array<{ size?: number }>): { files: number; bytes: number; limitBytes: number; used: string; scope: string } {
  const bytes = files.reduce((sum, f) => sum + (Number.isFinite(Number(f.size)) ? Number(f.size) : 0), 0);
  return { files: files.length, bytes, limitBytes: LOCAL_LIMIT_BYTES, used: `${sizeWords(bytes)} of ${sizeWords(LOCAL_LIMIT_BYTES)}`, scope: USAGE_SCOPE };
}

/** The legacy framework's per-user OSHAL-local directory. */
function legacyLocalDir(sub: string): string { return path.join(LOCAL_ROOT, userKey(sub)); }

/**
 * @description The files at the top of the caller's OSHAL-local store (the /local/list answer and the assistant's): the
 * kernel's personal file store under the native kernel, the per-user directory on the legacy framework.
 * @param ctx - app context
 * @param sub - caller sub
 * @returns name and size of each file; empty when the store does not exist yet
 */
function listLocalFiles(ctx: AppContext, sub: string) {
  return listLocal(ctx, sub, legacyLocalDir);
}

/**
 * @description The assistant's list_files action: the store the Files bucket points at, never a store the
 * caller did not choose (it always read Dropbox, so "list my files" answered "Dropbox isn't connected" to a
 * caller whose files save to OSHAL local).
 * @param ctx - app context (prefs, connections)
 * @param sub - caller sub
 * @returns the reply naming the store, and the file names
 */
async function listBucketFiles(ctx: AppContext, sub: string): Promise<{ reply: string; data?: unknown }> {
  const target = (await getStoragePrefs(ctx, sub)).files;
  if (target.provider === 'dropbox') return listDropboxFiles(ctx, sub);
  if (target.provider === 'github') {
    return { reply: `Your files save to ${descTarget(target)}. I cannot list a repository's files here; open it on GitHub to see them.`, data: { provider: 'github', files: [] } };
  }
  const names = (await listLocalFiles(ctx, sub)).map((f) => f.name);
  const reply = names.length
    ? `Your files save to OSHAL local. You have ${names.length} file(s) there: ${names.slice(0, 15).join(', ')}${names.length > 15 ? '…' : ''}.`
    : 'Your files save to OSHAL local, and there are no files there yet.';
  return { reply, data: { provider: 'oshal-local', files: names } };
}

/** The assistant's list_files action for a Files bucket on Dropbox: the names at the top of the caller's Dropbox. */
async function listDropboxFiles(ctx: AppContext, sub: string): Promise<{ reply: string; data?: unknown }> {
  const notConnected = { reply: 'Dropbox isn’t connected — connect it at /utilities and I can list your files.' };
  const tok = await providerToken(ctx, sub, 'dropbox');
  if (!tok) return notConnected;
  let r: globalThis.Response;
  try {
    r = await fetch(DROPBOX_LIST_FOLDER, { method: 'POST', headers: authHeaders(tok, { 'Content-Type': 'application/json' }), body: JSON.stringify({ path: '', recursive: false }) });
  } catch (err) {
    if (isNotConnected(err)) return notConnected;
    throw err;
  }
  const j = (await r.json()) as { entries?: Array<{ name: string }> };
  const names = (j.entries || []).map((e) => e.name);
  return { reply: names.length ? `You have ${names.length} file(s): ${names.slice(0, 15).join(', ')}${names.length > 15 ? '…' : ''}.` : 'No files in your Dropbox yet.', data: { files: names } };
}

/** The caller's connected providers: the connection metadata under the kernel, the framework's connections table otherwise. */
async function connectedProviders(ctx: AppContext, sub: string): Promise<string[]> {
  if (kernelEgress()) return usableProviders(await readConnections(ctx));
  return (await ctx.pool.query("SELECT provider FROM oshal_connections WHERE user_sub=$1 AND status='connected'", [sub])).rows.map((r: { provider: string }) => r.provider);
}

/** Validate + normalize a posted target. */
function cleanTarget(t: unknown): StorageTarget | null {
  const o = (t || {}) as Record<string, unknown>;
  const provider = String(o.provider || '');
  if (!VALID_PROVIDERS.has(provider)) return null;
  return { provider: provider as StorageTarget['provider'], folder: o.folder ? String(o.folder).slice(0, 200) : undefined, repo: o.repo ? String(o.repo).slice(0, 120) : undefined };
}

/**
 * @description Builds the storage settings router (mount at /api/storage, requiresAuth).
 * Packaged shape: standard (ctx) factory — surfaces are served from the installed
 * package's tools/ dir (ctx.appPackageDir, captured at factory time per D10).
 */
export function createStorageRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir
    ? path.join(ctx.appPackageDir, 'tools')
    : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
  ensureStoragePrefsSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure oshal_storage_prefs schema'));

  /** GET / — the Storage settings surface. */
  router.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(assetRoot, 'storage-settings.html'), (err) => {
      if (err) { logger.error({ err }, 'serve storage settings failed'); res.status(404).send('Page not found'); }
    });
  });

  /** GET /assistant/ui — the Storage Assistant chat surface (the data-management bot). */
  router.get('/assistant/ui', (_req: Request, res: Response) => {
    res.sendFile(path.join(assetRoot, 'storage-assistant.html'), (err) => {
      if (err) { logger.error({ err }, 'serve storage assistant failed'); res.status(404).send('Page not found'); }
    });
  });

  /** POST /assistant — the data-management bot: chat → the bot turns the message into an action,
   *  the controller executes it with the caller's token (create repo / set target / list files). */
  router.post('/assistant', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const message = String((req.body as { message?: string })?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    try {
      const prompt = [
        "You are OSHAL's Storage Assistant. Turn the user's request into ONE action.",
        'Respond with ONLY a JSON object (no prose, no code fences): {"action":"...","args":{...},"reply":"a short friendly confirmation"}.',
        'Actions:',
        '- get_prefs (args {}) — show where code/files currently save',
        '- set_target (args {bucket:"code"|"files", provider:"github"|"dropbox"|"oshal-local", repo?, folder?}) — change where a bucket saves',
        '- create_repo (args {name, private?:true}) — create a new GitHub repo',
        '- move (args {name, toName?, fromDir?, toDir?}) — move/rename a file in the user\'s OSHAL-local store',
        '- share (args {name, dir?}) — get an authed download link to a file in the user\'s OSHAL-local store',
        '- list_files (args {}) — list the user\'s files',
        '- usage (args {}) — how much space their OSHAL-local files use, against its 250 MB limit',
        '- none (args {}) — no tool needed; just answer in "reply"',
        `User: ${message}`,
      ].join('\n');
      const r = await executeBotOrInline(ctx, botClient, DATA_MGMT_BOT, {
        text: prompt, taskId: `storagebot-${sub}`, workspaceFolderId: `storagebot-${sub}`,
        agentId: DATA_MGMT_BOT, agenticMode: true, direct: true, userSub: sub,
      });
      const match = String(r.response || '').match(/\{[\s\S]*\}/);
      let intent: { action?: string; args?: Record<string, unknown>; reply?: string };
      try { intent = JSON.parse(match ? match[0] : String(r.response)); }
      catch { intent = { action: 'none', reply: String(r.response || 'Sorry, I didn’t catch that — try "create a repo named X" or "where do my files save?"').slice(0, 400) }; }
      res.json(await executeStorageAction(ctx, sub, intent));
    } catch (err) {
      logger.error({ err }, 'storage assistant failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /prefs — the caller's storage prefs (with smart defaults). */
  router.get('/prefs', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const connected = await connectedProviders(ctx, sub);
      res.json({ prefs: await getStoragePrefs(ctx, sub), connected });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  /** PUT /prefs — set the caller's storage prefs. Body: { code, files }. */
  router.put('/prefs', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as { code?: unknown; files?: unknown };
    const code = cleanTarget(body.code);
    const files = cleanTarget(body.files);
    if (!code || !files) { res.status(400).json({ error: 'both code and files targets required (provider: dropbox|oshal-local|github)' }); return; }
    try {
      await setStoragePrefs(ctx, sub, { code, files } as StoragePrefs);
      res.json({ ok: true, prefs: { code, files } });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  /** GET /dropbox/folders — top-level folders in the caller's Dropbox (for the picker). */
  router.get('/dropbox/folders', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const tok = await providerToken(ctx, sub, 'dropbox');
      if (!tok) { res.status(409).json({ error: 'no_dropbox' }); return; }
      const r = await fetch(DROPBOX_LIST_FOLDER, {
        method: 'POST', headers: authHeaders(tok, { 'Content-Type': 'application/json' }), body: JSON.stringify({ path: '', recursive: false }),
      });
      const j = (await r.json()) as { entries?: Array<{ '.tag': string; name: string; path_lower: string }> };
      if (!r.ok) { res.status(502).json({ error: JSON.stringify(j).slice(0, 200) }); return; }
      res.json({ folders: (j.entries || []).filter((e) => e['.tag'] === 'folder').map((e) => ({ name: e.name, path: e.path_lower })) });
    } catch (err) {
      if (isNotConnected(err)) { res.status(409).json({ error: 'no_dropbox' }); return; }
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /github/repos — create a new repo on the caller's GitHub ("make me a new project").
   *  Body: { name, private?, description? }. A data-management-bot tool, usable now from the UI. */
  router.post('/github/repos', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as { name?: string; private?: boolean; description?: string };
    const name = String(body.name || '').trim().replace(/[^\w.\-]/g, '-').slice(0, 100);
    if (!name) { res.status(400).json({ error: 'repo name required' }); return; }
    try {
      const tok = await providerToken(ctx, sub, 'github');
      if (!tok) { res.status(409).json({ error: 'no_github', message: 'Connect GitHub at /utilities first.' }); return; }
      const r = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: authHeaders(tok, { ...GITHUB_HEADERS, 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, private: body.private !== false, description: (body.description || 'Created by OSHAL').slice(0, 300), auto_init: true }),
      });
      const j = (await r.json()) as { full_name?: string; html_url?: string; name?: string; message?: string };
      if (!r.ok) { res.status(r.status === 422 ? 409 : 502).json({ error: j.message || `github ${r.status}` }); return; }
      logger.info({ sub, repo: j.full_name }, 'created GitHub repo');
      res.json({ ok: true, name: j.name, fullName: j.full_name, url: j.html_url });
    } catch (err) {
      if (isNotConnected(err)) { res.status(409).json({ error: 'no_github', message: 'Connect GitHub at /utilities first.' }); return; }
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /github/repos — the caller's GitHub repos (for the picker). */
  router.get('/github/repos', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const tok = await providerToken(ctx, sub, 'github');
      if (!tok) { res.status(409).json({ error: 'no_github' }); return; }
      const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', { headers: authHeaders(tok, GITHUB_HEADERS) });
      const j = (await r.json()) as Array<{ name: string; full_name: string; private: boolean }>;
      if (!r.ok) { res.status(502).json({ error: JSON.stringify(j).slice(0, 200) }); return; }
      res.json({ repos: (j || []).map((x) => ({ name: x.name, fullName: x.full_name, private: x.private })) });
    } catch (err) {
      if (isNotConnected(err)) { res.status(409).json({ error: 'no_github' }); return; }
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /local/list — files in the caller's OSHAL-local store. */
  router.get('/local/list', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const files = await listLocalFiles(ctx, sub);
      res.json({ files, usage: localUsage(files) });
    } catch (err) {
      logger.error({ err }, 'list local store failed');
      res.status(503).json({ error: 'Your OSHAL-local files cannot be listed right now.' });
    }
  });

  /** POST /local/save — save a text note in the caller's OSHAL-local store. Body: { name, text, replace?, confirm: true }. */
  router.post('/local/save', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (req.body?.confirm !== true) { res.status(400).json({ error: 'Confirm saving the note' }); return; }
    try {
      const saved = await saveNote(ctx, sub, req.body, legacyLocalDir);
      logger.info({ bytes: saved.size }, 'saved local store note');
      res.status(201).json({ ok: true, provider: 'oshal-local', ...saved, where: NOTE_WHERE });
    } catch (err) {
      if (err instanceof NoteError) { res.status(err.status).json({ error: err.message }); return; }
      logger.error({ err }, 'save local store note failed');
      res.status(503).json({ error: 'The note was not saved. Try again.' });
    }
  });

  /** GET /local/read?name= — a saved .txt or .md note in the caller's OSHAL-local store, as text. */
  router.get('/local/read', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      res.json(await readNote(ctx, sub, req.query.name, legacyLocalDir));
    } catch (err) {
      if (err instanceof NoteError) { res.status(err.status).json({ error: err.message }); return; }
      logger.error({ err }, 'read local store note failed');
      res.status(503).json({ error: 'The note cannot be read right now.' });
    }
  });

  /** DELETE /local/note?name= — remove a saved .txt or .md note from the caller's OSHAL-local store. */
  router.delete('/local/note', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      res.json({ ok: true, removed: (await removeNote(ctx, sub, req.query.name, legacyLocalDir)).name });
    } catch (err) {
      if (err instanceof NoteError) { res.status(err.status).json({ error: err.message }); return; }
      logger.error({ err }, 'remove local store note failed');
      res.status(503).json({ error: 'The note was not removed. Try again.' });
    }
  });

  /** GET /local/download?name=&dir= — download a file from the caller's OSHAL-local store.
   *  `dir` is an optional bot-scoped subfolder (ADR-043), sanitized against path traversal. */
  router.get('/local/download', (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const name = String(req.query.name || '').replace(/[^\w.\- ]/g, '_');
    const dir = sanitizeSubfolder(req.query.dir ? String(req.query.dir) : '');
    const file = path.join(LOCAL_ROOT, userKey(sub), dir, name);
    if (!name || !fs.existsSync(file)) { res.status(404).json({ error: 'not found' }); return; }
    res.download(file, name);
  });

  /** POST /local/move — move/rename a file within the caller's OSHAL-local store.
   *  Body: { name, toName?, fromDir?, toDir? }. Traversal-guarded; caller-scoped. */
  router.post('/local/move', (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = (req.body || {}) as { name?: string; toName?: string; fromDir?: string; toDir?: string };
    if (!body.name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      const r = moveLocalFile(sub, body.name, { toName: body.toName, fromDir: body.fromDir, toDir: body.toDir });
      logger.info({ sub, from: r.from, to: r.to }, 'moved local store file');
      res.json({ ok: true, ...r });
    } catch (err) {
      const msg = (err as Error).message;
      res.status(msg === 'file not found' ? 404 : 400).json({ error: msg });
    }
  });

  /** GET /local/share?name=&dir= — the authed download link for a file in the caller's OSHAL-local
   *  store (the kernel /api/files/download shape). A signed-in, caller-scoped link — not a public one. */
  router.get('/local/share', (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const name = String(req.query.name || '');
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      const r = shareLocalFile(sub, name, req.query.dir ? String(req.query.dir) : undefined);
      res.json({ ok: true, provider: 'oshal-local', ...r });
    } catch (err) {
      const msg = (err as Error).message;
      res.status(msg === 'file not found' ? 404 : 400).json({ error: msg });
    }
  });

  return router;
}
