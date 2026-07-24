"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStorageRoutes = createStorageRoutes;
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
 *
 * @module storage-routes
 */
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const storage_target_1 = require("@/app/routes/storage-target");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'storage-routes' });
const LOCAL_ROOT = path.join(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'userfiles');
/** The data-management bot's reasoning runs on the comms bot (reliable claude-code node). */
const DATA_MGMT_BOT = 'b0000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Create a GitHub repo on the caller's account; shared by the POST endpoint + the assistant. */
async function createGithubRepo(ctx, sub, name, isPrivate = true) {
    const tok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'github');
    if (!tok)
        throw new Error('GitHub not connected — connect it at /utilities first.');
    const safe = name.trim().replace(/[^\w.\-]/g, '-').slice(0, 100);
    const r = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safe, private: isPrivate, description: 'Created by OSHAL', auto_init: true }),
    });
    const j = (await r.json());
    if (!r.ok)
        throw new Error(j.message || `github ${r.status}`);
    return { name: j.name, fullName: j.full_name, url: j.html_url };
}
const VALID_PROVIDERS = new Set(['dropbox', 'oshal-local', 'github']);
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
function userKey(sub) { return crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32); }
/** The authed KERNEL Files download link for an oshal-local relative path (the "share" shape — matches saveContent). */
function localDownloadUrl(rel) { return `/api/files/download?provider=oshal-local&path=${encodeURIComponent(rel)}`; }
/** True when a resolved path stays inside the caller's store root (traversal guard). */
function insideStore(root, p) {
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
function moveLocalFile(sub, name, opts) {
    const src = path.basename(String(name || '').trim());
    if (!src || src === '.' || src === '..')
        throw new Error('a file name is required');
    const dstName = path.basename(String(opts.toName || name).trim()) || src;
    const fromDir = (0, storage_target_1.sanitizeSubfolder)(opts.fromDir || '');
    const toDir = (0, storage_target_1.sanitizeSubfolder)(opts.toDir || '');
    const root = path.join(LOCAL_ROOT, userKey(sub));
    const srcP = path.join(root, fromDir, src);
    const dstDir = path.join(root, toDir);
    const dstP = path.join(dstDir, dstName);
    if (!insideStore(root, srcP) || !insideStore(root, dstP))
        throw new Error('path escapes the store');
    if (!fs.existsSync(srcP))
        throw new Error('file not found');
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
function shareLocalFile(sub, name, dir) {
    const base = path.basename(String(name || '').trim());
    if (!base || base === '.' || base === '..')
        throw new Error('a file name is required');
    const sub2 = (0, storage_target_1.sanitizeSubfolder)(dir || '');
    const root = path.join(LOCAL_ROOT, userKey(sub));
    const file = path.join(root, sub2, base);
    if (!insideStore(root, file))
        throw new Error('path escapes the store');
    if (!fs.existsSync(file))
        throw new Error('file not found');
    const rel = [sub2, base].filter(Boolean).join('/');
    return { path: rel, downloadUrl: localDownloadUrl(rel) };
}
/** Human-readable target description (for the assistant's replies). */
function descTarget(t) {
    if (t.provider === 'github')
        return `GitHub (${t.repo || 'pick a repo'}${t.folder ? '/' + t.folder : ''})`;
    if (t.provider === 'dropbox')
        return `Dropbox (${t.folder || '/'})`;
    return 'OSHAL local';
}
/** Execute one parsed storage action (the controller acts with the user's token — ADR-036). */
async function executeStorageAction(ctx, sub, intent) {
    const action = intent?.action || 'none';
    const args = (intent?.args || {});
    const baseReply = intent?.reply || '';
    if (action === 'get_prefs') {
        const p = await (0, storage_target_1.getStoragePrefs)(ctx, sub);
        return { reply: `Right now: code → ${descTarget(p.code)}; files → ${descTarget(p.files)}.`, data: p };
    }
    if (action === 'set_target') {
        const bucket = args.bucket === 'code' ? 'code' : 'files';
        const provider = String(args.provider || '');
        if (!['github', 'dropbox', 'oshal-local'].includes(provider))
            return { reply: 'Which backend — GitHub, Dropbox, or OSHAL local?' };
        const p = await (0, storage_target_1.getStoragePrefs)(ctx, sub);
        p[bucket] = { provider: provider, repo: args.repo ? String(args.repo) : undefined, folder: args.folder ? String(args.folder) : undefined };
        await (0, storage_target_1.setStoragePrefs)(ctx, sub, p);
        return { reply: baseReply || `Done — your ${bucket} now saves to ${descTarget(p[bucket])}.`, data: p };
    }
    if (action === 'create_repo') {
        if (!args.name)
            return { reply: 'Sure — what should I name the repo?' };
        const repo = await createGithubRepo(ctx, sub, String(args.name), args.private !== false);
        return { reply: `Created ${repo.fullName} ✓  ${repo.url}`, data: repo };
    }
    if (action === 'move') {
        if (!args.name)
            return { reply: 'Which file should I move, and where to?' };
        const r = moveLocalFile(sub, String(args.name), { fromDir: args.fromDir ? String(args.fromDir) : undefined, toDir: args.toDir ? String(args.toDir) : undefined, toName: args.toName ? String(args.toName) : undefined });
        return { reply: baseReply || `Moved ${r.from} → ${r.to}.`, data: r };
    }
    if (action === 'share') {
        if (!args.name)
            return { reply: 'Which file would you like a link for?' };
        const r = shareLocalFile(sub, String(args.name), args.dir ? String(args.dir) : undefined);
        return { reply: baseReply || `Here's your link to ${r.path}: ${r.downloadUrl}`, data: r };
    }
    if (action === 'list_files') {
        const tok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'dropbox');
        if (!tok)
            return { reply: 'Dropbox isn’t connected — connect it at /utilities and I can list your files.' };
        const r = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '', recursive: false }) });
        const j = (await r.json());
        const names = (j.entries || []).map((e) => e.name);
        return { reply: names.length ? `You have ${names.length} file(s): ${names.slice(0, 15).join(', ')}${names.length > 15 ? '…' : ''}.` : 'No files in your Dropbox yet.', data: { files: names } };
    }
    return { reply: baseReply || 'I can create a GitHub repo, set where your code/files save, or list your files. What would you like?' };
}
/** Validate + normalize a posted target. */
function cleanTarget(t) {
    const o = (t || {});
    const provider = String(o.provider || '');
    if (!VALID_PROVIDERS.has(provider))
        return null;
    return { provider: provider, folder: o.folder ? String(o.folder).slice(0, 200) : undefined, repo: o.repo ? String(o.repo).slice(0, 120) : undefined };
}
/**
 * @description Builds the storage settings router (mount at /api/storage, requiresAuth).
 * Packaged shape: standard (ctx) factory — surfaces are served from the installed
 * package's tools/ dir (ctx.appPackageDir, captured at factory time per D10).
 */
function createStorageRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir
        ? path.join(ctx.appPackageDir, 'tools')
        : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    (0, storage_target_1.ensureStoragePrefsSchema)(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure oshal_storage_prefs schema'));
    /** GET / — the Storage settings surface. */
    router.get('/', (_req, res) => {
        res.sendFile(path.join(assetRoot, 'storage-settings.html'), (err) => {
            if (err) {
                logger.error({ err }, 'serve storage settings failed');
                res.status(404).send('Page not found');
            }
        });
    });
    /** GET /assistant/ui — the Storage Assistant chat surface (the data-management bot). */
    router.get('/assistant/ui', (_req, res) => {
        res.sendFile(path.join(assetRoot, 'storage-assistant.html'), (err) => {
            if (err) {
                logger.error({ err }, 'serve storage assistant failed');
                res.status(404).send('Page not found');
            }
        });
    });
    /** POST /assistant — the data-management bot: chat → the bot turns the message into an action,
     *  the controller executes it with the caller's token (create repo / set target / list files). */
    router.post('/assistant', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message required' });
            return;
        }
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
                '- none (args {}) — no tool needed; just answer in "reply"',
                `User: ${message}`,
            ].join('\n');
            const r = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, DATA_MGMT_BOT, {
                text: prompt, taskId: `storagebot-${sub}`, workspaceFolderId: `storagebot-${sub}`,
                agentId: DATA_MGMT_BOT, agenticMode: true, direct: true, userSub: sub,
            });
            const match = String(r.response || '').match(/\{[\s\S]*\}/);
            let intent;
            try {
                intent = JSON.parse(match ? match[0] : String(r.response));
            }
            catch {
                intent = { action: 'none', reply: String(r.response || 'Sorry, I didn’t catch that — try "create a repo named X" or "where do my files save?"').slice(0, 400) };
            }
            res.json(await executeStorageAction(ctx, sub, intent));
        }
        catch (err) {
            logger.error({ err }, 'storage assistant failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /prefs — the caller's storage prefs (with smart defaults). */
    router.get('/prefs', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const connected = (await ctx.pool.query("SELECT provider FROM oshal_connections WHERE user_sub=$1 AND status='connected'", [sub])).rows.map((r) => r.provider);
            res.json({ prefs: await (0, storage_target_1.getStoragePrefs)(ctx, sub), connected });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    /** PUT /prefs — set the caller's storage prefs. Body: { code, files }. */
    router.put('/prefs', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = req.body;
        const code = cleanTarget(body.code);
        const files = cleanTarget(body.files);
        if (!code || !files) {
            res.status(400).json({ error: 'both code and files targets required (provider: dropbox|oshal-local|github)' });
            return;
        }
        try {
            await (0, storage_target_1.setStoragePrefs)(ctx, sub, { code, files });
            res.json({ ok: true, prefs: { code, files } });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /dropbox/folders — top-level folders in the caller's Dropbox (for the picker). */
    router.get('/dropbox/folders', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const tok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'dropbox');
            if (!tok) {
                res.status(409).json({ error: 'no_dropbox' });
                return;
            }
            const r = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
                method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '', recursive: false }),
            });
            const j = (await r.json());
            if (!r.ok) {
                res.status(502).json({ error: JSON.stringify(j).slice(0, 200) });
                return;
            }
            res.json({ folders: (j.entries || []).filter((e) => e['.tag'] === 'folder').map((e) => ({ name: e.name, path: e.path_lower })) });
        }
        catch (err) {
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /github/repos — create a new repo on the caller's GitHub ("make me a new project").
     *  Body: { name, private?, description? }. A data-management-bot tool, usable now from the UI. */
    router.post('/github/repos', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = req.body;
        const name = String(body.name || '').trim().replace(/[^\w.\-]/g, '-').slice(0, 100);
        if (!name) {
            res.status(400).json({ error: 'repo name required' });
            return;
        }
        try {
            const tok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'github');
            if (!tok) {
                res.status(409).json({ error: 'no_github', message: 'Connect GitHub at /utilities first.' });
                return;
            }
            const r = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL', 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, private: body.private !== false, description: (body.description || 'Created by OSHAL').slice(0, 300), auto_init: true }),
            });
            const j = (await r.json());
            if (!r.ok) {
                res.status(r.status === 422 ? 409 : 502).json({ error: j.message || `github ${r.status}` });
                return;
            }
            logger.info({ sub, repo: j.full_name }, 'created GitHub repo');
            res.json({ ok: true, name: j.name, fullName: j.full_name, url: j.html_url });
        }
        catch (err) {
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /github/repos — the caller's GitHub repos (for the picker). */
    router.get('/github/repos', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const tok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'github');
            if (!tok) {
                res.status(409).json({ error: 'no_github' });
                return;
            }
            const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL' } });
            const j = (await r.json());
            if (!r.ok) {
                res.status(502).json({ error: JSON.stringify(j).slice(0, 200) });
                return;
            }
            res.json({ repos: (j || []).map((x) => ({ name: x.name, fullName: x.full_name, private: x.private })) });
        }
        catch (err) {
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /local/list — files in the caller's OSHAL-local store. */
    router.get('/local/list', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const dir = path.join(LOCAL_ROOT, userKey(sub));
        if (!fs.existsSync(dir)) {
            res.json({ files: [] });
            return;
        }
        const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
            .map((e) => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
        res.json({ files });
    });
    /** GET /local/download?name=&dir= — download a file from the caller's OSHAL-local store.
     *  `dir` is an optional bot-scoped subfolder (ADR-043), sanitized against path traversal. */
    router.get('/local/download', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const name = String(req.query.name || '').replace(/[^\w.\- ]/g, '_');
        const dir = (0, storage_target_1.sanitizeSubfolder)(req.query.dir ? String(req.query.dir) : '');
        const file = path.join(LOCAL_ROOT, userKey(sub), dir, name);
        if (!name || !fs.existsSync(file)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.download(file, name);
    });
    /** POST /local/move — move/rename a file within the caller's OSHAL-local store.
     *  Body: { name, toName?, fromDir?, toDir? }. Traversal-guarded; caller-scoped. */
    router.post('/local/move', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        if (!body.name) {
            res.status(400).json({ error: 'name required' });
            return;
        }
        try {
            const r = moveLocalFile(sub, body.name, { toName: body.toName, fromDir: body.fromDir, toDir: body.toDir });
            logger.info({ sub, from: r.from, to: r.to }, 'moved local store file');
            res.json({ ok: true, ...r });
        }
        catch (err) {
            const msg = err.message;
            res.status(msg === 'file not found' ? 404 : 400).json({ error: msg });
        }
    });
    /** GET /local/share?name=&dir= — the authed download link for a file in the caller's OSHAL-local
     *  store (the kernel /api/files/download shape). A signed-in, caller-scoped link — not a public one. */
    router.get('/local/share', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const name = String(req.query.name || '');
        if (!name) {
            res.status(400).json({ error: 'name required' });
            return;
        }
        try {
            const r = shareLocalFile(sub, name, req.query.dir ? String(req.query.dir) : undefined);
            res.json({ ok: true, provider: 'oshal-local', ...r });
        }
        catch (err) {
            const msg = err.message;
            res.status(msg === 'file not found' ? 404 : 400).json({ error: msg });
        }
    });
    return router;
}
//# sourceMappingURL=storage-routes.js.map