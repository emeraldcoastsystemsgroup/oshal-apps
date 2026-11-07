/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | RBAC authorization and personal-scope isolation guards for Audio Studio.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Remove all hardcoded fallback secrets and synthetic default identities; enforce fail-closed kernel actor or explicit test-secret authentication.
 */
'use strict';

const crypto = require('node:crypto');

const ROLE_PERMISSIONS = {
  viewer: ['studio.view', 'editor.view'],
  reader: ['studio.view', 'studio.read', 'editor.view', 'editor.read'],
  producer: ['studio.view', 'studio.read', 'studio.generate', 'editor.view', 'editor.read', 'editor.create', 'editor.change', 'editor.export'],
  creator: ['editor.view', 'editor.read', 'editor.create', 'editor.delete'],
  editor: ['studio.view', 'studio.read', 'editor.view', 'editor.read', 'editor.create', 'editor.change', 'editor.delete', 'editor.export'],
  exporter: ['editor.view', 'editor.read', 'editor.export'],
  admin: ['studio.view', 'studio.read', 'studio.generate', 'editor.view', 'editor.read', 'editor.create', 'editor.change', 'editor.delete', 'editor.export'],
};

const FORBIDDEN_SCOPE_PARAMS = ['tenantId', 'tenant_id', 'ownerSub', 'owner_sub', 'userSub', 'user_sub', 'workspaceId', 'workspace_id'];
const FORBIDDEN_SCOPE_HEADERS = ['x-oshal-tenant-id', 'x-tenant-id', 'x-oshal-user-sub', 'x-user-sub', 'x-workspace-id'];

function requireExplicitTestSecret() {
  const secret = process.env.OSHAL_AUDIO_TEST_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    const err = new Error('OSHAL_AUDIO_TEST_SECRET (>= 16 chars) is required for standalone bearer token signing');
    err.status = 401;
    err.code = 'missing_test_secret';
    throw err;
  }
  return secret.trim();
}

function assertPersonalScopeOnly(req) {
  const query = req.query || {};
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const key of FORBIDDEN_SCOPE_PARAMS) {
    if (query[key] !== undefined || body[key] !== undefined) {
      const err = new Error(`Personal-scope application rejects caller-supplied ${key} selector`);
      err.status = 400;
      err.code = 'audio_personal_scope_only';
      throw err;
    }
  }
  const headers = req.headers || {};
  for (const h of FORBIDDEN_SCOPE_HEADERS) {
    if (headers[h] !== undefined) {
      const err = new Error(`Personal-scope application rejects caller-supplied ${h} header`);
      err.status = 400;
      err.code = 'audio_personal_scope_only';
      throw err;
    }
  }
}

class SecurityMiddleware {
  static generateToken(payload = {}) {
    const secret = requireExplicitTestSecret();
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Token payload requires an explicit sub claim');
    }
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const claims = {
      issuer: payload.issuer || 'https://oshal.local',
      sub: payload.sub,
      role: payload.role || 'viewer',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (payload.expiresInSec || 3600),
    };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  static verifyToken(token) {
    const secret = requireExplicitTestSecret();
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('Invalid token signature');
    }
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!decoded.sub || (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000))) {
      throw new Error('Token expired or missing subject');
    }
    return decoded;
  }

  static hasPermission(role, permission) {
    const perms = ROLE_PERMISSIONS[role] || [];
    return perms.includes(permission);
  }
}

function resolveActor(ctx, req) {
  const kernelActor = ctx?.authorization?.currentActor?.();
  if (kernelActor && kernelActor.isActive !== false && kernelActor.sub) {
    return {
      issuer: kernelActor.issuer || 'https://oshal.local',
      sub: String(kernelActor.sub),
      email: kernelActor.email || null,
      source: 'kernel',
    };
  }
  if (req.principal && req.principal.subject && req.principal.state !== 'disabled') {
    return {
      issuer: req.principal.issuer || 'https://oshal.local',
      sub: String(req.principal.subject),
      email: null,
      source: 'kernel',
    };
  }
  const authHeader = String(req.headers?.authorization || '');
  if (authHeader.startsWith('Bearer ') && process.env.OSHAL_AUDIO_TEST_SECRET) {
    const decoded = SecurityMiddleware.verifyToken(authHeader.slice(7).trim());
    return {
      issuer: decoded.issuer || 'https://oshal.local',
      sub: String(decoded.sub),
      role: decoded.role || 'viewer',
      source: 'test-token',
    };
  }
  return null;
}

async function authorizeRequest(ctx, req, res, permission) {
  try {
    assertPersonalScopeOnly(req);
  } catch (err) {
    res.status(400).json({ error: err.code || 'audio_personal_scope_only', message: err.message });
    return null;
  }

  let actor;
  try {
    actor = resolveActor(ctx, req);
  } catch (err) {
    res.status(401).json({ error: 'unauthorized', message: err.message });
    return null;
  }
  if (!actor) {
    res.status(401).json({ error: 'unauthorized', message: 'Authenticated caller identity is required' });
    return null;
  }

  if (typeof ctx?.authorization?.authorize === 'function') {
    try {
      const decision = await ctx.authorization.authorize({ permission });
      if (!decision || decision.allowed === false) {
        res.status(403).json({ error: 'application_resource_denied', message: `Permission ${permission} denied` });
        return null;
      }
    } catch (err) {
      res.status(err.status || 403).json({ error: err.code || 'application_resource_denied', message: err.message });
      return null;
    }
  } else if (actor.source === 'test-token') {
    if (!SecurityMiddleware.hasPermission(actor.role, permission)) {
      res.status(403).json({ error: 'forbidden', message: `Role '${actor.role}' lacks permission '${permission}'` });
      return null;
    }
  } else if (permission !== 'studio.view' && permission !== 'editor.view') {
    res.status(403).json({ error: 'application_resource_denied', message: 'Authorization catalog decision required' });
    return null;
  }

  req.actor = actor;
  return actor;
}

module.exports = {
  SecurityMiddleware,
  ROLE_PERMISSIONS,
  assertPersonalScopeOnly,
  resolveActor,
  authorizeRequest,
};
