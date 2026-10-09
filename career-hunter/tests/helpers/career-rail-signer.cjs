/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Test-side signer for the Career rail grant contract (1.25.1), written independently of the package verifier (lib/career-engine-runs.js verifyRailRequest) and of the engine's enrich._rail_headers, so a canonicalization mistake in one cannot hide in the other. Specs use it to act as the engine child holding the grant the runner minted. CommonJS so the framework-coupled node:test suite and the ESM harness can both load it.
 */
'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');

/** Media type of a rail completion; the controller's global JSON parser never consumes it. */
const RAIL_CONTENT_TYPE = 'application/vnd.oshal.career-rail+json';
/** The one request the rail serves. */
const RAIL_TARGET = '/api/career-hunter/engine/complete';

/**
 * @description Split a `<run id>.<secret>` grant token as registerEngineRun returns it.
 * @param {string} token - The grant token.
 * @returns {{id: string, secret: string, token: string}} The grant id, secret and token.
 */
function grantOf(token) {
  const dot = token.indexOf('.');
  return { id: token.slice(0, dot), secret: token.slice(dot + 1), token };
}

/**
 * @description Encode an owner subject the way the engine's _rail_headers does (base64url, no padding).
 * @param {string} subject - Exact subject.
 * @returns {string} Canonical base64url header value.
 */
function encodeOwner(subject) {
  return Buffer.from(subject, 'utf8').toString('base64url');
}

/**
 * @description Headers for one request under a grant: key = SHA-256("oshal-career-rail-grant-v1:"
 * + secret), signature = HMAC-SHA256(key, METHOD|target|ts|nonce|hex SHA-256(body)).
 * @param {{grant: {id: string, secret: string}, owner: string, method?: string, target?: string,
 *   body?: Buffer, timestamp?: number, nonce?: string}} input - Grant, owner, request facts.
 * @returns {Record<string, string>} The five contract headers.
 */
function signedHeaders(input) {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomBytes(18).toString('base64url');
  const key = createHash('sha256').update(`oshal-career-rail-grant-v1:${input.grant.secret}`).digest();
  const bodyHash = createHash('sha256').update(input.body ?? Buffer.alloc(0)).digest('hex');
  const canonical = `${(input.method ?? 'POST').toUpperCase()}|${input.target ?? RAIL_TARGET}|${timestamp}|${nonce}|${bodyHash}`;
  return {
    'x-career-rail-grant': input.grant.id,
    'x-career-rail-owner': encodeOwner(input.owner),
    'x-career-rail-timestamp': String(timestamp),
    'x-career-rail-nonce': nonce,
    'x-career-rail-signature': createHmac('sha256', key).update(canonical, 'utf8').digest('hex'),
  };
}

/**
 * @description Prepare a signed completion the way the engine child sends one; the same prepared
 * request can be sent twice, byte for byte, to prove replay refusal.
 * @param {string} base - Server origin.
 * @param {string} token - The grant token the runner minted.
 * @param {string} owner - The run owner's plain subject.
 * @param {object} payload - The completion document.
 * @param {{timestamp?: number, nonce?: string, target?: string, method?: string}} [overrides] - Refusal-case knobs.
 * @returns {{url: string, init: RequestInit, body: Buffer}} A request that can be sent more than once.
 */
function signedCompletion(base, token, owner, payload, overrides = {}) {
  const target = overrides.target ?? RAIL_TARGET;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = signedHeaders({ grant: grantOf(token), owner, method: overrides.method ?? 'POST', target, body,
    timestamp: overrides.timestamp, nonce: overrides.nonce });
  return { url: base + target, body,
    init: { method: overrides.method ?? 'POST', headers: { ...headers, 'content-type': RAIL_CONTENT_TYPE }, body } };
}

/**
 * @description Send a prepared request and parse its answer.
 * @param {{url: string, init: RequestInit}} request - The prepared request.
 * @returns {Promise<{status: number, body: any}>} Status and parsed body.
 */
async function send(request) {
  const response = await fetch(request.url, request.init);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

module.exports = { RAIL_CONTENT_TYPE, RAIL_TARGET, encodeOwner, grantOf, send, signedCompletion, signedHeaders };
