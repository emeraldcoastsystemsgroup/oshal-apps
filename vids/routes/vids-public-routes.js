/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 19:35:00 | roger.murphy@emeraldcoastsystemsgroup.com | Vids PUBLIC publish surface (BACKLOG "Vids — per-user PUBLIC publish directory"): a public, unauthenticated, READ-ONLY route that serves finished, explicitly-published renders from a per-user (user_sub-keyed) publish directory ONLY. Nothing about jobs/prompts/queue is ever public; the job API (/api/vids) stays auth-gated. Mounted at /api/vids-public (NOT the entry's illustrative /public/vids) because the swarm-app loader (ADR-085 D2) requires a public mount to sit under /api/<name>; the surface is otherwise exactly as described. Fails closed: an unsafe slug/file, a missing file, a non-file, or a path resolving outside the slug dir all 404, and there is NO directory listing. DEFERRED (sharing model unclear → fail closed): the publish/unpublish COPY action. The finished render is produced on the remote worker's Google Vids and published externally by the worker — no render file exists in the controller to copy in. Wiring publish needs the worker to hand back a downloadable asset; it then lands in vidsPublicRoot()/<vidsPublicSlug(sub)>/ and THIS route serves it.
 */
'use strict';
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
exports.vidsPublicRoot = vidsPublicRoot;
exports.vidsPublicSlug = vidsPublicSlug;
exports.createVidsPublicRoutes = createVidsPublicRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'vids-public-routes' });
/** Root of the per-user public publish store (user_sub-keyed subdirs, like the bot-owned stores). */
const PUBLIC_ROOT = path.join(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'vids-public');
/** @description The publish-directory root — a publisher drops a finished render into <root>/<slug>/. */
function vidsPublicRoot() { return PUBLIC_ROOT; }
/** @description The per-user public slug (sha256(sub)[:32]) — the directory name THIS route serves for a user. */
function vidsPublicSlug(sub) { return crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32); }
/** A safe published-file basename: word/dot/dash only, has an extension, no traversal, <=128 chars. */
function isSafeFile(name) {
    return /^[\w-][\w.\-]{0,127}$/.test(name) && name.includes('.') && !name.includes('..') && path.basename(name) === name;
}
/** A safe slug: a hex directory name (matches vidsPublicSlug's output). */
function isSafeSlug(slug) { return /^[a-f0-9]{16,64}$/.test(slug); }
/**
 * @description The Vids PUBLIC surface. `GET /:slug/:file` serves ONLY a finished, published render
 * from <PUBLIC_ROOT>/<slug>/<file>, read-only + anonymous. Fails closed: an unsafe slug/file, a
 * missing file, a non-file, or a path resolving outside the slug directory all 404. No listing.
 * @param _ctx - app context (the mounter always supplies it; this read-only file surface needs no DB)
 * @returns the public router (mount at /api/vids-public — ADR-085 D2)
 */
function createVidsPublicRoutes(_ctx) {
    const router = (0, express_1.Router)();
    router.get('/:slug/:file', (req, res) => {
        const slug = String(req.params.slug || '');
        const file = String(req.params.file || '');
        if (!isSafeSlug(slug) || !isSafeFile(file)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const dir = path.resolve(PUBLIC_ROOT, slug);
        const abs = path.resolve(dir, file);
        if (abs !== path.join(dir, file) || !abs.startsWith(dir + path.sep)) {
            res.status(404).json({ error: 'not found' });
            return;
        } // defense in depth
        let st;
        try {
            st = fs.statSync(abs);
        }
        catch {
            res.status(404).json({ error: 'not found' });
            return;
        }
        if (!st.isFile()) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.sendFile(abs, { dotfiles: 'deny' }, (err) => {
            if (err && !res.headersSent) {
                logger.warn({ err: String(err), slug, file }, 'vids public serve failed');
                res.status(404).end();
            }
        });
    });
    return router;
}
//# sourceMappingURL=vids-public-routes.js.map