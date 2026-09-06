/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-135 P1 — the print inbox: intake, the classification form, approve/reject, and fan-out ingest. Design choices worth knowing. Intake takes TEXT, not the binary: the printer already recovers a document's text from XPS, so the swarm never parses untrusted binary and the original stays on the machine that produced it. Everything in the sidecar is attacker-controlled LAN input, so it is length-capped and control-stripped before it is stored or logged, and it NEVER derives owner_sub, a collection name, or a bot id. Idempotency is the content hash: reprinting a document returns the original intake instead of queueing a duplicate. Approval writes only what the human ticked, records where every copy went (the sole basis for a later retraction, since core RAG cannot delete one document), and reports a partial fan-out as partially_ingested rather than as success or as total failure.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-139 wave 1 — POST /documents/import-artifact {ref}: the "Send to…" destination. Redeems the owner-bound handle + extracts its text on the kernel doc-extract rail (loopback, as the caller), then files the result through THIS package's own /documents intake — same text-not-binary posture, same dedupe/rules/approval queue. Two loopback hops on purpose: zero duplication of the intake logic, and the kernel keeps the only binary parser.
 *
 * @module print-ingest-routes
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-141 readiness (0.2.1): GET /readiness answers the Intelligent Career group's "subscribe to the print service" step from the caller's own print_intake rows — done once a printed document has actually reached this inbox; asked in the user's session by the kernel setup dashboard.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { RagService } from '@/features/rag';
import {
  buildRecommendation,
  ruleMayAutoApprove,
  type AssociationRule,
  type Destination,
  type PrintSidecar,
  destinationCatalog,
  destinationsForCaller,
  isOperatorIdentity,
  type Recommendation,
} from './print-classify';
import { executeFanout, planFanout, stateForResults, type RagIngestPort } from './print-fanout';

const logger = createChildLogger({ module: 'print-ingest-routes' });

/** Documents are text by the time they reach here; this bounds one intake. */
const MAX_TEXT_CHARS = 500_000;
/** Every sidecar string is untrusted network input. */
const MAX_FIELD = 200;

/** The app context the mounter hands a package route. */
interface AppContext {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
  appPackageDir?: string;
}

/**
 * @description The acting user's sub — the signed-in caller, or the trusted sub of
 * an internal service call. Same precedence every store package uses.
 * @param req - The incoming request.
 * @returns The caller's sub, or null when unauthenticated.
 */
function callerSub(req: Request): string | null {
  const trusted = getTrustedServiceUserSub(req);
  if (trusted) return String(trusted);
  const injected = (req as unknown as { oshalCallerSub?: string }).oshalCallerSub;
  if (injected) return String(injected);
  const user = (req as unknown as { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = user?.sub || user?.oid;
  return sub ? String(sub) : null;
}

/**
 * @description Whether the caller may file into the kernel-reserved swarm level.
 * Generic ingest there is refused for non-admins, so the form must not offer it —
 * a missing option beats a write that fails after the person believed they filed.
 * Reads the kernel's operator allowlist rather than an OIDC `roles` claim: found
 * by live test, a personal-access-token session carries no roles, so a genuine
 * operator was silently denied the destination.
 * @param req - The incoming request.
 * @returns True when the caller is an operator/admin.
 */
function callerIsAdmin(req: Request): boolean {
  const user = (req as unknown as { oidc?: { user?: { email?: string; roles?: unknown } } }).oidc?.user;
  if (isOperatorIdentity(callerSub(req), user?.email)) return true;
  const roles = Array.isArray(user?.roles) ? (user?.roles as unknown[]).map(String) : [];
  return roles.includes('operator') || roles.includes('admin');
}

/**
 * @description Reduce one untrusted sidecar string to something safe to store,
 * log and render: control characters removed, length bounded.
 * @param value - The raw value.
 * @returns A bounded printable string.
 */
function safeField(value: unknown): string {
  // Filtered by code point rather than a control-character regex literal: an
  // inline control class is exactly what an editor silently mangles.
  const printable = String(value ?? '')
    .split('')
    .filter((ch) => { const code = ch.charCodeAt(0); return code >= 32 && code !== 127; })
    .join('');
  return printable.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD);
}

/**
 * @description Normalize a received sidecar. Unknown keys are dropped rather than
 * stored, so a hostile sender cannot smuggle fields into the audit record.
 * @param raw - The sidecar as received.
 * @returns The bounded sidecar.
 */
function normalizeSidecar(raw: unknown): PrintSidecar {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    jobName: safeField(input.jobName),
    documentName: safeField(input.documentName),
    requestingUser: safeField(input.requestingUser),
    originatingComputer: safeField(input.originatingComputer),
    clientIp: safeField(input.clientIp),
    printerName: safeField(input.printerName),
    source: safeField(input.source),
    receivedAt: safeField(input.receivedAt),
    textCharacters: Number(input.textCharacters) || 0,
    textPages: Number(input.textPages) || 0,
  };
}

/**
 * @description Load this owner's enabled association rules.
 * @param ctx - The app context.
 * @param ownerSub - The caller's sub.
 * @returns The rules, newest first.
 */
async function loadRules(ctx: AppContext, ownerSub: string): Promise<AssociationRule[]> {
  const { rows } = await ctx.pool.query(
    `SELECT rule_id, label, match_client_ip, match_computer, match_printer,
            suggested_user_sub, destinations, auto_approve, enabled
       FROM print_intake_rule
      WHERE owner_sub = $1 AND enabled = true
      ORDER BY created_at DESC`,
    [ownerSub],
  );
  return rows.map((row) => ({
    ruleId: String(row.rule_id),
    label: String(row.label),
    matchClientIp: row.match_client_ip as string | null,
    matchComputer: row.match_computer as string | null,
    matchPrinter: row.match_printer as string | null,
    suggestedUserSub: row.suggested_user_sub as string | null,
    destinations: Array.isArray(row.destinations) ? (row.destinations as string[]).map(String) : [],
    autoApprove: Boolean(row.auto_approve),
    enabled: Boolean(row.enabled),
  }));
}

/**
 * @description Shape one intake row for a surface.
 * @param row - The database row.
 * @returns The API representation.
 */
function presentIntake(row: Record<string, unknown>): Record<string, unknown> {
  return {
    intakeId: row.intake_id,
    title: row.title,
    state: row.state,
    textChars: row.text_chars,
    contentSha256: row.content_sha256,
    sidecar: row.sidecar,
    recommendation: row.recommendation,
    approvedDestinations: row.approved_destinations,
    fanout: row.fanout,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/**
 * @description Build the print-ingest routes.
 * @param ctx - The app context (pool, package dir).
 * @returns The Express router.
 */
export function createPrintIngestRoutes(ctx: AppContext): Router {
  const router = Router();
  const ragService = new RagService();
  const rag: RagIngestPort = {
    ingest: async (payload) => {
      // Chunk metadata is a flat string map in core; coerce here rather than
      // letting a non-string slip in and be stringified inconsistently later.
      const metadata: Record<string, string> = { title: payload.title };
      for (const [key, value] of Object.entries(payload.metadata)) {
        metadata[key] = typeof value === 'string' ? value : String(value ?? '');
      }
      if (payload.private) metadata.visibility = 'private';
      await ragService.ingest([payload.content], payload.collection, metadata);
    },
  };

  /** GET /readiness — ADR-141 per-user readiness for the Intelligent Career group's "subscribe to
   *  the print service" step. The only honest proof a subscription works end to end is a printed
   *  document that reached THIS caller's inbox, so that is what is counted — from the caller's own
   *  print_intake rows, asked in the signed-in user's session by the kernel setup dashboard. */
  router.get('/readiness', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    try {
      const { rows } = await ctx.pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE state = 'awaiting_approval')::int AS awaiting
           FROM print_intake WHERE owner_sub = $1`,
        [sub],
      );
      const total = Number(rows[0]?.total || 0);
      const awaiting = Number(rows[0]?.awaiting || 0);
      const detail = total === 0
        ? 'No printed document has reached the swarm yet — install the oshal printer from Get oshal, then print anything to it.'
        : `${total} document${total === 1 ? '' : 's'} received${awaiting ? `, ${awaiting} awaiting your approval` : ''}.`;
      res.json({ subscription: { ready: total > 0, total, awaiting, detail } });
    } catch (err) {
      logger.error({ err }, 'print-ingest readiness failed');
      res.status(500).json({ error: 'readiness unavailable' });
    }
  });

  /** The catalog a surface renders the form from. */
  router.get('/destinations', (req: Request, res: Response) => {
    const admin = callerIsAdmin(req);
    res.json({ destinations: destinationsForCaller(destinationCatalog(), admin) });
  });

  /** Intake. The edge posts extracted TEXT plus the sidecar; the binary stays put. */
  router.post('/documents', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const body = (req.body || {}) as Record<string, unknown>;
    const text = String(body.text || '');
    if (!text.trim()) {
      res.status(422).json({ error: 'no_text', detail: 'the document carried no recoverable text' });
      return;
    }
    if (text.length > MAX_TEXT_CHARS) {
      res.status(413).json({ error: 'too_large', detail: `text exceeds ${MAX_TEXT_CHARS} characters` });
      return;
    }
    const sidecar = normalizeSidecar(body.sidecar);
    const contentSha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');

    const existing = await ctx.pool.query(
      'SELECT * FROM print_intake WHERE owner_sub = $1 AND content_sha256 = $2',
      [sub, contentSha256],
    );
    if (existing.rows.length) {
      res.status(200).json({ duplicate: true, intake: presentIntake(existing.rows[0]) });
      return;
    }

    const rules = await loadRules(ctx, sub);
    const catalog = destinationCatalog();
    const recommendation = buildRecommendation({
      sidecar, text, destinations: catalog, rules, callerIsAdmin: callerIsAdmin(req),
    });

    const inserted = await ctx.pool.query(
      `INSERT INTO print_intake
         (owner_sub, content_sha256, title, text_chars, text_body, sidecar, recommendation, applied_rule_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       RETURNING *`,
      [sub, contentSha256, recommendation.title, text.length, text,
        JSON.stringify(sidecar), JSON.stringify(recommendation),
        recommendation.appliedRule?.ruleId || null],
    );
    res.status(201).json({
      intake: presentIntake(inserted.rows[0]),
      autoApprovable: ruleMayAutoApprove(recommendation, catalog),
    });
  });

  /** POST /documents/import-artifact — the ADR-139 "Send to…" destination: {ref} redeems the
   *  owner-bound handle, extracts its text on the kernel doc-extract rail, and files the result
   *  through this package's OWN /documents intake (same dedupe, rules, and approval queue —
   *  and the same text-not-binary posture: the kernel keeps the only binary parser). */
  router.post('/documents/import-artifact', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const ref = String((req.body as Record<string, unknown> | undefined)?.ref ?? '');
    if (!/^art_[A-Za-z0-9_-]{8,64}$/.test(ref)) { res.status(400).json({ error: 'a valid artifact ref is required' }); return; }
    const secret = (process.env.SWARM_SERVICE_SECRET || '').trim();
    if (!secret) { res.status(503).json({ error: 'artifact relay unconfigured' }); return; }
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    const headers = { 'x-service-secret': secret, 'x-oshal-user-sub': sub, 'Content-Type': 'application/json' };
    try {
      const extracted = await fetch(`${base}/api/artifacts/builtin/extract-text`, {
        method: 'POST', headers, body: JSON.stringify({ ref }),
      });
      const doc = await extracted.json() as { ok?: boolean; name?: string; text?: string; reason?: string; error?: string };
      if (!extracted.ok || !doc.ok || !doc.text) {
        res.status(extracted.status === 404 ? 404 : 422).json({ error: doc.reason || doc.error || 'could not read that artifact as text' });
        return;
      }
      const filed = await fetch(`${base}/api/print-ingest/documents`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: doc.text, sidecar: { documentName: doc.name, source: 'send-to' } }),
      });
      const out = await filed.json() as Record<string, unknown>;
      res.status(filed.status).json({
        ...out,
        ...(filed.ok ? { message: out.duplicate ? 'Already filed earlier (same content)' : `Filed for approval: ${doc.name}` } : {}),
      });
    } catch (err) {
      res.status(502).json({ error: 'artifact import failed' });
    }
  });

  /** The inbox. */
  router.get('/documents', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const { rows } = await ctx.pool.query(
      `SELECT * FROM print_intake
        WHERE owner_sub = $1 AND ($2::text IS NULL OR state = $2)
        ORDER BY created_at DESC LIMIT 200`,
      [sub, state],
    );
    res.json({ documents: rows.map(presentIntake) });
  });

  /** Approve: write only what was ticked, record where every copy went. */
  router.post('/documents/:id/approve', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const body = (req.body || {}) as Record<string, unknown>;
    const approved = Array.isArray(body.destinations) ? body.destinations.map(String) : [];
    if (!approved.length) {
      res.status(400).json({ error: 'no_destinations', detail: 'approve at least one destination, or reject' });
      return;
    }
    const { rows } = await ctx.pool.query(
      "SELECT * FROM print_intake WHERE intake_id = $1 AND owner_sub = $2 AND state = 'awaiting_approval'",
      [req.params.id, sub],
    );
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'not_found_or_decided' }); return; }

    // The swarm level is never writable by a non-admin, whatever the form posted.
    const catalog = destinationsForCaller(destinationCatalog(), callerIsAdmin(req));
    const writes = planFanout(approved, catalog);
    if (!writes.length) {
      res.status(400).json({ error: 'unknown_destinations' });
      return;
    }
    const title = safeField(body.title) || String(row.title);
    const results = await executeFanout(rag, writes, {
      title,
      text: String(row.text_body || ''),
      contentSha256: String(row.content_sha256),
      sidecar: (row.sidecar || {}) as PrintSidecar,
    });
    const state = stateForResults(results);
    const failure = results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error}`).join('; ') || null;
    const { rows: updated } = await ctx.pool.query(
      `UPDATE print_intake
          SET state = $2, title = $3, approved_destinations = $4::jsonb, fanout = $5::jsonb,
              failure_reason = $6, decided_at = now(), decided_by = $7
        WHERE intake_id = $1 RETURNING *`,
      [row.intake_id, state, title, JSON.stringify(approved), JSON.stringify(results), failure, sub],
    );
    res.json({ intake: presentIntake(updated[0]), results });
  });

  /** Reject: nothing is written, and the decision is kept. */
  router.post('/documents/:id/reject', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const reason = safeField((req.body as Record<string, unknown>)?.reason) || 'rejected by approver';
    const { rows } = await ctx.pool.query(
      `UPDATE print_intake SET state = 'rejected', failure_reason = $3, decided_at = now(), decided_by = $2
        WHERE intake_id = $1 AND owner_sub = $2 AND state = 'awaiting_approval' RETURNING *`,
      [req.params.id, sub, reason],
    );
    if (!rows.length) { res.status(404).json({ error: 'not_found_or_decided' }); return; }
    res.json({ intake: presentIntake(rows[0]) });
  });

  /** The inbox surface. */
  router.get('/app', (_req: Request, res: Response) => {
    const dir = ctx.appPackageDir;
    if (!dir) { res.status(503).send('package context unavailable'); return; }
    const file = path.join(fs.realpathSync(dir), 'ui', 'index.html');
    if (!fs.existsSync(file)) { res.status(404).send('surface not installed'); return; }
    res.type('html').send(fs.readFileSync(file, 'utf8'));
  });

  return router;
}

export type { Recommendation };
