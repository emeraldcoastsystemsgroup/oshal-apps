/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.2 P1 compliance and
 *     template routes (/compliance, /templates, /templates/render, /content/:id/approve):
 *     exact-owner FORCE-RLS compliance settings store (sender identity, physical postal address,
 *     unsubscribe base URL, SMS quiet hours), read-only template catalog & preview renderer,
 *     and compliance-enforced content approval and email send helper. Mirrors migration
 *     004-marketing-compliance.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-compliance
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import {
  DEFAULT_COMPLIANCE_SETTINGS, MARKETING_TEMPLATES, MARKETING_TEMPLATE_IDS,
  complianceReadiness, lintMarketingEmail, normalizeComplianceSettings,
  parseEmailDraftCopy, renderMarketingTemplate,
  type ComplianceLintError, type ComplianceLintResult, type ComplianceSettings,
  type MarketingTemplateId,
} from './marketing-templates';
import { UUID_RE, authed, logger, rows, safeRows, type QueryablePool } from './marketing-support';

/** Lazy-DDL mirror of migrations/004-marketing-compliance.sql. */
const COMPLIANCE_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS oshal_marketing_compliance_settings (
    owner_sub TEXT PRIMARY KEY,
    sender_name TEXT NOT NULL DEFAULT '',
    sender_email TEXT NOT NULL DEFAULT '',
    reply_to_email TEXT NOT NULL DEFAULT '',
    postal_address TEXT NOT NULL DEFAULT '',
    unsubscribe_base_url TEXT NOT NULL DEFAULT '',
    sms_quiet_start_hour INT NOT NULL DEFAULT 21 CHECK (sms_quiet_start_hour BETWEEN 0 AND 23),
    sms_quiet_end_hour INT NOT NULL DEFAULT 8 CHECK (sms_quiet_end_hour BETWEEN 0 AND 23),
    sms_default_timezone TEXT NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS template_id TEXT',
  'ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS html_body TEXT',
  'ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS text_body TEXT',
];

/**
 * @description Ensure the 004-marketing-compliance table, FORCE-RLS policy, and content template columns.
 * @param pool - Framework pool.
 * @returns Resolves when schema bootstrap finishes.
 */
export async function ensureComplianceSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-compliance',
    statements: [
      ...COMPLIANCE_TABLE_DDL,
      ...buildOwnerRlsPolicyStatements('oshal_marketing_compliance_settings', 'owner_sub'),
    ],
    requirements: [
      {
        table: 'oshal_marketing_compliance_settings',
        columns: ['owner_sub', 'sender_name', 'sender_email', 'postal_address', 'unsubscribe_base_url', 'sms_quiet_start_hour', 'sms_quiet_end_hour'],
      },
      { table: 'oshal_marketing_content', columns: ['template_id', 'html_body', 'text_body'] },
    ],
  });
}

/** Map a database row from oshal_marketing_compliance_settings to ComplianceSettings. */
function rowToSettings(row: Record<string, unknown> | undefined): { settings: ComplianceSettings; updatedAt: string | null } {
  if (!row) return { settings: { ...DEFAULT_COMPLIANCE_SETTINGS }, updatedAt: null };
  const norm = normalizeComplianceSettings(row);
  return {
    settings: norm.ok ? norm.settings : { ...DEFAULT_COMPLIANCE_SETTINGS },
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

/**
 * @description Load the caller's compliance settings row (returns safe defaults when absent).
 * @param pool - Postgres pool.
 * @param sub - Caller OIDC subject.
 * @returns Normalized compliance settings and last updated timestamp.
 */
export async function loadComplianceSettings(
  pool: QueryablePool,
  sub: string,
): Promise<{ settings: ComplianceSettings; updatedAt: string | null }> {
  const found = await safeRows(
    pool,
    'SELECT * FROM oshal_marketing_compliance_settings WHERE owner_sub = $1',
    [sub],
  );
  return rowToSettings(found[0]);
}

/** Load live audience compliance counts for the caller, degrading cleanly to zero if tables are absent. */
async function loadComplianceCounts(
  pool: QueryablePool,
  sub: string,
): Promise<{ contactCount: number; confirmedConsentCount: number; suppressionCount: number }> {
  const [contacts, confirmed, suppressions] = await Promise.all([
    safeRows(pool, 'SELECT COUNT(*)::int AS n FROM oshal_marketing_contacts WHERE owner_sub = $1', [sub]),
    safeRows(pool, "SELECT COUNT(DISTINCT contact_id)::int AS n FROM oshal_marketing_consents WHERE owner_sub = $1 AND status = 'confirmed'", [sub]),
    safeRows(pool, 'SELECT COUNT(*)::int AS n FROM oshal_marketing_suppressions WHERE owner_sub = $1', [sub]),
  ]);
  return {
    contactCount: Number(contacts[0]?.n ?? 0),
    confirmedConsentCount: Number(confirmed[0]?.n ?? 0),
    suppressionCount: Number(suppressions[0]?.n ?? 0),
  };
}

/**
 * @description GET /compliance — caller's compliance settings, readiness flags, and live audience counts (read-only).
 */
export async function getCompliance(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const [{ settings, updatedAt }, counts] = await Promise.all([
    loadComplianceSettings(ctx.pool, sub),
    loadComplianceCounts(ctx.pool, sub),
  ]);
  res.json({
    settings,
    updatedAt,
    readiness: complianceReadiness(settings),
    counts,
  });
}

/**
 * @description PUT /compliance — validate and upsert the caller's compliance settings row.
 */
export async function putCompliance(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const checked = normalizeComplianceSettings(req.body ?? {});
  if (!checked.ok) {
    res.status(400).json({ error: checked.error, message: checked.message });
    return;
  }
  const s = checked.settings;
  const saved = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_compliance_settings
       (owner_sub, sender_name, sender_email, reply_to_email, postal_address, unsubscribe_base_url,
        sms_quiet_start_hour, sms_quiet_end_hour, sms_default_timezone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (owner_sub) DO UPDATE SET
       sender_name = EXCLUDED.sender_name,
       sender_email = EXCLUDED.sender_email,
       reply_to_email = EXCLUDED.reply_to_email,
       postal_address = EXCLUDED.postal_address,
       unsubscribe_base_url = EXCLUDED.unsubscribe_base_url,
       sms_quiet_start_hour = EXCLUDED.sms_quiet_start_hour,
       sms_quiet_end_hour = EXCLUDED.sms_quiet_end_hour,
       sms_default_timezone = EXCLUDED.sms_default_timezone,
       updated_at = now()
     RETURNING *`,
    [
      sub, s.senderName, s.senderEmail, s.replyToEmail, s.postalAddress,
      s.unsubscribeBaseUrl, s.smsQuietStartHour, s.smsQuietEndHour, s.smsDefaultTimezone,
    ],
  ))[0];
  const mapped = rowToSettings(saved);
  res.json({
    settings: mapped.settings,
    updatedAt: mapped.updatedAt,
    readiness: complianceReadiness(mapped.settings),
  });
}

/**
 * @description GET /templates — list the built-in HTML email templates (read-only).
 */
export async function listTemplates(_ctx: AppContext, _sub: string, _req: Request, res: Response): Promise<void> {
  res.json({ templates: MARKETING_TEMPLATES });
}

/**
 * @description POST /templates/render — render a template against the caller's saved compliance settings (no DB write).
 */
export async function renderTemplate(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const { settings } = await loadComplianceSettings(ctx.pool, sub);
  try {
    const rendered = renderMarketingTemplate((req.body ?? {}) as Record<string, unknown>, settings);
    res.json(rendered);
  } catch (err) {
    const e = err as Error & { code?: string };
    res.status(400).json({ error: e.code || 'invalid_template_input', message: e.message });
  }
}

/** Classify lint errors into approve-route and publish-route refusal codes. */
function classifyComplianceFailure(errors: ComplianceLintError[]): {
  approveError: 'compliance_incomplete' | 'template_compliance_failed';
  publishError: 'compliance_postal_address_required' | 'compliance_identity_required' | 'template_compliance_failed';
  hint: string;
} {
  const hasPostal = errors.some((e) => e.code === 'compliance_postal_address_required');
  const hasIdentity = errors.some((e) => e.code === 'compliance_identity_required');
  const publishError = hasPostal
    ? 'compliance_postal_address_required'
    : hasIdentity ? 'compliance_identity_required' : 'template_compliance_failed';
  const approveError = hasPostal || hasIdentity ? 'compliance_incomplete' : 'template_compliance_failed';
  return { approveError, publishError, hint: errors.map((e) => e.message).join(' ') };
}

/** Resolved email parts + compliance verdict used by both content approval and email publishing. */
export interface ResolvedEmailCompliance {
  ok: boolean;
  approveError?: 'compliance_incomplete' | 'template_compliance_failed';
  publishError?: 'compliance_postal_address_required' | 'compliance_identity_required' | 'template_compliance_failed';
  hint?: string;
  reasons: ComplianceLintError[];
  templateId: MarketingTemplateId | null;
  subject: string;
  html: string;
  text: string;
  settings: ComplianceSettings;
  compliance: ComplianceLintResult;
  rerendered: boolean;
}

/**
 * @description Resolve and lint an email content item against the caller's current compliance settings.
 * Re-renders through the item's built-in template when present and stored parts are missing or stale.
 * Raw un-templated email items lacking HTML, plain-text, postal footer, or unsubscribe link fail closed.
 */
export async function resolveEmailComplianceForItem(
  pool: QueryablePool,
  sub: string,
  item: Record<string, unknown>,
  overrides: { templateId?: unknown; unsubscribeUrl?: unknown } = {},
): Promise<ResolvedEmailCompliance> {
  const { settings } = await loadComplianceSettings(pool, sub);
  const candidateTpl = String(overrides.templateId ?? item.template_id ?? '').trim();
  const validTpl = (MARKETING_TEMPLATE_IDS as readonly string[]).includes(candidateTpl)
    ? (candidateTpl as MarketingTemplateId)
    : null;
  let html = typeof item.html_body === 'string' ? item.html_body : '';
  let text = typeof item.text_body === 'string' ? item.text_body : '';
  let subject = String(item.title || '').trim() || 'Open Swarm update';
  let lint = lintMarketingEmail({ html, text, compliance: settings, unsubscribeUrl: overrides.unsubscribeUrl });
  let rerendered = false;
  if (!lint.ok && validTpl) {
    const parsed = parseEmailDraftCopy(String(item.body || ''), subject);
    const rendered = renderMarketingTemplate({
      templateId: validTpl,
      subject: parsed.subject,
      headline: parsed.headline,
      intro: parsed.intro,
      body: parsed.body,
      unsubscribeUrl: overrides.unsubscribeUrl,
    }, settings);
    html = rendered.html;
    text = rendered.text;
    subject = rendered.subject;
    lint = rendered.compliance;
    rerendered = true;
  }
  if (!lint.ok) {
    const classified = classifyComplianceFailure(lint.errors);
    return {
      ok: false, ...classified, reasons: lint.errors, templateId: validTpl,
      subject, html, text, settings, compliance: lint, rerendered,
    };
  }
  return {
    ok: true, reasons: [], templateId: validTpl, subject, html, text,
    settings, compliance: lint, rerendered,
  };
}

/**
 * @description POST /content/:id/approve — owner-scoped draft approval (`draft -> approved`).
 * Email items must satisfy sender identity, physical postal address, HTML + plain-text parts,
 * and unsubscribe link checks or are refused 422 while remaining in `draft`.
 */
export async function approveContent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const itemId = String(req.params.id || '');
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: 'content_not_found' }); return; }
  const item = (await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_content WHERE item_id = $1 AND user_sub = $2', [itemId, sub],
  ))[0];
  if (!item) { res.status(404).json({ error: 'content_not_found' }); return; }
  if (item.status === 'published') { res.status(409).json({ error: 'already_published', ref: item.published_ref ?? null }); return; }
  if (item.status === 'rejected') { res.status(409).json({ error: 'content_rejected' }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (String(item.channel) === 'email') {
    const resolved = await resolveEmailComplianceForItem(ctx.pool, sub, item, {
      templateId: body.templateId,
      unsubscribeUrl: body.unsubscribeUrl,
    });
    if (!resolved.ok) {
      res.status(422).json({
        error: resolved.approveError || 'template_compliance_failed',
        hint: resolved.hint,
        reasons: resolved.reasons,
      });
      return;
    }
    const updated = (await rows(
      ctx.pool,
      `UPDATE oshal_marketing_content
          SET status = 'approved',
              template_id = COALESCE($1, template_id),
              html_body = $2,
              text_body = $3,
              updated_at = now()
        WHERE item_id = $4 AND user_sub = $5
        RETURNING *`,
      [resolved.templateId, resolved.html, resolved.text, itemId, sub],
    ))[0];
    res.json({ item: updated, compliance: resolved.compliance });
    return;
  }

  const updated = (await rows(
    ctx.pool,
    "UPDATE oshal_marketing_content SET status = 'approved', updated_at = now() WHERE item_id = $1 AND user_sub = $2 RETURNING *",
    [itemId, sub],
  ))[0];
  res.json({ item: updated });
}

/**
 * @description Register P1 compliance settings, email templates, and content approval routes under /api/marketing.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
export function registerComplianceRoutes(router: Router, ctx: AppContext): void {
  ensureComplianceSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine compliance schema'));
  router.get('/compliance', authed(ctx, getCompliance));
  router.put('/compliance', authed(ctx, putCompliance));
  router.get('/templates', authed(ctx, listTemplates));
  router.post('/templates/render', authed(ctx, renderTemplate));
  router.post('/content/:id/approve', authed(ctx, approveContent));
}
