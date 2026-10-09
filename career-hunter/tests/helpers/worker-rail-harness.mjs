/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the COMPILED Career worker rail over a real loopback HTTP listener for the rail, isolation and model-rail specs. Real: the compiled rail module, the engine run registry (lib/career-engine-runs.js) and loopback HTTP. Doubled: the Express Router (a recorder, served by a plain node:http server), the kernel trusted-subject decoder and the `auth: service` mount guard (hand-written mirrors of src/shared/middleware/authz.ts and manifest-route-mounter.ts, not the kernel modules), the logger, BotNodeClient.hasEndpoint and createRegistryEndpointResolver, ctx.swarm.runtimeRegistryService.getAgentRegistration (the heartbeat preflight), and executeBotOrInline (a recorder of every call). Their real companions are listed in the package BACKLOG (1.24.0 real-boundary audit row).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mirror the kernel's signed-package-callbacks rail instead of the service mount guard (1.25.1): POST only, the package verifier first (the real compiled createCareerRailCallbackVerifier over the real registry), a refusal answered 401 callback_signature_invalid as the kernel answers it, a principal the fixture directory does not hold answered 403 callback_owner_unavailable, an owner without the bound permission answered 403, and the handler run as the admitted owner under the request-identity double. The Express `raw` body reader and the kernel's request-identity module are the two further doubles. The real kernel boundary is crossed by tests/career-rail-kernel-boundary.core.test.js.
 */
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import { requestIdentity } from './request-identity-stub.mjs';

const require = createRequire(import.meta.url);
const signer = require('./career-rail-signer.cjs');

const RAIL_URL_PATH = signer.RAIL_TARGET;

/** @description The issuer the fixture directory records for every run owner. */
export const FIXTURE_ISSUER = 'https://issuer.oshal.example.com';

/**
 * @description Encode a subject the way the engine's _rail_headers does.
 * @param {string} subject - Exact subject.
 * @returns {string} Canonical base64url header value.
 */
export function encodeSubject(subject) {
  return signer.encodeOwner(subject);
}

/** A router double that records the handlers the compiled module registers. */
function recordingRouter() {
  const routes = [];
  return {
    routes,
    post: (path, handler) => routes.push({ method: 'POST', path, handler }),
    get: (path, handler) => routes.push({ method: 'GET', path, handler }),
  };
}

/**
 * A mirror of express.raw for one vendor type: consumes the stream into req.body when the content
 * type matches, leaves the request untouched otherwise, and refuses a body past the limit with a
 * 413 error, as the framework's reader does.
 */
function rawReader({ type, limit }) {
  return (req, _res, next) => {
    const actual = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (actual !== type) { next(); return; }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { next(Object.assign(new Error('request entity too large'), { status: 413 })); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { done = true; next(Object.assign(new Error('request entity too large'), { status: 413 })); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; req.body = Buffer.concat(chunks); next(); } });
    req.on('error', (err) => { if (!done) { done = true; next(err); } });
  };
}

/**
 * @description Load the compiled rail with kernel stand-ins and return a controllable harness.
 * @returns {object} Harness: state, the real run registry, the compiled rail, and a server factory.
 */
export function loadRailHarness() {
  const state = {
    calls: [],
    hasEndpoint: true,
    registration: () => ({ status: 'online', heartbeatAt: new Date().toISOString() }),
    behavior: async (request) => ({ success: true, response: `answer for ${request.userSub}`, model: 'fixture-model', provider: 'fixture' }),
  };
  const originalLoad = Module._load;
  Module._load = function loadRailStubs(request, ...rest) {
    if (request === 'express') return { Router: recordingRouter, raw: rawReader };
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    }
    if (request === '@/shared/services/database/request-identity') return requestIdentity;
    if (request === '@/features/agent-management') {
      return {
        BotNodeClient: class { constructor(_resolver, timeoutMs) { this.timeoutMs = timeoutMs; } hasEndpoint() { return state.hasEndpoint; } },
        createRegistryEndpointResolver: () => () => null,
      };
    }
    if (request === '@/app/routes/inline-bot-execution') {
      return {
        executeBotOrInline: async (ctx, client, agentId, botRequest) => {
          state.calls.push({ agentId, request: botRequest, clientTimeoutMs: client.timeoutMs });
          return state.behavior(botRequest, agentId);
        },
      };
    }
    return originalLoad.call(this, request, ...rest);
  };
  let rail;
  try { rail = require('../../routes/career-worker-rail.js'); }
  finally { Module._load = originalLoad; }
  const runs = require('../../lib/career-engine-runs.js');
  const ctx = { swarm: { runtimeRegistryService: { getAgentRegistration: async (id) => state.registration(id) } } };
  return { state, runs, rail, ctx, identity: requestIdentity, startServer: (options = {}) => startRailServer(rail, ctx, options) };
}

/** Give a native ServerResponse the two Express methods the rail uses. */
function expressResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res; };
  return res;
}

/**
 * The kernel's signed-callback rail, mirrored: POST only, the package verifier first, the owner
 * refreshed through a directory and checked for the bound permission, then the handler as that
 * owner. Refusals are answered exactly as the kernel answers them.
 */
async function callbackRail(verifier, options, route, req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'callback_post_required' }); return; }
  const principal = await verifier(req);
  if (!principal || typeof principal.sub !== 'string' || typeof principal.issuer !== 'string') {
    res.status(401).json({ error: 'callback_signature_invalid' });
    return;
  }
  const directory = options.directory ?? (() => ({ isActive: true }));
  const actor = directory(principal);
  if (!actor || actor.isActive !== true) { res.status(403).json({ error: 'callback_owner_unavailable' }); return; }
  const permitted = options.permitted ?? (() => true);
  if (!permitted(principal)) { res.status(403).json({ error: 'authorization_permission_denied' }); return; }
  requestIdentity.runWithRequestIdentity(
    { sub: principal.sub, principalIssuer: principal.issuer, isOperator: false },
    () => route.handler(req, res),
  );
}

/**
 * @description Serve the compiled router at its manifest mount on 127.0.0.1:0, behind the mirrored
 * callback rail.
 * @param {object} rail - Compiled rail module.
 * @param {object} ctx - Kernel context stand-in.
 * @param {{mountGuard?: boolean, directory?: Function, permitted?: Function, identity?: object|null}} options
 * mountGuard=false exercises the route's own refusal alone (no verifier, and `identity` — default
 * none — as the request identity).
 * @returns {Promise<{port: number, url: string, close: () => Promise<void>}>} The listening server.
 */
export function startRailServer(rail, ctx, options = {}) {
  const router = rail.createCareerWorkerRailRoutes(ctx);
  const verifier = rail.createCareerRailCallbackVerifier(ctx);
  const route = router.routes.find((entry) => entry.method === 'POST' && entry.path === '/complete');
  const server = http.createServer((req, res) => {
    expressResponse(res);
    if (req.url !== RAIL_URL_PATH) { res.status(404).json({ error: 'not found' }); return; }
    if (options.mountGuard === false) {
      const identity = options.identity ?? null;
      if (identity) requestIdentity.runWithRequestIdentity(identity, () => route.handler(req, res));
      else route.handler(req, res);
      return;
    }
    callbackRail(verifier, options, route, req, res).catch((err) => {
      if (!res.headersSent) res.status(503).json({ error: 'callback_unavailable', detail: String(err?.message || err) });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}${RAIL_URL_PATH}`,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

/**
 * @description POST one completion to the rail over real HTTP, signed with a grant when one is
 * given (as the engine child does) or bare otherwise.
 * @param {string} url - Rail URL.
 * @param {{grant?: string, owner?: string, headers?: Record<string, string>, contentType?: string,
 *   body?: unknown, raw?: string, timestamp?: number, nonce?: string, method?: string}} input
 * `grant` is the runner-minted token, `owner` the subject signed as; `headers` are added verbatim
 * (a caller impersonating the 1.24.0 contract, a cookie); `raw` replaces the JSON body bytes.
 * @returns {Promise<{status: number, body: any}>} Status and parsed body.
 */
export async function postCompletion(url, input = {}) {
  const payload = input.raw ?? JSON.stringify(input.body ?? { system: 'SYS', prompt: 'PROMPT', jsonMode: true });
  const bytes = Buffer.from(payload, 'utf8');
  const headers = { 'content-type': input.contentType ?? signer.RAIL_CONTENT_TYPE };
  if (input.grant) {
    Object.assign(headers, signer.signedHeaders({ grant: signer.grantOf(input.grant), owner: input.owner ?? '', method: input.method ?? 'POST',
      target: new URL(url).pathname, body: bytes, timestamp: input.timestamp, nonce: input.nonce }));
  }
  Object.assign(headers, input.headers ?? {}); // caller overrides last, so a spec can tamper with one signed header
  const response = await fetch(url, { method: input.method ?? 'POST', headers, body: input.method === 'GET' ? undefined : bytes });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
