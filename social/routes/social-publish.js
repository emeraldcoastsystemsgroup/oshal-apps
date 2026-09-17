"use strict";
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
exports.publishToLinkedIn = publishToLinkedIn;
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const runtime_1 = require("@/app/connectors/runtime");
const logger = (0, logger_1.createChildLogger)({ module: 'social-publish' });
/** The declared write action this rail runs — a member share on the caller's own feed. */
const LINKEDIN_ACTION = 'create-post';
/**
 * @description Load a kernel connector spec by provider slug. A missing or malformed spec is a
 * refusal, never a fall-through to a bespoke call: the audited rail is the only publish path.
 * @param provider - Connector slug (the spec file's basename).
 * @returns The loaded spec, or null when it cannot be read.
 */
function loadSpecSafe(provider) {
    try {
        const dir = process.env.OSHAL_CONNECTOR_SPEC_DIR || '/app/swarm-apps/connectors';
        return (0, runtime_1.loadConnectorSpec)(path.join(dir, `${provider}.yaml`));
    }
    catch (err) {
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
function specHasAction(spec, actionName) {
    const actions = spec?.actions;
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
function mapActionResult(status, body) {
    const code = typeof body.code === 'string' ? body.code : '';
    const error = typeof body.error === 'string' ? body.error : '';
    if (status === 200 && body.ok === true) {
        const data = (body.data ?? {});
        const out = { ok: true, target: 'linkedin', postId: data.id == null ? null : String(data.id) };
        if (body.auditRecorded === false)
            out.auditRecorded = false;
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
async function publishToLinkedIn(ctx, sub, text, requestBody) {
    const spec = loadSpecSafe('linkedin');
    if (!spec || !specHasAction(spec, LINKEDIN_ACTION)) {
        return { ok: false, code: 503, error: 'channel_unavailable', message: 'The LinkedIn connector definition is unavailable — publishing is disabled until it loads.' };
    }
    const connection = await (0, connector_tenancy_1.resolveConnectionRow)(ctx.pool, sub, 'linkedin');
    if (!connection) {
        return { ok: false, code: 409, error: 'no_linkedin_connection', message: 'Connect LinkedIn at /utilities first.' };
    }
    if (!connection.account_id) {
        return { ok: false, code: 409, error: 'reconnect', message: 'Missing LinkedIn author id — reconnect at /utilities.' };
    }
    const result = await (0, runtime_1.runConnectorAction)({
        pool: ctx.pool,
        spec,
        resolveCreds: () => (0, runtime_1.resolveConnectorActionCreds)(spec, ctx.pool, sub, connectors_routes_1.getValidAccessToken),
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
    return mapActionResult(result.status, result.body);
}
//# sourceMappingURL=social-publish.js.map