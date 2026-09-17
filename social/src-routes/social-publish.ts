/**
 * Social — the LinkedIn publish rail.
 *
 * The one place this package turns an approved draft into a public post, and it does NOT own the
 * write: it hands the exact approved text to the kernel's declared `create-post` connector action
 * (swarm-apps/connectors/linkedin.yaml) through `runConnectorAction`. That rail is what makes a
 * post published on someone's behalf reviewable:
 *   - params are validated against the declared schema before any credential or HTTP work,
 *   - the approval gate is the shared risky-write one (no explicit confirmation => 428, and the
 *     provider is never contacted),
 *   - credentials are the CALLER's brokered LinkedIn token only — never an operator key,
 *   - a `connector_action_audit` 'attempt' row must COMMIT BEFORE the provider call; if the audit
 *     trail is unavailable the publication is REFUSED (503), never made silently.
 *
 * Nothing here reasons: no LLM is in the publish path, by design (ADR-036 — the bot drafts, the
 * controller publishes deterministically).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Route the package's LinkedIn publisher through the declared create-post connector action and the kernel's caller-scoped fail-closed audit path, replacing the bespoke fetch() to /v2/ugcPosts that left no audit row at all.
 *
 * @module social-publish
 */

import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { resolveConnectionRow } from '@/app/routes/connector-tenancy';
import {
  loadConnectorSpec, resolveConnectorActionCreds, runConnectorAction,
  type ConnectorActionAuditPool, type ConnectorSpec,
} from '@/app/connectors/runtime';

const logger = createChildLogger({ module: 'social-publish' });

/** The declared write action this rail runs — a member share on the caller's own feed. */
const LINKEDIN_ACTION = 'create-post';

/** @description The publish outcome the /post route sends verbatim (code is the HTTP status). */
export interface SocialPublishResult {
  ok: boolean;
  code?: number;
  error?: string;
  message?: string;
  target?: string;
  postId?: string | null;
  /** Present and false only when the terminal audit row could not be written after a real write. */
  auditRecorded?: boolean;
}

/**
 * @description Load a kernel connector spec by provider slug. A missing or malformed spec is a
 * refusal, never a fall-through to a bespoke call: the audited rail is the only publish path.
 * @param provider - Connector slug (the spec file's basename).
 * @returns The loaded spec, or null when it cannot be read.
 */
function loadSpecSafe(provider: string): ConnectorSpec | null {
  try {
    const dir = process.env.OSHAL_CONNECTOR_SPEC_DIR || '/app/swarm-apps/connectors';
    return loadConnectorSpec(path.join(dir, `${provider}.yaml`));
  } catch (err) {
    logger.error({ err, stack: err instanceof Error ? err.stack : undefined, provider }, 'connector spec load failed — publishing is disabled');
    return null;
  }
}

/**
 * @description Does a loaded spec declare the named write action? A spec that lost the action is
 * as unusable as a missing one, and must fail the same way.
 * @param spec - The loaded connector spec, or null.
 * @param actionName - Action name to look for.
 * @returns True when the spec declares that action.
 */
function specHasAction(spec: ConnectorSpec | null, actionName: string): boolean {
  const actions = (spec as { actions?: Array<{ name?: string }> } | null)?.actions;
  return Array.isArray(actions) && actions.some((a) => a?.name === actionName);
}

/**
 * @description Translate the connector-action executor's HTTP result into this package's publish
 * shape, keeping each refusal distinguishable: not-connected stays a clean 409 the composer shows
 * as "connect LinkedIn", an unconfirmed write stays a 428, and a refusal caused by the audit trail
 * being down stays a 503 that says so rather than looking like a provider error.
 * @param status - HTTP status the executor produced.
 * @param body - JSON body the executor produced.
 * @returns The publish result for the route.
 */
function mapActionResult(status: number, body: Record<string, unknown>): SocialPublishResult {
  const code = typeof body.code === 'string' ? body.code : '';
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 200 && body.ok === true) {
    const data = (body.data ?? {}) as { id?: unknown };
    const out: SocialPublishResult = { ok: true, target: 'linkedin', postId: data.id == null ? null : String(data.id) };
    if (body.auditRecorded === false) out.auditRecorded = false;
    return out;
  }
  if (code === 'not_connected') {
    return { ok: false, code: 409, error: 'no_linkedin_connection', message: 'Connect LinkedIn at /utilities first.' };
  }
  if (status === 428) {
    return { ok: false, code: 428, error: 'confirmation_required', message: 'Publishing to LinkedIn needs an explicit confirmation.' };
  }
  if (code === 'audit_unavailable') {
    return { ok: false, code: 503, error: 'audit_unavailable', message: 'The publish audit trail is unavailable — nothing was posted.' };
  }
  return { ok: false, code: status >= 400 ? status : 502, error: error || code || 'linkedin_rejected' };
}

/**
 * @description Publish the exact approved text to the caller's own LinkedIn feed through the
 * declared `create-post` connector action. The caller's request body is passed through unchanged so
 * the executor's approval gate — not a local re-derivation of it — decides whether the write may
 * happen, and every attempt (refused or made) leaves a caller-scoped `connector_action_audit` row.
 * @param ctx - App context (pool for the broker read and the audit trail).
 * @param sub - The authenticated caller's OIDC subject; the isolation key for token and audit.
 * @param text - The approved post text, sent verbatim (no LLM in this path).
 * @param requestBody - The caller's raw request body, carrying the explicit-write confirmation.
 * @returns The publish result for the route to send.
 */
export async function publishToLinkedIn(
  ctx: AppContext,
  sub: string,
  text: string,
  requestBody: unknown,
): Promise<SocialPublishResult> {
  const spec = loadSpecSafe('linkedin');
  if (!spec || !specHasAction(spec, LINKEDIN_ACTION)) {
    return { ok: false, code: 503, error: 'channel_unavailable', message: 'The LinkedIn connector definition is unavailable — publishing is disabled until it loads.' };
  }
  const connection = await resolveConnectionRow(ctx.pool, sub, 'linkedin');
  if (!connection) {
    return { ok: false, code: 409, error: 'no_linkedin_connection', message: 'Connect LinkedIn at /utilities first.' };
  }
  if (!connection.account_id) {
    return { ok: false, code: 409, error: 'reconnect', message: 'Missing LinkedIn author id — reconnect at /utilities.' };
  }
  const result = await runConnectorAction({
    pool: ctx.pool as unknown as ConnectorActionAuditPool,
    spec,
    resolveCreds: () => resolveConnectorActionCreds(spec, ctx.pool, sub, getValidAccessToken),
    userSub: sub,
    actionName: LINKEDIN_ACTION,
    params: {
      author: `urn:li:person:${connection.account_id}`,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    },
    requestBody,
  });
  return mapActionResult(result.status, result.body as Record<string, unknown>);
}
