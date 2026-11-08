/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | SQLite DatabaseSync persistence under OSHAL_PACKAGE_DATA_DIR for Audio Studio.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Add strict two-arm owner_issuer + owner_sub repository methods and PostgreSQL Forced-RLS transaction helper.
 * 3   | maintainer@emeraldcoastsystemsgroup.com | Complete dual PostgreSQL/SQLite project, stem, revision, mixdown, and orphan-blob repository operations.
 * 4   | maintainer@emeraldcoastsystemsgroup.com | Use lasting-storage SQLite repository under native host-process (storageModel kernel-scoped-documents) while preserving real PostgreSQL pool Forced-RLS when backed by PostgreSQL.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

let defaultInstance = null;
let defaultInstancePath = null;

function resolveDbPath(customPath) {
  if (customPath) return customPath;
  const dataDir = process.env.OSHAL_PACKAGE_DATA_DIR
    || process.env.OSHAL_AUDIO_VAULT
    || path.join(os.tmpdir(), 'oshal-audio-studio');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return path.join(dataDir, 'audio_studio.sqlite');
}

function applyNativeSchema(db) {
  const nativeMig = path.join(__dirname, '..', 'migrations', 'native', '001-audio.sql');
  db.exec(fs.readFileSync(nativeMig, 'utf8'));
}

function getDatabase(customPath) {
  const targetPath = resolveDbPath(customPath);
  if (defaultInstance && defaultInstancePath === targetPath) return defaultInstance;
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  applyNativeSchema(db);
  if (!customPath) {
    defaultInstance = db;
    defaultInstancePath = targetPath;
  }
  return db;
}

function assertOwner(actor) {
  if (!actor || typeof actor.issuer !== 'string' || !actor.issuer || typeof actor.sub !== 'string' || !actor.sub) {
    const err = new Error('Verified owner_issuer and owner_sub are required for database access');
    err.status = 401;
    throw err;
  }
  return { issuer: actor.issuer, sub: actor.sub };
}

function parseJsonSafe(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeStemRow(row) {
  const cfg = parseJsonSafe(row.channel_config_json, {});
  const peaks = parseJsonSafe(row.peaks_json, null) || cfg.peaks || null;
  const gainDb = Number(cfg.gainDb ?? 0);
  const volume = cfg.volume !== undefined ? Number(cfg.volume) : Number(Math.pow(10, gainDb / 20).toFixed(4));
  const role = row.role || cfg.role || 'custom';
  return {
    id: row.stem_id,
    stemId: row.stem_id,
    projectId: row.project_id,
    name: cfg.name || row.filename || role,
    trackName: cfg.trackName || role,
    role,
    blobHash: row.blob_sha256,
    blob_hash: row.blob_sha256,
    durationSeconds: Number(row.duration_sec ?? cfg.durationSeconds ?? 0),
    sampleRate: Number(row.sample_rate ?? cfg.sampleRate ?? 48000),
    channels: Number(cfg.channels ?? 2),
    volume,
    gainDb,
    pan: Number(cfg.pan ?? 0),
    muted: Boolean(cfg.muted),
    solo: Boolean(cfg.solo),
    hpf: Boolean(cfg.hpf ?? cfg.hpf85Hz),
    ducking: Boolean(cfg.ducking),
    duckTriggerTrackId: cfg.duckTriggerTrackId || null,
    duckDepthDb: Number(cfg.duckDepthDb ?? -14),
    eqLowDb: Number(cfg.eqLowDb ?? 0),
    eqMidDb: Number(cfg.eqMidDb ?? 0),
    eqHighDb: Number(cfg.eqHighDb ?? 0),
    compThresholdDb: Number(cfg.compThresholdDb ?? -18),
    compRatio: Number(cfg.compRatio ?? 2.5),
    gateThresholdDb: cfg.gateThresholdDb !== undefined ? Number(cfg.gateThresholdDb) : null,
    reverbMix: Number(cfg.reverbMix ?? 0.08),
    distortionMode: cfg.distortionMode || 'bypass',
    driveDb: Number(cfg.driveDb ?? 0),
    offsetSec: Number(cfg.offsetSec ?? 0),
    trimStartSec: Number(cfg.trimStartSec ?? 0),
    trimEndSec: cfg.trimEndSec !== undefined && cfg.trimEndSec !== null ? Number(cfg.trimEndSec) : null,
    fadeInSec: Number(cfg.fadeInSec ?? 0),
    fadeOutSec: Number(cfg.fadeOutSec ?? 0),
    peaks: peaks && Object.keys(peaks).length > 0 ? peaks : null,
    channelConfig: cfg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeProjectRow(row, stemRows = null) {
  const master = parseJsonSafe(row.master_config_json, {});
  const out = {
    id: row.project_id,
    projectId: row.project_id,
    title: row.name,
    name: row.name,
    sampleRate: Number(row.sample_rate || 48000),
    sample_rate: Number(row.sample_rate || 48000),
    tempo: Number(master.tempo || 120),
    revision: Number(row.revision || 1),
    master: {
      tempo: Number(master.tempo || 120),
      masterGainDb: Number(master.masterGainDb ?? 0),
      targetLufs: Number(master.targetLufs ?? -14.0),
      ceilingDb: Number(master.ceilingDb ?? -1.0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (Array.isArray(stemRows)) out.stems = stemRows.map(normalizeStemRow);
  return out;
}

function normalizeMixdownRow(row) {
  return {
    id: row.mixdown_id,
    mixdownId: row.mixdown_id,
    projectId: row.project_id,
    blobHash: row.blob_sha256,
    blob_sha256: row.blob_sha256,
    filename: row.filename,
    format: row.format || 'wav',
    durationSeconds: Number(row.duration_sec ?? 0),
    sampleRate: Number(row.sample_rate ?? 48000),
    targetLufs: Number(row.target_lufs ?? -14.0),
    lufsIntegrated: Number(row.measured_lufs ?? -14.0),
    truePeakDb: Number(row.true_peak ?? -1.0),
    compliance: row.compliance || 'ITU-R BS.1770 PASS',
    createdAt: row.created_at,
  };
}

async function withPgOwner(pool, actor, work) {
  const { issuer, sub } = assertOwner(actor);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('audio.owner_issuer', $1, true), set_config('audio.owner_sub', $2, true)", [issuer, sub]);
    const result = await work(client, issuer, sub);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

function buildStemConfig(input = {}, existing = {}) {
  const merged = Object.assign({}, existing, input);
  const gainDb = merged.gainDb !== undefined
    ? Number(merged.gainDb)
    : (merged.volume !== undefined ? Number((20 * Math.log10(Math.max(0.001, Number(merged.volume)))).toFixed(2)) : 0);
  const volume = merged.volume !== undefined ? Number(merged.volume) : Number(Math.pow(10, gainDb / 20).toFixed(4));
  return {
    name: String(merged.name || merged.trackName || 'Stem'),
    role: String(merged.role || merged.trackName || 'vocals'),
    durationSeconds: Number(merged.durationSeconds ?? 0),
    sampleRate: Number(merged.sampleRate ?? 48000),
    channels: Number(merged.channels ?? 2),
    gainDb,
    volume,
    pan: Math.max(-1, Math.min(1, Number(merged.pan ?? 0))),
    muted: Boolean(merged.muted),
    solo: Boolean(merged.solo),
    hpf: Boolean(merged.hpf ?? merged.hpf85Hz),
    ducking: Boolean(merged.ducking),
    duckTriggerTrackId: merged.duckTriggerTrackId || null,
    duckDepthDb: Number(merged.duckDepthDb ?? -14),
    eqLowDb: Number(merged.eqLowDb ?? 0),
    eqMidDb: Number(merged.eqMidDb ?? 0),
    eqHighDb: Number(merged.eqHighDb ?? 0),
    compThresholdDb: Number(merged.compThresholdDb ?? -18),
    compRatio: Math.max(1, Number(merged.compRatio ?? 2.5)),
    gateThresholdDb: merged.gateThresholdDb !== undefined && merged.gateThresholdDb !== null ? Number(merged.gateThresholdDb) : null,
    reverbMix: Math.max(0, Math.min(1, Number(merged.reverbMix ?? 0.08))),
    distortionMode: String(merged.distortionMode || 'bypass'),
    driveDb: Math.max(0, Number(merged.driveDb ?? 0)),
    offsetSec: Math.max(0, Number(merged.offsetSec ?? 0)),
    trimStartSec: Math.max(0, Number(merged.trimStartSec ?? 0)),
    trimEndSec: merged.trimEndSec !== undefined && merged.trimEndSec !== null ? Number(merged.trimEndSec) : null,
    fadeInSec: Math.max(0, Number(merged.fadeInSec ?? 0)),
    fadeOutSec: Math.max(0, Number(merged.fadeOutSec ?? 0)),
    peaks: merged.peaks || existing.peaks || null,
  };
}

function createAudioRepository(ctx) {
  const pool = (ctx?.pool && ctx.pool.storageModel !== 'kernel-scoped-documents') ? ctx.pool : null;
  const sqlite = pool ? null : (ctx?.db || getDatabase());

  async function upsertBlob(actor, blobMeta) {
    const { issuer, sub } = assertOwner(actor);
    const sha = blobMeta.sha256 || blobMeta.hash;
    const byteSize = Number(blobMeta.byteSize ?? blobMeta.byte_size ?? 0);
    const mimeType = blobMeta.mimeType || blobMeta.mime_type || 'audio/wav';
    const storagePath = blobMeta.storagePath || blobMeta.storage_path || '';
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          `INSERT INTO audio_blobs (owner_issuer, owner_sub, sha256, byte_size, mime_type, storage_path, ref_count)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (owner_issuer, owner_sub, sha256)
           DO UPDATE SET ref_count = audio_blobs.ref_count + 1
           RETURNING sha256, byte_size, mime_type, ref_count`,
          [issuer, sub, sha, byteSize, mimeType, storagePath]
        );
        return r.rows[0];
      });
    }
    const existing = sqlite.prepare(
      'SELECT sha256, ref_count FROM audio_blobs WHERE owner_issuer = ? AND owner_sub = ? AND sha256 = ?'
    ).get(issuer, sub, sha);
    if (existing) {
      sqlite.prepare('UPDATE audio_blobs SET ref_count = ref_count + 1 WHERE owner_issuer = ? AND owner_sub = ? AND sha256 = ?')
        .run(issuer, sub, sha);
      return { sha256: sha, byte_size: byteSize, mime_type: mimeType, ref_count: Number(existing.ref_count) + 1 };
    }
    sqlite.prepare(
      'INSERT INTO audio_blobs (owner_issuer, owner_sub, sha256, byte_size, mime_type, storage_path, ref_count) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(issuer, sub, sha, byteSize, mimeType, storagePath);
    return { sha256: sha, byte_size: byteSize, mime_type: mimeType, ref_count: 1 };
  }

  async function getOwnedBlobMeta(actor, sha256) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          'SELECT sha256, byte_size, mime_type, storage_path, ref_count FROM audio_blobs WHERE owner_issuer = $1 AND owner_sub = $2 AND sha256 = $3',
          [issuer, sub, sha256]
        );
        return r.rows[0] || null;
      });
    }
    return sqlite.prepare(
      'SELECT sha256, byte_size, mime_type, storage_path, ref_count FROM audio_blobs WHERE owner_issuer = ? AND owner_sub = ? AND sha256 = ?'
    ).get(issuer, sub, sha256) || null;
  }

  async function listProjects(actor) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          'SELECT * FROM audio_projects WHERE owner_issuer = $1 AND owner_sub = $2 ORDER BY updated_at DESC',
          [issuer, sub]
        );
        return r.rows.map((row) => normalizeProjectRow(row));
      });
    }
    const rows = sqlite.prepare(
      'SELECT * FROM audio_projects WHERE owner_issuer = ? AND owner_sub = ? ORDER BY updated_at DESC'
    ).all(issuer, sub);
    return rows.map((row) => normalizeProjectRow(row));
  }

  async function getProject(actor, projectId) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const pr = await client.query(
          'SELECT * FROM audio_projects WHERE project_id = $1 AND owner_issuer = $2 AND owner_sub = $3',
          [projectId, issuer, sub]
        );
        if (!pr.rows[0]) return null;
        const sr = await client.query(
          'SELECT * FROM audio_stems WHERE project_id = $1 AND owner_issuer = $2 AND owner_sub = $3 ORDER BY created_at ASC',
          [projectId, issuer, sub]
        );
        return normalizeProjectRow(pr.rows[0], sr.rows);
      });
    }
    const pr = sqlite.prepare(
      'SELECT * FROM audio_projects WHERE project_id = ? AND owner_issuer = ? AND owner_sub = ?'
    ).get(projectId, issuer, sub);
    if (!pr) return null;
    const sr = sqlite.prepare(
      'SELECT * FROM audio_stems WHERE project_id = ? AND owner_issuer = ? AND owner_sub = ? ORDER BY created_at ASC'
    ).all(projectId, issuer, sub);
    return normalizeProjectRow(pr, sr);
  }

  async function createProject(actor, input = {}) {
    const { issuer, sub } = assertOwner(actor);
    const projectId = input.id || crypto.randomUUID();
    const title = String(input.title || input.name || 'Untitled Audio Session').slice(0, 120);
    const sampleRate = Number(input.sampleRate) === 44100 ? 44100 : 48000;
    const master = {
      tempo: Math.max(20, Math.min(300, Number(input.tempo) || 120)),
      masterGainDb: Number(input.masterGainDb ?? 0),
      targetLufs: Number(input.targetLufs ?? -14.0),
      ceilingDb: Number(input.ceilingDb ?? -1.0),
    };
    const now = new Date().toISOString();
    const docSnap = { id: projectId, title, sampleRate, tempo: master.tempo, revision: 1, master, stems: [] };
    if (pool) {
      await withPgOwner(pool, actor, async (client) => {
        await client.query(
          `INSERT INTO audio_projects (project_id, owner_issuer, owner_sub, user_sub, name, sample_rate, master_config_json, revision, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)`,
          [projectId, issuer, sub, sub, title, sampleRate, JSON.stringify(master), now]
        );
        await client.query(
          `INSERT INTO audio_revisions (project_id, owner_issuer, owner_sub, revision, title, document, created_at)
           VALUES ($1, $2, $3, 1, $4, $5, $6)`,
          [projectId, issuer, sub, title, JSON.stringify(docSnap), now]
        );
      });
    } else {
      sqlite.prepare(
        `INSERT INTO audio_projects (project_id, owner_issuer, owner_sub, user_sub, name, sample_rate, master_config_json, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(projectId, issuer, sub, sub, title, sampleRate, JSON.stringify(master), now, now);
      sqlite.prepare(
        `INSERT INTO audio_revisions (project_id, owner_issuer, owner_sub, revision, title, document, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
      ).run(projectId, issuer, sub, title, JSON.stringify(docSnap), now);
    }
    await appendAudit(actor, projectId, 'create_project', { title, sampleRate, tempo: master.tempo });
    return getProject(actor, projectId);
  }

  async function addStem(actor, projectId, stemInput) {
    const { issuer, sub } = assertOwner(actor);
    const stemId = stemInput.stemId || crypto.randomUUID();
    const filename = String(stemInput.name || stemInput.filename || 'stem.wav').slice(0, 120);
    const role = String(stemInput.trackName || stemInput.role || 'custom').slice(0, 80);
    const cfg = buildStemConfig(Object.assign({}, stemInput, { name: filename, trackName: role, role }));
    const durationSec = Math.max(0.05, Number(cfg.durationSeconds || 4.0));
    const sampleRate = Number(cfg.sampleRate || 48000);
    const sampleCount = Math.round(durationSec * sampleRate);
    const peaksJson = JSON.stringify(cfg.peaks || {});
    const now = new Date().toISOString();
    if (pool) {
      const row = await withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          `INSERT INTO audio_stems (stem_id, project_id, owner_issuer, owner_sub, user_sub, blob_sha256, filename, role, duration_sec, sample_rate, sample_count, peaks_json, channel_config_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING *`,
          [stemId, projectId, issuer, sub, sub, stemInput.blobHash, filename, role, durationSec, sampleRate, sampleCount, peaksJson, JSON.stringify(cfg), now]
        );
        return r.rows[0];
      });
      return normalizeStemRow(row);
    }
    sqlite.prepare(
      `INSERT INTO audio_stems (stem_id, project_id, owner_issuer, owner_sub, user_sub, blob_sha256, filename, role, duration_sec, sample_rate, sample_count, peaks_json, channel_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(stemId, projectId, issuer, sub, sub, stemInput.blobHash, filename, role, durationSec, sampleRate, sampleCount, peaksJson, JSON.stringify(cfg), now, now);
    const row = sqlite.prepare('SELECT * FROM audio_stems WHERE stem_id = ? AND owner_issuer = ? AND owner_sub = ?').get(stemId, issuer, sub);
    return normalizeStemRow(row);
  }

  async function updateStemConfig(actor, projectId, stemId, patch = {}) {
    const { issuer, sub } = assertOwner(actor);
    const now = new Date().toISOString();
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const cur = await client.query(
          'SELECT * FROM audio_stems WHERE stem_id = $1 AND project_id = $2 AND owner_issuer = $3 AND owner_sub = $4',
          [stemId, projectId, issuer, sub]
        );
        if (!cur.rows[0]) return null;
        const nextCfg = buildStemConfig(patch, parseJsonSafe(cur.rows[0].channel_config_json, {}));
        const nextBlob = patch.blobHash || cur.rows[0].blob_sha256;
        const nextRole = patch.trackName || patch.role || cur.rows[0].role;
        const nextFile = patch.name || cur.rows[0].filename;
        const r = await client.query(
          `UPDATE audio_stems SET filename = $1, role = $2, blob_sha256 = $3, channel_config_json = $4, updated_at = $5
           WHERE stem_id = $6 AND project_id = $7 AND owner_issuer = $8 AND owner_sub = $9 RETURNING *`,
          [nextFile, nextRole, nextBlob, JSON.stringify(nextCfg), now, stemId, projectId, issuer, sub]
        );
        return normalizeStemRow(r.rows[0]);
      });
    }
    const cur = sqlite.prepare(
      'SELECT * FROM audio_stems WHERE stem_id = ? AND project_id = ? AND owner_issuer = ? AND owner_sub = ?'
    ).get(stemId, projectId, issuer, sub);
    if (!cur) return null;
    const nextCfg = buildStemConfig(patch, parseJsonSafe(cur.channel_config_json, {}));
    const nextBlob = patch.blobHash || cur.blob_sha256;
    const nextRole = patch.trackName || patch.role || cur.role;
    const nextFile = patch.name || cur.filename;
    sqlite.prepare(
      `UPDATE audio_stems SET filename = ?, role = ?, blob_sha256 = ?, channel_config_json = ?, updated_at = ?
       WHERE stem_id = ? AND project_id = ? AND owner_issuer = ? AND owner_sub = ?`
    ).run(nextFile, nextRole, nextBlob, JSON.stringify(nextCfg), now, stemId, projectId, issuer, sub);
    const updated = sqlite.prepare('SELECT * FROM audio_stems WHERE stem_id = ? AND owner_issuer = ? AND owner_sub = ?').get(stemId, issuer, sub);
    return normalizeStemRow(updated);
  }

  async function removeStem(actor, projectId, stemId) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, (client) =>
        client.query('DELETE FROM audio_stems WHERE stem_id = $1 AND project_id = $2 AND owner_issuer = $3 AND owner_sub = $4', [stemId, projectId, issuer, sub])
      );
    }
    sqlite.prepare('DELETE FROM audio_stems WHERE stem_id = ? AND project_id = ? AND owner_issuer = ? AND owner_sub = ?')
      .run(stemId, projectId, issuer, sub);
  }

  async function commitProjectRevision(actor, projectId, { title, master, nextRevision, action, details }) {
    const { issuer, sub } = assertOwner(actor);
    const now = new Date().toISOString();
    if (pool) {
      await withPgOwner(pool, actor, async (client) => {
        await client.query(
          `UPDATE audio_projects SET name = $1, master_config_json = $2, revision = $3, updated_at = $4
           WHERE project_id = $5 AND owner_issuer = $6 AND owner_sub = $7`,
          [title, JSON.stringify(master), nextRevision, now, projectId, issuer, sub]
        );
      });
    } else {
      sqlite.prepare(
        `UPDATE audio_projects SET name = ?, master_config_json = ?, revision = ?, updated_at = ?
         WHERE project_id = ? AND owner_issuer = ? AND owner_sub = ?`
      ).run(title, JSON.stringify(master), nextRevision, now, projectId, issuer, sub);
    }
    const snapshot = await getProject(actor, projectId);
    if (pool) {
      await withPgOwner(pool, actor, (client) =>
        client.query(
          `INSERT INTO audio_revisions (project_id, owner_issuer, owner_sub, revision, title, document, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (project_id, revision) DO UPDATE SET title = EXCLUDED.title, document = EXCLUDED.document`,
          [projectId, issuer, sub, nextRevision, title, JSON.stringify(snapshot || {}), now]
        )
      );
    } else {
      sqlite.prepare(
        `INSERT OR REPLACE INTO audio_revisions (project_id, owner_issuer, owner_sub, revision, title, document, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(projectId, issuer, sub, nextRevision, title, JSON.stringify(snapshot || {}), now);
    }
    await appendAudit(actor, projectId, action || 'commit_revision', details || { nextRevision });
    return snapshot;
  }

  async function recordMixdown(actor, projectId, mixInput) {
    const { issuer, sub } = assertOwner(actor);
    const mixId = crypto.randomUUID();
    const format = mixInput.format === 'mp3' ? 'mp3' : 'wav';
    const filename = String(mixInput.filename || `mixdown_${mixId.slice(0, 8)}.${format}`).slice(0, 120);
    const durationSec = Number(mixInput.durationSeconds ?? 0);
    const sampleRate = Number(mixInput.sampleRate ?? 48000);
    const targetLufs = Number(mixInput.targetLufs ?? -14.0);
    const lufs = Number(mixInput.lufsIntegrated ?? -14.0);
    const peak = Number(mixInput.truePeakDb ?? -1.0);
    const compliance = peak <= -0.95 ? 'ITU-R BS.1770 PASS' : 'PEAK CLAMPED';
    const now = new Date().toISOString();
    if (pool) {
      const row = await withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          `INSERT INTO audio_mixdowns (mixdown_id, project_id, owner_issuer, owner_sub, user_sub, blob_sha256, filename, format, duration_sec, sample_rate, target_lufs, measured_lufs, true_peak, compliance, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
          [mixId, projectId, issuer, sub, sub, mixInput.blobHash, filename, format, durationSec, sampleRate, targetLufs, lufs, peak, compliance, now]
        );
        return r.rows[0];
      });
      await appendAudit(actor, projectId, 'render_mixdown', { mixdownId: mixId, format, lufs });
      return normalizeMixdownRow(row);
    }
    sqlite.prepare(
      `INSERT INTO audio_mixdowns (mixdown_id, project_id, owner_issuer, owner_sub, user_sub, blob_sha256, filename, format, duration_sec, sample_rate, target_lufs, measured_lufs, true_peak, compliance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(mixId, projectId, issuer, sub, sub, mixInput.blobHash, filename, format, durationSec, sampleRate, targetLufs, lufs, peak, compliance, now);
    await appendAudit(actor, projectId, 'render_mixdown', { mixdownId: mixId, format, lufs });
    const row = sqlite.prepare('SELECT * FROM audio_mixdowns WHERE mixdown_id = ?').get(mixId);
    return normalizeMixdownRow(row);
  }

  async function listMixdowns(actor, projectId = null) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = projectId
          ? await client.query('SELECT * FROM audio_mixdowns WHERE project_id = $1 AND owner_issuer = $2 AND owner_sub = $3 ORDER BY created_at DESC', [projectId, issuer, sub])
          : await client.query('SELECT * FROM audio_mixdowns WHERE owner_issuer = $1 AND owner_sub = $2 ORDER BY created_at DESC LIMIT 50', [issuer, sub]);
        return r.rows.map(normalizeMixdownRow);
      });
    }
    const rows = projectId
      ? sqlite.prepare('SELECT * FROM audio_mixdowns WHERE project_id = ? AND owner_issuer = ? AND owner_sub = ? ORDER BY created_at DESC').all(projectId, issuer, sub)
      : sqlite.prepare('SELECT * FROM audio_mixdowns WHERE owner_issuer = ? AND owner_sub = ? ORDER BY created_at DESC LIMIT 50').all(issuer, sub);
    return rows.map(normalizeMixdownRow);
  }

  async function deleteProject(actor, projectId) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = await client.query('DELETE FROM audio_projects WHERE project_id = $1 AND owner_issuer = $2 AND owner_sub = $3', [projectId, issuer, sub]);
        return r.rowCount > 0;
      });
    }
    const r = sqlite.prepare('DELETE FROM audio_projects WHERE project_id = ? AND owner_issuer = ? AND owner_sub = ?').run(projectId, issuer, sub);
    return r.changes > 0;
  }

  async function cleanupOrphanBlobs(actor) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const r = await client.query(
          `DELETE FROM audio_blobs b
           WHERE b.owner_issuer = $1 AND b.owner_sub = $2
             AND NOT EXISTS (SELECT 1 FROM audio_stems s WHERE s.owner_issuer = $1 AND s.owner_sub = $2 AND s.blob_sha256 = b.sha256)
             AND NOT EXISTS (SELECT 1 FROM audio_mixdowns m WHERE m.owner_issuer = $1 AND m.owner_sub = $2 AND m.blob_sha256 = b.sha256)`,
          [issuer, sub]
        );
        return r.rowCount || 0;
      });
    }
    const r = sqlite.prepare(
      `DELETE FROM audio_blobs
       WHERE owner_issuer = ? AND owner_sub = ?
         AND sha256 NOT IN (SELECT blob_sha256 FROM audio_stems WHERE owner_issuer = ? AND owner_sub = ?)
         AND sha256 NOT IN (SELECT blob_sha256 FROM audio_mixdowns WHERE owner_issuer = ? AND owner_sub = ?)`
    ).run(issuer, sub, issuer, sub, issuer, sub);
    return Number(r.changes || 0);
  }

  async function appendAudit(actor, projectId, action, details = {}) {
    const { issuer, sub } = assertOwner(actor);
    const eventId = crypto.randomUUID();
    const jsonText = JSON.stringify(details || {});
    if (pool) {
      return withPgOwner(pool, actor, (client) =>
        client.query(
          'INSERT INTO audio_audit_log (event_id, owner_issuer, owner_sub, user_sub, project_id, action, actor, details_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [eventId, issuer, sub, sub, projectId || null, action, sub, jsonText]
        )
      );
    }
    sqlite.prepare(
      'INSERT INTO audio_audit_log (event_id, owner_issuer, owner_sub, user_sub, project_id, action, actor, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(eventId, issuer, sub, sub, projectId || null, action, sub, jsonText);
  }

  async function getSummaryCounts(actor) {
    const { issuer, sub } = assertOwner(actor);
    if (pool) {
      return withPgOwner(pool, actor, async (client) => {
        const [p, s, m] = await Promise.all([
          client.query('SELECT COUNT(*)::int AS c FROM audio_projects WHERE owner_issuer = $1 AND owner_sub = $2', [issuer, sub]),
          client.query('SELECT COUNT(*)::int AS c FROM audio_stems WHERE owner_issuer = $1 AND owner_sub = $2', [issuer, sub]),
          client.query('SELECT COUNT(*)::int AS c FROM audio_mixdowns WHERE owner_issuer = $1 AND owner_sub = $2', [issuer, sub]),
        ]);
        return { projects: p.rows[0].c, stems: s.rows[0].c, mixdowns: m.rows[0].c };
      });
    }
    const projects = Number(sqlite.prepare('SELECT COUNT(*) AS c FROM audio_projects WHERE owner_issuer = ? AND owner_sub = ?').get(issuer, sub)?.c || 0);
    const stems = Number(sqlite.prepare('SELECT COUNT(*) AS c FROM audio_stems WHERE owner_issuer = ? AND owner_sub = ?').get(issuer, sub)?.c || 0);
    const mixdowns = Number(sqlite.prepare('SELECT COUNT(*) AS c FROM audio_mixdowns WHERE owner_issuer = ? AND owner_sub = ?').get(issuer, sub)?.c || 0);
    return { projects, stems, mixdowns };
  }

  return {
    pool,
    sqlite,
    upsertBlob,
    getOwnedBlobMeta,
    listProjects,
    getProject,
    createProject,
    addStem,
    updateStemConfig,
    removeStem,
    commitProjectRevision,
    recordMixdown,
    listMixdowns,
    deleteProject,
    cleanupOrphanBlobs,
    appendAudit,
    getSummaryCounts,
    withPgOwner: (actor, work) => withPgOwner(pool, actor, work),
  };
}

module.exports = {
  getDatabase,
  resolveDbPath,
  applyNativeSchema,
  withPgOwner,
  createAudioRepository,
  assertOwner,
  buildStemConfig,
};
