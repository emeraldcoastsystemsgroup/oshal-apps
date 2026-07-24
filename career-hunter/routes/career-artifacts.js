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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerArtifacts = registerCareerArtifacts;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const career_hunter_routes_1 = require("./career-hunter-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-artifacts' });
const ARTIFACT_KINDS = new Set(['resume-extra', 'linkedin-export', 'email', 'status-report', 'work-sample', 'other']);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.eml', '.json', '.zip']);
const artifactUpload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });
/** Sanitize an uploaded filename to a safe basename (no path segments, bounded length). */
function safeName(name) {
    return (path.basename(String(name || 'artifact')).replace(/[^\w.\- ]/g, '_')).slice(0, 120) || 'artifact';
}
/** The per-user artifacts dir (under the career store's uploads/). */
function artifactsDir(userSub) {
    return path.join((0, career_hunter_routes_1.userPaths)(userSub).userDir, 'uploads', 'artifacts');
}
/**
 * @description Register the career-artifact routes on the (already auth-gated) career-hunter router.
 * @param router the career-hunter router
 * @param _ctx app context (unused; per-user work is engine-scoped by sub)
 */
function registerCareerArtifacts(router, _ctx) {
    // POST /artifacts/upload — up to 20 files, one `kind` for the batch. Stores each and fires the
    // engine `absorb` verb (async, non-blocking). Returns the accepted files immediately.
    router.post('/artifacts/upload', artifactUpload.array('files', 20), (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const files = req.files || [];
        if (!files.length) {
            res.status(400).json({ error: 'no files' });
            return;
        }
        const kindRaw = String((req.body?.kind || 'other')).trim();
        const kind = ARTIFACT_KINDS.has(kindRaw) ? kindRaw : 'other';
        const dir = artifactsDir(userSub);
        try {
            fs.mkdirSync(dir, { recursive: true });
            const accepted = [];
            const rejected = [];
            for (const f of files) {
                const orig = safeName(f.originalname || 'artifact');
                const ext = path.extname(orig).toLowerCase();
                if (!ALLOWED_EXT.has(ext)) {
                    rejected.push({ name: orig, reason: 'unsupported type' });
                    continue;
                }
                const dest = path.join(dir, `${Date.now()}-${orig}`);
                fs.writeFileSync(dest, f.buffer);
                (0, career_hunter_routes_1.runCliAsync)(userSub, ['absorb'], { CH_ARTIFACT: dest, CH_KIND: kind }); // extract facts -> augment
                accepted.push({ name: orig, kind });
            }
            logger.info({ userSub, kind, accepted: accepted.length, rejected: rejected.length }, 'career artifacts uploaded');
            res.status(accepted.length ? 202 : 400).json({ started: accepted.length > 0, accepted, rejected });
        }
        catch (err) {
            logger.error({ err, userSub }, 'artifact upload failed');
            res.status(500).json({ error: 'upload failed' });
        }
    });
    // GET /artifacts — uploaded artifacts + the most recent profile additions (from enrichment_log),
    // so the surface/agent can show "here's what I learned" after an absorb completes.
    router.get('/artifacts', (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const dir = artifactsDir(userSub);
        let uploaded = [];
        try {
            if (fs.existsSync(dir)) {
                uploaded = fs.readdirSync(dir).map((n) => {
                    const st = fs.statSync(path.join(dir, n));
                    return { name: n.replace(/^\d+-/, ''), size: st.size, at: st.mtime.toISOString() };
                }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
            }
        }
        catch { /* no artifacts yet */ }
        // Recent enrichment-log changelogs (augment writes {at, facts, changelog} per merge).
        const learned = [];
        try {
            const logPath = path.join((0, career_hunter_routes_1.userPaths)(userSub).userDir, 'enrichment_log.jsonl');
            if (fs.existsSync(logPath)) {
                const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-15);
                for (const line of lines) {
                    try {
                        const e = JSON.parse(line);
                        if (Array.isArray(e.changelog) && e.changelog.length)
                            learned.push({ at: String(e.at || ''), changelog: e.changelog });
                    }
                    catch { /* skip malformed line */ }
                }
            }
        }
        catch { /* no log yet */ }
        res.json({ uploaded, learned: learned.reverse() });
    });
}
//# sourceMappingURL=career-artifacts.js.map