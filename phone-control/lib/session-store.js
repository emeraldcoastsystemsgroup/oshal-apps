/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: owner-scoped storage for session preferences (pointer mode, quality, lock-on-end, active monitor), session chat messages, whiteboard strokes, saved screenshots and recordings on disk under OSHAL_PACKAGE_DATA_DIR, and file transfer records/staging.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { refusal } = require('./db.js');

const TARGET_KEY = /^(phone|computer|rdp):[A-Za-z0-9._:-]{3,96}$/;
const INPUT_MODES = Object.freeze(['touch', 'mouse']);
const QUALITIES = Object.freeze(['high', 'balanced', 'low']);
const SENDERS = Object.freeze(['operator', 'remote']);
const COLORS = Object.freeze(['red', 'gold', 'green', 'blue']);
const HEX_COLOR_MAP = Object.freeze({ '#ef4444': 'red', '#f59e0b': 'gold', '#22c55e': 'green', '#3b82f6': 'blue' });
const CAPTURE_KINDS = Object.freeze(['screenshot', 'recording']);
const CAPTURE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'video/webm', 'video/mp4']);
const TRANSFER_DIRS = Object.freeze(['upload', 'download', 'staged']);
const TRANSFER_STATES = Object.freeze(['completed', 'staged', 'refused']);
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,118}$/;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_TRANSFER_BYTES = 4 * 1024 * 1024;

function storageRoot() {
  return process.env.OSHAL_PACKAGE_DATA_DIR || path.join(os.tmpdir(), 'oshal-phone-control');
}

function ownerBucket(owner) {
  return crypto.createHash('sha256').update(`${owner.issuer}\u0000${owner.sub}`).digest('hex').slice(0, 32);
}

function checkTarget(value) {
  const key = String(value || '').trim();
  if (!TARGET_KEY.test(key)) throw refusal(400, 'target_invalid', 'Name the session target as phone:<id>, computer:<id> or rdp:<id>.');
  return key;
}

function cleanLine(value, max, field) {
  if (typeof value !== 'string' || !value.trim()) throw refusal(400, `${field}_required`, `${field} is required.`);
  return value.trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
}

function sanitizeFileName(raw, fallbackExt = '') {
  const base = path.basename(String(raw || '').trim()).replace(/[^\w. -]/g, '_').replace(/^\.+/, '');
  const candidate = (base || `file${fallbackExt}`).slice(0, 118);
  if (!SAFE_FILE.test(candidate) || candidate.includes('..')) {
    throw refusal(400, 'file_name_invalid', 'Choose a plain file name with letters, numbers, spaces, dashes or dots.');
  }
  return candidate;
}

function decodeBase64Bytes(raw, maxBytes, label) {
  if (typeof raw !== 'string' || !raw.trim()) throw refusal(400, `${label}_required`, `Send ${label} as base64.`);
  const cleaned = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw refusal(400, `${label}_invalid`, `${label} is not valid base64.`);
  const bytes = Buffer.from(cleaned, 'base64');
  if (!bytes.length) throw refusal(400, `${label}_empty`, `${label} cannot be empty.`);
  if (bytes.length > maxBytes) {
    throw refusal(413, `${label}_too_large`, `${label} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }
  return bytes;
}

function mapPreference(row) {
  return {
    targetKey: row.target_key,
    inputMode: row.input_mode,
    quality: row.quality,
    lockOnEnd: Boolean(row.lock_on_end),
    privacyScreen: Boolean(row.privacy_screen),
    monitorIndex: Number(row.monitor_index) || 0,
    monitorId: row.monitor_id || 'primary',
    updatedAt: row.updated_at
  };
}

function listPreferences(db, owner, target) {
  if (target) {
    const key = checkTarget(target);
    const row = db.prepare('SELECT * FROM phone_control_preferences WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ?')
      .get(owner.issuer, owner.sub, key);
    return row ? [mapPreference(row)] : [{
      targetKey: key, inputMode: 'touch', quality: 'balanced', lockOnEnd: false,
      privacyScreen: false, monitorIndex: 0, monitorId: 'primary', updatedAt: null
    }];
  }
  return db.prepare('SELECT * FROM phone_control_preferences WHERE owner_issuer = ? AND owner_sub = ? ORDER BY updated_at DESC')
    .all(owner.issuer, owner.sub).map(mapPreference);
}

function savePreference(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  const current = listPreferences(db, owner, key)[0];
  const inputMode = input.inputMode === undefined ? current.inputMode : String(input.inputMode);
  if (!INPUT_MODES.includes(inputMode)) throw refusal(400, 'input_mode_invalid', 'inputMode must be touch or mouse.');
  const quality = input.quality === undefined ? current.quality : String(input.quality);
  if (!QUALITIES.includes(quality)) throw refusal(400, 'quality_invalid', 'quality must be high, balanced or low.');
  if (input.lockOnEnd !== undefined && typeof input.lockOnEnd !== 'boolean') {
    throw refusal(400, 'lock_invalid', 'lockOnEnd must be true or false.');
  }
  if (input.privacyScreen !== undefined && typeof input.privacyScreen !== 'boolean') {
    throw refusal(400, 'privacy_invalid', 'privacyScreen must be true or false.');
  }
  const lockOnEnd = input.lockOnEnd === undefined ? current.lockOnEnd : input.lockOnEnd;
  const privacyScreen = input.privacyScreen === undefined ? current.privacyScreen : input.privacyScreen;
  const monitorIndex = input.monitorIndex === undefined ? current.monitorIndex : Number(input.monitorIndex);
  if (!Number.isInteger(monitorIndex) || monitorIndex < 0 || monitorIndex > 15) {
    throw refusal(400, 'monitor_invalid', 'monitorIndex must be an integer between 0 and 15.');
  }
  const monitorId = input.monitorId === undefined ? current.monitorId : cleanLine(String(input.monitorId), 64, 'monitorId');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO phone_control_preferences (owner_issuer, owner_sub, target_key, input_mode, quality, lock_on_end,
    privacy_screen, monitor_index, monitor_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner_issuer, owner_sub, target_key) DO UPDATE SET input_mode = excluded.input_mode,
    quality = excluded.quality, lock_on_end = excluded.lock_on_end, privacy_screen = excluded.privacy_screen,
    monitor_index = excluded.monitor_index, monitor_id = excluded.monitor_id, updated_at = excluded.updated_at`)
    .run(owner.issuer, owner.sub, key, inputMode, quality, lockOnEnd ? 1 : 0, privacyScreen ? 1 : 0, monitorIndex, monitorId, now);
  return listPreferences(db, owner, key)[0];
}

function listChat(db, owner, target) {
  const key = checkTarget(target);
  return db.prepare(`SELECT * FROM phone_control_chat WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ?
    ORDER BY created_at ASC LIMIT 200`).all(owner.issuer, owner.sub, key).map((row) => ({
    id: row.message_id, targetKey: row.target_key, sender: row.sender, body: row.body,
    deliveredRemote: Boolean(row.delivered_remote), deliveryNote: row.delivery_note || '', createdAt: row.created_at
  }));
}

function addChat(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  const sender = input.sender === undefined ? 'operator' : String(input.sender);
  if (!SENDERS.includes(sender)) throw refusal(400, 'sender_invalid', 'sender must be operator or remote.');
  const body = cleanLine(input.body, 1000, 'body');
  const delivered = Boolean(input.deliveredRemote);
  const note = input.deliveryNote ? String(input.deliveryNote).trim().slice(0, 240) : '';
  const createdAt = new Date().toISOString();
  const id = `msg_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO phone_control_chat (message_id, owner_issuer, owner_sub, target_key, sender, body,
    delivered_remote, delivery_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.issuer, owner.sub, key, sender, body, delivered ? 1 : 0, note, createdAt);
  return { id, targetKey: key, sender, body, deliveredRemote: delivered, deliveryNote: note, createdAt };
}

function clearChat(db, owner, target) {
  const key = checkTarget(target);
  return Number(db.prepare('DELETE FROM phone_control_chat WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ?')
    .run(owner.issuer, owner.sub, key).changes || 0);
}

function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 600) {
    throw refusal(400, 'points_invalid', 'Whiteboard stroke needs between 2 and 600 points.');
  }
  return points.map((pt) => {
    const x = Number(pt?.x);
    const y = Number(pt?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw refusal(400, 'points_invalid', 'Whiteboard coordinates must be normalized between 0 and 1.');
    }
    return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
  });
}

function listWhiteboard(db, owner, target) {
  const key = checkTarget(target);
  return db.prepare(`SELECT * FROM phone_control_whiteboard WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ?
    ORDER BY created_at ASC LIMIT 250`).all(owner.issuer, owner.sub, key).map((row) => ({
    id: row.stroke_id, targetKey: row.target_key, color: row.color,
    points: JSON.parse(row.points_json), createdAt: row.created_at
  }));
}

function normalizeInkColor(raw) {
  const cleaned = String(raw || 'red').trim().toLowerCase();
  return HEX_COLOR_MAP[cleaned] || cleaned;
}

function addWhiteboard(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  const color = normalizeInkColor(input.color);
  if (!COLORS.includes(color)) throw refusal(400, 'color_invalid', 'Whiteboard colour must be red, gold, green or blue.');
  const points = validatePoints(input.points);
  const createdAt = new Date().toISOString();
  const id = `wb_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO phone_control_whiteboard (stroke_id, owner_issuer, owner_sub, target_key, color, points_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, owner.issuer, owner.sub, key, color, JSON.stringify(points), createdAt);
  return { id, targetKey: key, color, points, createdAt };
}

function replaceWhiteboard(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  if (!Array.isArray(input.strokes)) throw refusal(400, 'strokes_invalid', 'strokes must be an array.');
  const validated = input.strokes.slice(-200).map((stroke) => {
    const color = normalizeInkColor(stroke?.color);
    if (!COLORS.includes(color)) throw refusal(400, 'color_invalid', 'Whiteboard colour must be red, gold, green or blue.');
    return { color, points: validatePoints(stroke?.points) };
  });
  clearWhiteboard(db, owner, key);
  for (const stroke of validated) {
    addWhiteboard(db, owner, { targetKey: key, color: stroke.color, points: stroke.points });
  }
  return listWhiteboard(db, owner, key);
}

function clearWhiteboard(db, owner, target) {
  const key = checkTarget(target);
  return Number(db.prepare('DELETE FROM phone_control_whiteboard WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ?')
    .run(owner.issuer, owner.sub, key).changes || 0);
}

function captureFilePath(owner, id) {
  const folder = path.join(storageRoot(), 'captures', ownerBucket(owner));
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  return path.join(folder, `${id}.bin`);
}

function mapCapture(row) {
  return {
    id: row.capture_id, targetKey: row.target_key, targetName: row.target_name, kind: row.kind,
    mime: row.mime, fileName: row.file_name, bytes: row.bytes, byteSize: row.bytes, sha256: row.sha256,
    width: row.width, height: row.height, durationMs: row.duration_ms, createdAt: row.created_at
  };
}

function listCaptures(db, owner, filter = {}) {
  const rows = filter.target
    ? db.prepare('SELECT * FROM phone_control_captures WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ? ORDER BY created_at DESC LIMIT 100')
      .all(owner.issuer, owner.sub, checkTarget(filter.target))
    : db.prepare('SELECT * FROM phone_control_captures WHERE owner_issuer = ? AND owner_sub = ? ORDER BY created_at DESC LIMIT 100')
      .all(owner.issuer, owner.sub);
  return rows.filter((row) => !filter.kind || row.kind === filter.kind).map(mapCapture);
}

function saveCapture(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  const kind = String(input.kind || '');
  if (!CAPTURE_KINDS.includes(kind)) throw refusal(400, 'kind_invalid', 'Capture kind must be screenshot or recording.');
  const mime = String(input.mime || input.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!CAPTURE_MIMES.includes(mime)) throw refusal(400, 'mime_invalid', 'Unsupported capture media format.');
  const bytes = decodeBase64Bytes(input.dataBase64, MAX_CAPTURE_BYTES, 'capture');
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'video/webm' ? '.webm' : mime === 'video/mp4' ? '.mp4' : '.png';
  const fileName = sanitizeFileName(input.fileName || `${kind}-${Date.now()}${ext}`, ext);
  const targetName = cleanLine(input.targetName || key, 120, 'targetName');
  const id = `cap_${crypto.randomUUID()}`;
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const createdAt = new Date().toISOString();
  const width = Math.max(0, Math.min(16384, Math.round(Number(input.width) || 0)));
  const height = Math.max(0, Math.min(16384, Math.round(Number(input.height) || 0)));
  const durationMs = Math.max(0, Math.min(3600000, Math.round(Number(input.durationMs) || 0)));
  fs.writeFileSync(captureFilePath(owner, id), bytes, { mode: 0o600 });
  db.prepare(`INSERT INTO phone_control_captures (capture_id, owner_issuer, owner_sub, target_key, target_name, kind,
    mime, file_name, bytes, sha256, width, height, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.issuer, owner.sub, key, targetName, kind, mime, fileName, bytes.length, sha256, width, height, durationMs, createdAt);
  return mapCapture(db.prepare('SELECT * FROM phone_control_captures WHERE capture_id = ?').get(id));
}

function readCaptureBytes(db, owner, id) {
  const row = db.prepare('SELECT * FROM phone_control_captures WHERE capture_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .get(String(id), owner.issuer, owner.sub);
  if (!row) return null;
  const file = captureFilePath(owner, row.capture_id);
  if (!fs.existsSync(file)) return null;
  return { capture: mapCapture(row), bytes: fs.readFileSync(file) };
}

function deleteCapture(db, owner, id) {
  const row = db.prepare('SELECT capture_id FROM phone_control_captures WHERE capture_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .get(String(id), owner.issuer, owner.sub);
  if (!row) return false;
  fs.rmSync(captureFilePath(owner, row.capture_id), { force: true });
  db.prepare('DELETE FROM phone_control_captures WHERE capture_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .run(row.capture_id, owner.issuer, owner.sub);
  return true;
}

function transferFilePath(owner, id) {
  const folder = path.join(storageRoot(), 'transfers', ownerBucket(owner));
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  return path.join(folder, `${id}.bin`);
}

function mapTransfer(row, owner) {
  const hasFile = fs.existsSync(path.join(storageRoot(), 'transfers', ownerBucket(owner), `${row.transfer_id}.bin`));
  return {
    id: row.transfer_id, targetKey: row.target_key, direction: row.direction, fileName: row.file_name,
    remotePath: row.remote_path || '', bytes: row.bytes, byteSize: row.bytes, sha256: row.sha256 || null,
    status: row.status, note: row.note || '', downloadable: hasFile, createdAt: row.created_at
  };
}

function listTransfers(db, owner, target) {
  const rows = target
    ? db.prepare('SELECT * FROM phone_control_transfers WHERE owner_issuer = ? AND owner_sub = ? AND target_key = ? ORDER BY created_at DESC LIMIT 100')
      .all(owner.issuer, owner.sub, checkTarget(target))
    : db.prepare('SELECT * FROM phone_control_transfers WHERE owner_issuer = ? AND owner_sub = ? ORDER BY created_at DESC LIMIT 100')
      .all(owner.issuer, owner.sub);
  return rows.map((row) => mapTransfer(row, owner));
}

function saveTransfer(db, owner, input = {}) {
  const key = checkTarget(input.targetKey);
  const direction = String(input.direction || 'staged');
  if (!TRANSFER_DIRS.includes(direction)) throw refusal(400, 'direction_invalid', 'direction must be upload, download or staged.');
  const rawStatus = String(input.status || (direction === 'staged' ? 'staged' : 'completed'));
  const status = (rawStatus === 'delivered' || rawStatus === 'downloaded') ? 'completed' : rawStatus;
  if (!TRANSFER_STATES.includes(status)) throw refusal(400, 'status_invalid', 'status must be completed, staged or refused.');
  const fileName = sanitizeFileName(input.fileName);
  const remotePath = input.remotePath ? String(input.remotePath).trim().slice(0, 260) : '';
  const note = input.note ? String(input.note).trim().slice(0, 300) : '';
  const id = `tr_${crypto.randomUUID()}`;
  let bytesLen = Math.max(0, Math.round(Number(input.bytes) || 0));
  let sha256 = input.sha256 && /^[0-9a-f]{64}$/.test(String(input.sha256)) ? String(input.sha256) : null;
  if (input.dataBase64 !== undefined && input.dataBase64 !== null && input.dataBase64 !== '') {
    const bytes = decodeBase64Bytes(input.dataBase64, MAX_TRANSFER_BYTES, 'file');
    bytesLen = bytes.length;
    sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(transferFilePath(owner, id), bytes, { mode: 0o600 });
  }
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO phone_control_transfers (transfer_id, owner_issuer, owner_sub, target_key, direction, file_name,
    remote_path, bytes, sha256, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.issuer, owner.sub, key, direction, fileName, remotePath, bytesLen, sha256, status, note, createdAt);
  const row = db.prepare('SELECT * FROM phone_control_transfers WHERE transfer_id = ?').get(id);
  return mapTransfer(row, owner);
}

function readTransferBytes(db, owner, id) {
  const row = db.prepare('SELECT * FROM phone_control_transfers WHERE transfer_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .get(String(id), owner.issuer, owner.sub);
  if (!row) return null;
  const file = transferFilePath(owner, row.transfer_id);
  if (!fs.existsSync(file)) return null;
  return { transfer: mapTransfer(row, owner), bytes: fs.readFileSync(file) };
}

function deleteTransfer(db, owner, id) {
  const row = db.prepare('SELECT transfer_id FROM phone_control_transfers WHERE transfer_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .get(String(id), owner.issuer, owner.sub);
  if (!row) return false;
  fs.rmSync(transferFilePath(owner, row.transfer_id), { force: true });
  db.prepare('DELETE FROM phone_control_transfers WHERE transfer_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .run(row.transfer_id, owner.issuer, owner.sub);
  return true;
}

module.exports = {
  sanitizeFileName, listPreferences, savePreference, listChat, addChat, clearChat,
  listWhiteboard, addWhiteboard, replaceWhiteboard, clearWhiteboard,
  listCaptures, saveCapture, readCaptureBytes, deleteCapture,
  listTransfers, saveTransfer, readTransferBytes, deleteTransfer
};
