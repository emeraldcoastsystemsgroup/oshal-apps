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
exports.MAX_FILE_BYTES = void 0;
exports.mediaType = mediaType;
exports.dropboxPage = dropboxPage;
exports.dropboxLink = dropboxLink;
exports.drivePage = drivePage;
exports.githubPage = githubPage;
exports.createFileSourceRoutes = createFileSourceRoutes;
/**
 * File sources: the person's connected file shares as sources for the shared OSHAL file picker (ADR-139).
 *
 * The kernel's picker (window.oshalPickArtifact) lists every `artifacts.provides` source an admitted application
 * declares and mints a handle from the item the person chooses. Storage declares four: Dropbox, Google Drive, GitHub
 * and the OSHAL-local store. Each listing answers one folder (or a search) as `{items, folders, nextCursor}`; each item's
 * `source` is this module's read-only file route, which the kernel calls under the same person when minting the handle.
 * Under the native kernel the provider calls go through the global fetch with no Authorization header and the kernel
 * applies the person's own connection from the manifest egress block; the package never sees a credential.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: Dropbox, Google Drive, GitHub and OSHAL-local picker sources with folder browsing, a `q` search (Dropbox inside the open folder, Drive by name, GitHub repository names at the top and every path inside a repository, OSHAL-local by name) and read-only file routes capped at the kernel's 4 MiB handle limit; a Dropbox file is read through its temporary link, because the person's Dropbox credential goes only to api.dropboxapi.com. Jarvis's "+ Add" opens the picker over these (operator, 2026-10-29: "+files should bring up our swarm file selector ... across connected folder shares").
 *
 * @module file-sources
 */
const express_1 = require("express");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const kernel_egress_1 = require("./kernel-egress");
const local_notes_1 = require("./local-notes");
const logger = (0, logger_1.createChildLogger)({ module: 'storage-file-sources' });
/** The kernel's artifact handle limit (crates/api artifact_exchange MAX_BYTES): a larger file cannot be chosen. */
exports.MAX_FILE_BYTES = 4 * 1024 * 1024;
/** The picker accepts at most 100 items and 100 folders per page. */
const PAGE = 100;
const BASE = '/api/storage/sources';
const DROPBOX = 'https://api.dropboxapi.com/2/files';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const GITHUB = 'https://api.github.com';
const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL' };
const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
/** Google's own documents have no bytes of their own; each is exported as the closest ordinary file. */
const DRIVE_EXPORTS = {
    'application/vnd.google-apps.document': { type: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.spreadsheet': { type: 'text/csv', ext: '.csv' },
    'application/vnd.google-apps.presentation': { type: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.drawing': { type: 'image/png', ext: '.png' },
};
const LOCAL_ROOT = path.join(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'userfiles');
const EXTENSION_TYPES = {
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv',
    tsv: 'text/tab-separated-values', json: 'application/json', html: 'text/html', htm: 'text/html', xml: 'text/xml',
    yml: 'text/yaml', yaml: 'text/yaml', log: 'text/plain', rtf: 'application/rtf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
    stl: 'model/stl', js: 'text/javascript', ts: 'text/plain', py: 'text/x-python', sh: 'text/plain', rs: 'text/plain',
};
/** A provider refusal the route answers with its own status. */
class SourceError extends Error {
    status;
    constructor(status, message) { super(message); this.status = status; }
}
/**
 * @description The media type the listing and the file route both report for a name, so the kernel's handle check
 * (listed type equals served type) always holds.
 * @param name - The file name.
 * @returns A `kind/subtype` type; application/octet-stream when the extension is unknown.
 */
function mediaType(name) {
    const ext = String(name).toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || '';
    return EXTENSION_TYPES[ext] || 'application/octet-stream';
}
/** The search words, or '' when none: at most 100 characters. */
function searchWords(req) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100)
        throw new SourceError(400, 'Search for at most 100 characters.');
    return q;
}
/** The opaque picker cursor, at most 4096 characters. */
function cursorOf(req) {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
    if (cursor.length > 4096)
        throw new SourceError(400, 'invalid cursor');
    return cursor;
}
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** A file route for one item: a canonical same-origin path with its selector in the query. */
function fileSource(provider, params) {
    return `${BASE}/${provider}/file?${new URLSearchParams(params).toString()}`;
}
/** Whether a name matches the search words, ignoring case. */
function named(name, q) {
    return !q || name.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}
/** The picker's item for one file, or none when the file is a type the picker refuses. */
function item(name, size, source, type = mediaType(name)) {
    return { name, type, ...(Number.isFinite(size) ? { size: Number(size) } : {}), source };
}
/**
 * @description The provider's authorization for one call: the brokered token on the legacy framework; under the kernel
 * the sentinel unless the person's connection metadata says they have no usable connection for it.
 */
async function providerToken(ctx, sub, connector) {
    if (!(0, kernel_egress_1.kernelEgress)())
        return (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, connector === 'google' ? 'google-drive' : connector);
    const meta = await (0, kernel_egress_1.readConnections)(ctx);
    if (!meta || !Array.isArray(meta.connections))
        return kernel_egress_1.KERNEL_TOKEN;
    return (0, kernel_egress_1.usableProviders)(meta).includes(connector) ? kernel_egress_1.KERNEL_TOKEN : null;
}
/** Provider request headers: the brokered Bearer on the legacy path; none under the kernel, which applies the connection. */
function authHeaders(token, extra) {
    return (0, kernel_egress_1.kernelEgress)() ? { ...extra } : { Authorization: `Bearer ${token}`, ...extra };
}
/** JSON from one provider call, refusing a non-2xx answer with the provider's status in words. */
async function providerJson(label, url, init) {
    const r = await fetch(url, init);
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403)
        throw new SourceError(409, `${label} refused the request. Reconnect ${label} in Connections.`);
    if (r.status === 404)
        throw new SourceError(404, `That ${label} folder or file was not found.`);
    if (!r.ok)
        throw new SourceError(502, `${label} answered HTTP ${r.status}.`);
    return body;
}
/** Bytes from one provider call, refusing an answer over the handle limit. */
async function providerBytes(label, url, init) {
    const r = await fetch(url, init);
    if (r.status === 404)
        throw new SourceError(404, `That ${label} file was not found.`);
    if (!r.ok)
        throw new SourceError(502, `${label} answered HTTP ${r.status}.`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > exports.MAX_FILE_BYTES)
        throw new SourceError(413, 'That file is larger than 4 MB, the most a chat can take.');
    return bytes;
}
/** The answer for a source the person has not connected. */
function notConnected(label) {
    return { items: [], folders: [], nextCursor: null, emptyMessage: `${label} is not connected. Connect it in Connections, then open this again.` };
}
/** A Dropbox listing entry as the picker shows it. */
function dropboxEntry(e, page, q) {
    if (!e || typeof e.name !== 'string' || !named(e.name, q))
        return;
    if (e['.tag'] === 'folder')
        page.folders.push({ name: e.name, cursor: `p:${e.path_lower}` });
    else if (e['.tag'] === 'file')
        page.items.push(item(e.name, e.size, fileSource('dropbox', { path: e.path_lower })));
}
/**
 * @description One Dropbox page: a folder (`p:<path>`), its continuation (`c:<cursor>`), or a search inside the open
 * folder (`q`, continued with `s:<cursor>`).
 * @param token - The provider authorization.
 * @param cursor - The picker cursor.
 * @param q - The search words.
 * @returns The page.
 */
async function dropboxPage(token, cursor, q) {
    const headers = authHeaders(token, { 'Content-Type': 'application/json' });
    const folder = cursor.startsWith('p:') ? cursor.slice(2) : '';
    const page = { items: [], folders: [], nextCursor: null };
    if (q || cursor.startsWith('s:')) {
        const body = cursor.startsWith('s:') ? { cursor: cursor.slice(2) }
            : { query: q, options: { path: folder, max_results: PAGE, filename_only: true } };
        const url = `${DROPBOX}/search${cursor.startsWith('s:') ? '/continue' : ''}_v2`;
        const j = await providerJson('Dropbox', url, { method: 'POST', headers, body: JSON.stringify(body) });
        for (const match of Array.isArray(j.matches) ? j.matches : [])
            dropboxEntry(match?.metadata?.metadata, page, '');
        if (j.has_more && j.cursor)
            page.nextCursor = `s:${j.cursor}`;
        return page;
    }
    const continued = cursor.startsWith('c:');
    const url = `${DROPBOX}/list_folder${continued ? '/continue' : ''}`;
    const body = continued ? { cursor: cursor.slice(2) } : { path: folder, limit: PAGE, recursive: false };
    const j = await providerJson('Dropbox', url, { method: 'POST', headers, body: JSON.stringify(body) });
    for (const e of Array.isArray(j.entries) ? j.entries : [])
        dropboxEntry(e, page, '');
    if (j.has_more && j.cursor)
        page.nextCursor = `c:${j.cursor}`;
    return page;
}
/** Whether a Dropbox temporary link is an https link on Dropbox's own download domain. */
function dropboxLink(link) {
    let url;
    try {
        url = new URL(String(link));
    }
    catch {
        throw new SourceError(502, 'Dropbox returned an invalid download link.');
    }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.dropboxusercontent.com'))
        throw new SourceError(502, 'Dropbox returned an invalid download link.');
    return url.toString();
}
/**
 * One Dropbox file's bytes and type. The person's Dropbox credential goes only to api.dropboxapi.com (the connector's
 * catalog host), so the bytes come from the short-lived link it issues, which carries no credential.
 */
async function dropboxFile(token, req) {
    const file = typeof req.query.path === 'string' ? req.query.path : '';
    if (!file.startsWith('/') || file.length > 1024 || file.split('/').some((p) => p === '..'))
        throw new SourceError(400, 'invalid Dropbox path');
    const headers = authHeaders(token, { 'Content-Type': 'application/json' });
    const j = await providerJson('Dropbox', `${DROPBOX}/get_temporary_link`, { method: 'POST', headers, body: JSON.stringify({ path: file }) });
    if (Number(j?.metadata?.size) > exports.MAX_FILE_BYTES)
        throw new SourceError(413, 'That file is larger than 4 MB, the most a chat can take.');
    return { bytes: await providerBytes('Dropbox', dropboxLink(j?.link), {}), type: mediaType(file) };
}
/** A Drive file's picker name and type: Google's own documents carry their export type and extension. */
function driveShape(f) {
    const exported = DRIVE_EXPORTS[f.mimeType];
    if (exported)
        return { name: f.name.toLowerCase().endsWith(exported.ext) ? f.name : f.name + exported.ext, type: exported.type };
    const own = String(f.mimeType || '').split(';')[0].trim().toLowerCase();
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(own) && own !== 'application/octet-stream' ? own : mediaType(f.name);
    return { name: f.name, type };
}
/** A Drive search literal: backslash and quote escaped. */
function driveLiteral(text) {
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
/**
 * @description One Google Drive page: a folder (`f:<id>`, continued as `f:<id>|<pageToken>`), or a search by name
 * across the whole Drive (`q`, continued as `n:<pageToken>`).
 * @param token - The provider authorization.
 * @param cursor - The picker cursor.
 * @param q - The search words.
 * @returns The page.
 */
async function drivePage(token, cursor, q) {
    const searching = Boolean(q) || cursor.startsWith('n:');
    const [folder, pageToken] = searching ? ['', cursor.slice(2)] : (cursor.startsWith('f:') ? cursor.slice(2) : 'root').split('|');
    if (!searching && !/^[\w-]{1,200}$/.test(folder))
        throw new SourceError(400, 'invalid Drive folder');
    const filter = searching ? `name contains '${driveLiteral(q)}' and trashed = false` : `'${folder}' in parents and trashed = false`;
    const url = new URL(DRIVE);
    url.searchParams.set('q', filter);
    url.searchParams.set('pageSize', String(PAGE));
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size)');
    url.searchParams.set('orderBy', 'folder,name');
    if (pageToken)
        url.searchParams.set('pageToken', pageToken);
    const j = await providerJson('Google Drive', url.toString(), { headers: authHeaders(token, {}) });
    const page = { items: [], folders: [], nextCursor: null };
    for (const f of Array.isArray(j.files) ? j.files : []) {
        if (!f || typeof f.name !== 'string' || !/^[\w-]{1,200}$/.test(String(f.id)))
            continue;
        if (f.mimeType === DRIVE_FOLDER) {
            page.folders.push({ name: f.name, cursor: `f:${f.id}` });
            continue;
        }
        if (String(f.mimeType).startsWith('application/vnd.google-apps.') && !DRIVE_EXPORTS[f.mimeType])
            continue;
        const shape = driveShape(f);
        page.items.push(item(shape.name, f.size === undefined ? undefined : Number(f.size), fileSource('google-drive', { id: f.id }), shape.type));
    }
    if (j.nextPageToken)
        page.nextCursor = searching ? `n:${j.nextPageToken}` : `f:${folder}|${j.nextPageToken}`;
    return page;
}
/** One Drive file's bytes and type: Google's own documents are exported, everything else downloaded. */
async function driveFile(token, req) {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!/^[\w-]{1,200}$/.test(id))
        throw new SourceError(400, 'invalid Drive file');
    const headers = authHeaders(token, {});
    const meta = await providerJson('Google Drive', `${DRIVE}/${id}?fields=id,name,mimeType,size`, { headers });
    if (meta.mimeType === DRIVE_FOLDER)
        throw new SourceError(400, 'That is a folder, not a file.');
    if (Number(meta.size) > exports.MAX_FILE_BYTES)
        throw new SourceError(413, 'That file is larger than 4 MB, the most a chat can take.');
    const exported = DRIVE_EXPORTS[meta.mimeType];
    const url = exported ? `${DRIVE}/${id}/export?mimeType=${encodeURIComponent(exported.type)}` : `${DRIVE}/${id}?alt=media`;
    return { bytes: await providerBytes('Google Drive', url, { headers }), type: driveShape(meta).type };
}
/** An `owner/repo` name GitHub accepts. */
function repoName(value) {
    if (!/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(value) || value.includes('..'))
        throw new SourceError(400, 'invalid repository');
    return value;
}
/** A repository path: no empty, `.` or `..` parts. */
function repoPath(value) {
    const parts = value.split('/').filter(Boolean);
    if (value.length > 1024 || parts.some((p) => p === '.' || p === '..'))
        throw new SourceError(400, 'invalid repository path');
    return parts.join('/');
}
/** A repository path for a GitHub URL, each part escaped. */
function pathUrl(value) {
    return value.split('/').map(encodeURIComponent).join('/');
}
/** The person's repositories as folders, one page of 100 (`r:<page>`), filtered by name when searching. */
async function githubRepos(token, cursor, q) {
    const pageNumber = cursor.startsWith('r:') ? Number(cursor.slice(2)) : 1;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50)
        throw new SourceError(400, 'invalid cursor');
    const url = `${GITHUB}/user/repos?per_page=${PAGE}&sort=updated&page=${pageNumber}`;
    const repos = await providerJson('GitHub', url, { headers: authHeaders(token, GITHUB_HEADERS) });
    const list = Array.isArray(repos) ? repos : [];
    const folders = list.filter((r) => typeof r?.full_name === 'string' && named(r.full_name, q))
        .map((r) => ({ name: r.full_name, cursor: `g:${r.full_name}:` }));
    const nextCursor = list.length === PAGE ? `r:${pageNumber + 1}` : null;
    return { items: [], folders, nextCursor, ...(q && !folders.length && nextCursor ? { emptyMessage: 'No matching repository on this page.' } : {}) };
}
/** Every path in one repository whose path contains the search words, from its default branch's tree. */
async function githubSearch(token, repo, under, q) {
    const headers = authHeaders(token, GITHUB_HEADERS);
    const meta = await providerJson('GitHub', `${GITHUB}/repos/${repo}`, { headers });
    const branch = encodeURIComponent(String(meta.default_branch || 'main'));
    const tree = await providerJson('GitHub', `${GITHUB}/repos/${repo}/git/trees/${branch}?recursive=1`, { headers });
    const page = { items: [], folders: [], nextCursor: null };
    const prefix = under ? `${under}/` : '';
    for (const entry of Array.isArray(tree.tree) ? tree.tree : []) {
        const p = String(entry?.path || '');
        if (!p.startsWith(prefix) || !named(p.slice(prefix.length), q))
            continue;
        if (entry.type === 'tree' && page.folders.length < PAGE)
            page.folders.push({ name: p, cursor: `g:${repo}:${p}` });
        if (entry.type === 'blob' && page.items.length < PAGE)
            page.items.push(item(p, entry.size, fileSource('github', { repo, path: p })));
    }
    if (tree.truncated)
        page.emptyMessage = 'This repository is too large to search completely; open its folders instead.';
    return page;
}
/**
 * @description One GitHub page: the person's repositories (`r:<page>`), one folder of a repository (`g:<owner/repo>:<path>`),
 * or, with `q`, matching repository names at the top and matching paths anywhere under the open folder inside one.
 * @param token - The provider authorization.
 * @param cursor - The picker cursor.
 * @param q - The search words.
 * @returns The page.
 */
async function githubPage(token, cursor, q) {
    if (!cursor.startsWith('g:'))
        return githubRepos(token, cursor, q);
    const rest = cursor.slice(2);
    const split = rest.indexOf(':');
    if (split < 0)
        throw new SourceError(400, 'invalid cursor');
    const repo = repoName(rest.slice(0, split));
    const under = repoPath(rest.slice(split + 1));
    if (q)
        return githubSearch(token, repo, under, q);
    const listing = await providerJson('GitHub', `${GITHUB}/repos/${repo}/contents/${pathUrl(under)}`, { headers: authHeaders(token, GITHUB_HEADERS) });
    const page = { items: [], folders: [], nextCursor: null };
    for (const e of (Array.isArray(listing) ? listing : []).slice(0, 1000)) {
        if (typeof e?.name !== 'string' || typeof e?.path !== 'string')
            continue;
        if (e.type === 'dir' && page.folders.length < PAGE)
            page.folders.push({ name: e.name, cursor: `g:${repo}:${e.path}` });
        if (e.type === 'file' && page.items.length < PAGE)
            page.items.push(item(e.name, e.size, fileSource('github', { repo, path: e.path })));
    }
    return page;
}
/** One GitHub file's raw bytes and type. */
async function githubFile(token, req) {
    const repo = repoName(typeof req.query.repo === 'string' ? req.query.repo : '');
    const file = repoPath(typeof req.query.path === 'string' ? req.query.path : '');
    if (!file)
        throw new SourceError(400, 'invalid repository path');
    const headers = authHeaders(token, { ...GITHUB_HEADERS, Accept: 'application/vnd.github.raw' });
    return { bytes: await providerBytes('GitHub', `${GITHUB}/repos/${repo}/contents/${pathUrl(file)}`, { headers }), type: mediaType(file) };
}
/** The legacy framework's per-user OSHAL-local directory (the same key storage-routes uses). */
function legacyLocalDir(sub) {
    return path.join(LOCAL_ROOT, crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32));
}
/** The OSHAL-local store: one page of the person's saved files, filtered by name when searching. */
async function localPage(ctx, sub, q) {
    const files = await (0, local_notes_1.listLocal)(ctx, sub, legacyLocalDir);
    const items = files.filter((f) => named(f.name, q)).slice(0, PAGE)
        .map((f) => item(f.name, f.size, fileSource('local', { name: f.name })));
    return { items, folders: [], nextCursor: null, ...(!items.length ? { emptyMessage: q ? 'No matching saved file.' : 'Nothing is saved in your OSHAL-local store yet.' } : {}) };
}
/** One OSHAL-local file's bytes and type, read through the kernel's file store for this person. */
async function localFile(ctx, sub, req) {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    const listed = (await (0, local_notes_1.listLocal)(ctx, sub, legacyLocalDir)).find((f) => f.name === name);
    if (!name || !listed)
        throw new SourceError(404, 'That saved file was not found.');
    if (listed.size > exports.MAX_FILE_BYTES)
        throw new SourceError(413, 'That file is larger than 4 MB, the most a chat can take.');
    const intent = ctx.intent;
    if (process.env.OSHAL_EGRESS !== 'kernel' || typeof intent !== 'function')
        throw new SourceError(501, 'Saved files open from Files on this installation.');
    const read = await intent.call(ctx, 'storage.read', { path: name, provider: 'oshal-local', subject: sub });
    return { bytes: Buffer.from(String(read?.content || ''), 'base64'), type: mediaType(name) };
}
/** The remote providers: label, connection, page reader and file reader. */
const PROVIDERS = {
    dropbox: { label: 'Dropbox', connector: 'dropbox', page: dropboxPage, file: dropboxFile },
    'google-drive': { label: 'Google Drive', connector: 'google', page: drivePage, file: driveFile },
    github: { label: 'GitHub', connector: 'github', page: githubPage, file: githubFile },
};
/** Answer a refusal in the route's own words; a kernel "not connected" egress refusal is the not-connected page. */
function refuse(res, err, label, listing) {
    if ((0, kernel_egress_1.isNotConnected)(err)) {
        if (listing)
            res.json(notConnected(label));
        else
            res.status(409).json({ error: `${label} is not connected.` });
        return;
    }
    const status = err instanceof SourceError ? err.status : 502;
    if (!(err instanceof SourceError))
        logger.error({ err, provider: label }, 'file source failed');
    res.status(status).json({ error: err instanceof SourceError ? err.message : `${label} is unavailable right now.` });
}
/** Register the listing and file route for one remote provider. */
function remoteRoutes(router, ctx, id) {
    const p = PROVIDERS[id];
    router.get(`/${id}`, async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const started = Date.now();
        try {
            const token = await providerToken(ctx, sub, p.connector);
            res.set('Cache-Control', 'private, no-store');
            if (!token) {
                res.json(notConnected(p.label));
                return;
            }
            res.json(await p.page(token, cursorOf(req), searchWords(req)));
            logger.info({ provider: id, durationMs: Date.now() - started }, 'file source listed');
        }
        catch (err) {
            refuse(res, err, p.label, true);
        }
    });
    router.get(`/${id}/file`, async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const token = await providerToken(ctx, sub, p.connector);
            if (!token) {
                res.status(409).json({ error: `${p.label} is not connected.` });
                return;
            }
            const { bytes, type } = await p.file(token, req);
            res.set('Cache-Control', 'private, no-store').set('Content-Type', type).send(bytes);
        }
        catch (err) {
            refuse(res, err, p.label, false);
        }
    });
}
/**
 * @description Builds the file-source router (mount at /api/storage/sources, requiresAuth): every route is a read for
 * the signed-in person, under their own connections.
 * @param ctx - The application context.
 * @returns The router.
 */
function createFileSourceRoutes(ctx) {
    const router = (0, express_1.Router)();
    for (const id of Object.keys(PROVIDERS))
        remoteRoutes(router, ctx, id);
    router.get('/local', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.set('Cache-Control', 'private, no-store').json(await localPage(ctx, sub, searchWords(req)));
        }
        catch (err) {
            refuse(res, err, 'OSHAL-local', true);
        }
    });
    router.get('/local/file', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const { bytes, type } = await localFile(ctx, sub, req);
            res.set('Cache-Control', 'private, no-store').set('Content-Type', type).send(bytes);
        }
        catch (err) {
            refuse(res, err, 'OSHAL-local', false);
        }
    });
    return router;
}
//# sourceMappingURL=file-sources.js.map