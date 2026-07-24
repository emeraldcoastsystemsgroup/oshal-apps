/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Shared HTTP, identity, body-reading, transaction, and DTO helpers for the Game Show route factory and services.
 */

'use strict';

const path = require('path');
const fs = require('fs');

/** @description Resolve the authenticated OIDC subject used for all data scoping. */
function resolveSub(req) {
  const user = (req.oidc && req.oidc.user) || {};
  return user.sub || user.oid || null;
}

/** @description Resolve a non-sensitive display name from OIDC claims. */
function resolveName(req) {
  const user = (req.oidc && req.oidc.user) || {};
  return String(user.name || user.nickname || user.email || 'Player').slice(0, 60);
}

/** @description Write one JSON response with the package's stable content type. */
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/** @description Serve only a file resolved beneath the package root. */
function serveFile(res, root, rel, contentType, noStore) {
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) { sendJson(res, 400, { error: 'bad path' }); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'not found', rel }); return; }
    res.statusCode = 200;
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', noStore ? 'no-store' : 'public, max-age=86400');
    res.end(buf);
  });
}

/** @description Read a JSON request body while tolerating an upstream parser. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_err) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** @description Read a bounded raw upload (a camera still) that bypasses JSON middleware. */
async function readBytes(req, maxBytes) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'INPUT_TOO_LARGE' });
    return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooLarge = false;
    req.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) tooLarge = true;
      else if (!tooLarge) chunks.push(bytes);
    });
    req.on('end', () => tooLarge ? reject(Object.assign(new Error('too large'), { code: 'INPUT_TOO_LARGE' })) : resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(Object.assign(new Error('upload interrupted'), { code: 'INVALID_INPUT' })));
  });
}

/** @description Parse a JSONB value returned as either an object or a test-double string. */
function parsedJson(value, fallback) {
  if (typeof value !== 'string') return value == null ? fallback : value;
  try { return JSON.parse(value); } catch (_err) { return fallback; }
}

/** @description Run production work atomically while retaining lightweight legacy test pools. */
async function withTransaction(pool, work) {
  const transactional = !!(pool && typeof pool.connect === 'function');
  const client = transactional ? await pool.connect() : pool;
  try {
    if (transactional) await client.query('BEGIN');
    const value = await work(client, transactional);
    if (transactional) await client.query('COMMIT');
    return value;
  } catch (error) {
    if (transactional) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (transactional) client.release();
  }
}

/** @description Project a room row for a member without exposing the owner's subject. */
function roomDto(row, sub) {
  if (!row) return null;
  return {
    roomId: row.room_id, showId: row.show_id, name: row.name || null,
    joinCode: row.join_code || null, status: row.status,
    isOwner: row.user_sub === sub, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** @description Project one seat with a caller-relative `me` flag; never leaks user_sub. */
function seatDto(row, sub) {
  return {
    seatId: row.seat_id, name: row.display_name || 'Player', team: row.team || null,
    podiumIndex: row.podium_index == null ? null : Number(row.podium_index),
    role: row.role || 'player', presenceKind: row.presence_kind || 'avatar',
    avatarId: row.avatar_id || null, presenceRev: Number(row.presence_rev) || 0,
    score: Number(row.score) || 0, me: row.user_sub === sub,
  };
}

module.exports = {
  resolveSub, resolveName, sendJson, serveFile, readBody, readBytes,
  parsedJson, withTransaction, roomDto, seatDto,
};
