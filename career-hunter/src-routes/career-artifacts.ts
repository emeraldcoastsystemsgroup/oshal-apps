/**
 * Career artifacts — upload MORE than a resume into your career profile.
 *
 * The conversational career agent lets a user hand the system work samples, exported emails, a
 * LinkedIn "Download your data" archive, or a status report, and have it learn what they actually
 * do. Each uploaded artifact is stored in the user's own store (uploads/artifacts/) and absorbed
 * by the engine `absorb` verb: extract TRUE career facts → profile.augment() (add-only, backed up,
 * audited to enrichment_log.jsonl). Nothing is ever overwritten; the resume-`ingest` path (whole-
 * profile rebuild) is untouched. The career agent reads the enriched profile on its next turn.
 *
 * Follows ADR-036: this is data-access + a fire-and-forget dispatch to the engine (no reasoning in
 * the controller); the LLM extraction runs in the engine child, same as ingest/tailor/strengthen.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-16 01:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: POST /artifacts/upload (multi-file, kind-tagged, async absorb per file) + GET /artifacts (uploaded list + recent enrichment_log changelogs so the surface/agent can show what was learned).
 *
 * @module career-artifacts
 */
import { type Router, type Request, type Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, userPaths, runCliAsync } from './career-hunter-routes';

const logger = createChildLogger({ module: 'career-artifacts' });

const ARTIFACT_KINDS = new Set(['resume-extra', 'linkedin-export', 'email', 'status-report', 'work-sample', 'other']);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.eml', '.json', '.zip']);
const artifactUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

/** Sanitize an uploaded filename to a safe basename (no path segments, bounded length). */
function safeName(name: string): string {
  return (path.basename(String(name || 'artifact')).replace(/[^\w.\- ]/g, '_')).slice(0, 120) || 'artifact';
}

/** The per-user artifacts dir (under the career store's uploads/). */
function artifactsDir(userSub: string): string {
  return path.join(userPaths(userSub).userDir, 'uploads', 'artifacts');
}

/**
 * @description Register the career-artifact routes on the (already auth-gated) career-hunter router.
 * @param router the career-hunter router
 * @param _ctx app context (unused; per-user work is engine-scoped by sub)
 */
export function registerCareerArtifacts(router: Router, _ctx: AppContext): void {
  // POST /artifacts/upload — up to 20 files, one `kind` for the batch. Stores each and fires the
  // engine `absorb` verb (async, non-blocking). Returns the accepted files immediately.
  router.post('/artifacts/upload', artifactUpload.array('files', 20), (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const files = (req as unknown as { files?: Array<{ buffer: Buffer; originalname?: string }> }).files || [];
    if (!files.length) { res.status(400).json({ error: 'no files' }); return; }
    const kindRaw = String((req.body?.kind || 'other')).trim();
    const kind = ARTIFACT_KINDS.has(kindRaw) ? kindRaw : 'other';
    const dir = artifactsDir(userSub);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const accepted: Array<{ name: string; kind: string }> = [];
      const rejected: Array<{ name: string; reason: string }> = [];
      for (const f of files) {
        const orig = safeName(f.originalname || 'artifact');
        const ext = path.extname(orig).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) { rejected.push({ name: orig, reason: 'unsupported type' }); continue; }
        const dest = path.join(dir, `${Date.now()}-${orig}`);
        fs.writeFileSync(dest, f.buffer);
        runCliAsync(userSub, ['absorb'], { CH_ARTIFACT: dest, CH_KIND: kind }); // extract facts -> augment
        accepted.push({ name: orig, kind });
      }
      logger.info({ userSub, kind, accepted: accepted.length, rejected: rejected.length }, 'career artifacts uploaded');
      res.status(accepted.length ? 202 : 400).json({ started: accepted.length > 0, accepted, rejected });
    } catch (err) {
      logger.error({ err, userSub }, 'artifact upload failed');
      res.status(500).json({ error: 'upload failed' });
    }
  });

  // GET /artifacts — uploaded artifacts + the most recent profile additions (from enrichment_log),
  // so the surface/agent can show "here's what I learned" after an absorb completes.
  router.get('/artifacts', (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const dir = artifactsDir(userSub);
    let uploaded: Array<{ name: string; size: number; at: string }> = [];
    try {
      if (fs.existsSync(dir)) {
        uploaded = fs.readdirSync(dir).map((n) => {
          const st = fs.statSync(path.join(dir, n));
          return { name: n.replace(/^\d+-/, ''), size: st.size, at: st.mtime.toISOString() };
        }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
      }
    } catch { /* no artifacts yet */ }

    // Recent enrichment-log changelogs (augment writes {at, facts, changelog} per merge).
    const learned: Array<{ at: string; changelog: string[] }> = [];
    try {
      const logPath = path.join(userPaths(userSub).userDir, 'enrichment_log.jsonl');
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-15);
        for (const line of lines) {
          try {
            const e = JSON.parse(line) as { at?: string; changelog?: string[] };
            if (Array.isArray(e.changelog) && e.changelog.length) learned.push({ at: String(e.at || ''), changelog: e.changelog });
          } catch { /* skip malformed line */ }
        }
      }
    } catch { /* no log yet */ }
    res.json({ uploaded, learned: learned.reverse() });
  });
}
