/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Kernel authorization resource registration, personal-scope isolation, and named-permission RBAC for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: the kernel's identity is the only one. The bearer fallback and its public default signing secret are gone, and so is the package's own role table; the kernel admits each route against the catalog before it reaches here, and a request without a verified kernel caller is answered 401.
 */

'use strict';

const ownOnly = Object.freeze({
  authorize: async ({ actor, operation, grant }) =>
    Boolean(actor?.isActive && actor?.issuer && actor?.sub && grant?.scope === 'own' && !operation?.tenantId)
});

const registered = new WeakSet();

/**
 * @description Register this package's two resources with the kernel's authorization port, once per port.
 * @param {object} authorization The runner's authorization port.
 * @returns {void}
 */
function registerPhoneControlAuthorization(authorization) {
  if (!authorization || typeof authorization.registerResource !== 'function' || registered.has(authorization)) return;
  registered.add(authorization);
  authorization.registerResource('execution', ownOnly);
  authorization.registerResource('configuration', ownOnly);
}

/**
 * @description A person-scoped package refuses any caller-chosen owner, tenant or workspace.
 * @param {object} req The request.
 * @returns {string|null} The refusal code, or null when the request names nobody else.
 */
function foreignScope(req) {
  const keys = [...Object.keys(req?.query || {}), ...Object.keys(req?.body && typeof req.body === 'object' ? req.body : {})];
  if (req?.query?.scope && req.query.scope !== 'person') return 'phone_control_personal_scope_only';
  if (keys.some((key) => /^(tenant|tenantId|owner|ownerSub|issuer|subject|workspace)$/i.test(key))) return 'phone_control_personal_scope_only';
  if (req?.headers?.['x-oshal-tenant-id'] || req?.headers?.['x-tenant-id']) return 'phone_control_personal_scope_only';
  return null;
}

/**
 * @description The verified owner of this request, from the kernel's caller alone.
 * @param {object} ctx The package context.
 * @returns {{issuer:string,sub:string}|null} The owner, or null when the kernel named nobody.
 */
function kernelOwner(ctx) {
  const actor = ctx?.authorization?.currentActor?.();
  return actor && actor.isActive && actor.issuer && actor.sub ? { issuer: String(actor.issuer), sub: String(actor.sub) } : null;
}

/**
 * @description Middleware: refuse another person's scope, then bind the kernel's owner to req.owner.
 * @param {object} ctx The package context.
 * @returns {Function} Express-style middleware.
 */
function requireOwner(ctx) {
  return (req, res, next) => {
    const foreign = foreignScope(req);
    if (foreign) return res.status(400).json({ error: foreign, message: 'This application works on your own devices only.' });
    const owner = kernelOwner(ctx);
    if (!owner) return res.status(401).json({ error: 'no_identity', message: 'Sign in through oshal to use Phone & Device Control.' });
    req.owner = owner;
    return next();
  };
}

module.exports = { registerPhoneControlAuthorization, requireOwner, kernelOwner, foreignScope, ownOnly };
