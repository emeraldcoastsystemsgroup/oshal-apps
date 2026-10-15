/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist current-actor motion revisions and owned raster bytes with atomic conflicts, idempotency and fresh permission checks.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain every owned footage source referenced by a validated native revision even when the request omits its attachment list.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Refuse native asset rows exceeding encoded page capacity before insertion, preserving readable owned libraries until durable binary storage is available.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Expose metadata through the declared thousand-project and thousand-revision cardinality for complete agent index pages.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep source read and create current throughout copy validation, retry and commit without changing existing create fingerprints.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Keep durable owned photos outside native row collections with metadata-only handles and rollback-owned receipts.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Persist lossless revision bodies as private immutable files with exact quotas, original action checks and common transaction-owned receipts.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Hold shared/exclusive owner leases and committed SQL epoch fences across original references, safe orphan recovery and publication.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Stream complete editable archives and atomically create recipient-owned remapped sources and precise project snapshots.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Bind render source services to matching sealed original principals before any source read.
 */
import { encodeBundle, decodeBundle } from './portable-bundle.mjs';
import {parseNative,stringifyNative} from '../tools/native-json.mjs';
import { randomUUID, createHash } from 'node:crypto';
export const LIMITS = Object.freeze({ documentBytes: 2097152, projects: 1000, revisions: 1000, imageBytes: 4194304,
  assets: 64, assetBytes: 268435456, revisionBytes: 268435456, dimension: 8192, pixels: 33554432, references: 64, title: 160 });
export class MotionError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new MotionError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ? value.toLowerCase() : fail(400, 'motion_invalid_id');
const revision = value => Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.revisions ? value : fail(400, 'motion_invalid_revision');
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'motion_invalid_input');
}
function identity(ctx) {
  const actor = ctx.authorization.currentActor();
  if (!actor?.isActive || typeof actor.issuer !== 'string' || typeof actor.sub !== 'string'
      || !actor.issuer.trim() || !actor.sub.trim() || actor.issuer.length > 2048 || actor.sub.length > 2048) fail(401, 'motion_verified_identity_required');
  return { issuer: actor.issuer, sub: actor.sub };
}
function snapshot(row, assets) {
  return { id: row.project_id, title: row.title, revision: row.revision ?? row.current_revision,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at ?? row.created_at).toISOString(),
    ...((row.document_text!==undefined||row.document) ? { document: row.document_text!==undefined?parseNative(row.document_text):row.document, assets } : {}) };
}
function documentInput(value) {
  fields(value, ['title', 'document', 'assets', 'requestKey', 'baseRevision']);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > LIMITS.title) fail(400, 'motion_invalid_title');
  if (!value.document || typeof value.document !== 'object' || Array.isArray(value.document)) fail(400, 'motion_invalid_document');
  let text;
  try { text = stringifyNative(value.document); } catch { fail(400, 'motion_invalid_document'); }
  if (Buffer.byteLength(text) > LIMITS.documentBytes) fail(413, 'motion_document_limit');
  const document = parseNative(text), assets = value.assets ?? [];
  if (!Array.isArray(assets) || assets.length > LIMITS.references) fail(400, 'motion_asset_reference_limit');
  const references = assets.map(uuid);
  if (document.items && typeof document.items === 'object' && !Array.isArray(document.items)) {
    for (const item of Object.values(document.items)) {
      if (item?.kind?.type !== 'Footage') continue;
      const match = typeof item.kind.path === 'string' && /^oshal-asset:([^@]+)@[0-9a-f]{64}$/.exec(item.kind.path);
      if (match) references.push(uuid(match[1]));
    }
  }
  const unique = [...new Set(references)].sort();
  if (unique.length > LIMITS.references) fail(400, 'motion_asset_reference_limit');
  return { title: value.title, document, assets: unique, requestKey: uuid(value.requestKey) };
}
const digest = value => createHash('sha256').update(value).digest('hex');

/** Routes pass the original admitted context, never an owner from a query, body or agent input.
 * Native document/model validation and raster decoding precede persistence at the route/engine boundary. */
export class MotionProjectStore {
  #ctx;
  #validateDocument;
  #decodeRaster;
  #blobs;
  #revisionBlobs;
  constructor(ctx, { validateDocument, decodeRaster, blobs, revisionBlobs }) {
    if (!ctx?.authorization?.currentActor || !ctx.authorization.authorize || !ctx.pool?.connect) throw new Error('motion_verified_context_required');
    if (typeof validateDocument !== 'function' || typeof decodeRaster !== 'function') throw new Error('motion_trusted_validators_required');
    this.#ctx = ctx; this.#validateDocument = validateDocument; this.#decodeRaster = decodeRaster; this.#blobs = blobs; this.#revisionBlobs = revisionBlobs;
  }
  async assertOriginalContext(ctx) {
    const own = identity(this.#ctx), actor = identity(ctx);
    if (own.issuer !== actor.issuer || own.sub !== actor.sub || typeof ctx.intent !== 'function' || typeof this.#ctx.intent !== 'function') fail(401, 'motion_original_context_mismatch');
    const left = (await this.#ctx.intent('auth.caller', {}))?.principal, right = (await ctx.intent('auth.caller', {}))?.principal;
    if (!left || !right || !['id','tenant','issuer','subject'].every(key => typeof left[key] === 'string' && left[key] && left[key] === right[key]) || left.state !== 'active' || right.state !== 'active'
        || left.issuer !== own.issuer || left.subject !== own.sub) fail(401, 'motion_original_context_mismatch');
    const currentOwn = identity(this.#ctx), currentActor = identity(ctx);
    if (currentOwn.issuer !== own.issuer || currentOwn.sub !== own.sub || currentActor.issuer !== actor.issuer || currentActor.sub !== actor.sub) fail(401, 'motion_original_context_mismatch');
  }
  async #access(action, expected) {
    const owner = identity(this.#ctx);
    if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub)) fail(401, 'motion_identity_changed');
    const permissions = ['view', ...(action === 'copy' ? ['read', 'create'] : action === 'upload' ? [] : ['export', 'change'].includes(action) ? ['read', action] : [action])];
    for (const permission of new Set(permissions)) if (!(await this.#ctx.authorization.authorize({ permission: 'project.' + permission })).allowed) fail(403, 'motion_permission_denied');
    if (action === 'upload' && !(await this.#ctx.authorization.authorize({ permission: 'project.create' })).allowed
        && !(await this.#ctx.authorization.authorize({ permission: 'project.change' })).allowed) fail(403, 'motion_permission_denied');
    const current = identity(this.#ctx);
    if (current.issuer !== owner.issuer || current.sub !== owner.sub) fail(401, 'motion_identity_changed');
    return owner;
  }
  async #begin(client, owner, write) {
    await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SELECT set_config('motion.owner_issuer',$1,true),set_config('motion.owner_sub',$2,true)", [owner.issuer, owner.sub]);
    if (write) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['motion-studio', owner.issuer, owner.sub])]);
  }
  #fence(client, owner) {
    return client.query('INSERT INTO motion_blob_epochs (owner_issuer,owner_sub,epoch) VALUES ($1,$2,1) ON CONFLICT (owner_issuer,owner_sub) DO UPDATE SET epoch=motion_blob_epochs.epoch+1', [owner.issuer, owner.sub]);
  }
  async #recover(client, owner, action, lease) {
    await this.#begin(client, owner, true); await this.#access(action, owner);
    // Commit an actual changed collection together with the observed references.
    // Native optimistic CAS compares all observed revisions, fencing a late old commit.
    await this.#fence(client, owner); let photo, revisions;
    if (this.#blobs) photo = (await client.query('SELECT blob_handle FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND blob_handle IS NOT NULL', [owner.issuer, owner.sub])).rows;
    if (this.#revisionBlobs) revisions = (await client.query('SELECT document_blob FROM motion_revisions WHERE owner_issuer=$1 AND owner_sub=$2 AND document_blob IS NOT NULL', [owner.issuer, owner.sub])).rows;
    await this.#access(action, owner); await lease.check(); await client.query('COMMIT');
    // No orphan is removed until this recovery snapshot has committed successfully.
    if (photo) await this.#blobs.reconcile(new Set(photo.map(row => row.blob_handle)), action, lease);
    if (revisions) await this.#revisionBlobs.reconcile(new Set(revisions.map(row => row.document_blob)), action, lease);
  }
  async #transaction(action, write, work, expected, beforeCommit) {
    const owner = await this.#access(action, expected); let client, lease, discard = false; const receipts = [];
    try {
      lease = await (this.#blobs ?? this.#revisionBlobs)?.lease(action, { write });
      client = await this.#ctx.pool.connect();
      if (write && lease) await this.#recover(client, owner, action, lease);
      await this.#begin(client, owner, write); await this.#access(action, owner);
      // Every guarded data publisher participates, including a process killed while its COMMIT is pending.
      if (write && lease) await this.#fence(client, owner);
      const result = await work(client, [owner.issuer, owner.sub], receipts);
      await this.#access(action, owner); await lease?.check(); beforeCommit?.(); for (const receipt of receipts) receipt.commit(); await client.query('COMMIT'); return result;
    } catch (error) {
      if (client) try { await client.query('ROLLBACK'); } catch { discard = true; }
      for (const receipt of receipts) await receipt.rollback(); throw error;
    } finally { try { client?.release(discard); } finally { lease?.close(); } }
  }
  async list() {
    return this.#transaction('read', false, async (client, owner) => {
      const result = await client.query('SELECT project_id,title,current_revision,created_at,updated_at FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY updated_at DESC,project_id LIMIT 1000', owner);
      return result.rows.map(row => snapshot(row));
    });
  }
  async #read(client, owner, id, version, action = 'read') {
    const result = await client.query(`SELECT p.project_id,r.title,r.revision,p.created_at,r.created_at AS updated_at,r.document::text AS document_text,r.document_blob,r.document_bytes,r.document_sha256
      FROM motion_projects p JOIN motion_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub
      WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=COALESCE($4,p.current_revision)`, [...owner, id, version ?? null]);
    if (!result.rows.length) fail(404, 'motion_project_not_found');
    const row = result.rows[0];
    if (row.document_blob) {
      if (!this.#revisionBlobs) fail(503, 'motion_revision_storage_unavailable');
      const bytes = await this.#revisionBlobs.read({ id: row.document_blob, bytes: row.document_bytes, sha256: row.document_sha256 }, action);
      try { row.document_text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); parseNative(row.document_text); }
      catch { fail(503, 'motion_revision_integrity_error'); }
    }
    const references = await client.query('SELECT asset_id FROM motion_revision_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND revision=$4 ORDER BY asset_id', [...owner, id, result.rows[0].revision]);
    return snapshot(result.rows[0], references.rows.map(row => row.asset_id));
  }
  get(id, version) {
    id = uuid(id); if (version !== undefined) version = revision(version);
    return this.#transaction('read', false, (client, owner) => this.#read(client, owner, id, version));
  }
  reference(id, version) {
    id = uuid(id); version = revision(version);
    return this.#transaction('read', false, async (client, owner) => {
      const result = await client.query(`SELECT p.project_id,r.title,r.revision,p.created_at,r.created_at AS updated_at
        FROM motion_projects p JOIN motion_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub
        WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=$4`, [...owner,id,version]);
      if (!result.rows.length) fail(404,'motion_project_not_found');
      return snapshot(result.rows[0]);
    });
  }
  export(id, version) {
    id = uuid(id); if (version !== undefined) version = revision(version);
    return this.#transaction('export', false, (client, owner) => this.#read(client, owner, id, version, 'export'));
  }
  async #checkAssets(client, owner, assets) {
    if (!assets.length) return;
    const result = await client.query('SELECT asset_id FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[])', [...owner, assets]);
    if (result.rows.length !== assets.length) fail(400, 'motion_asset_unavailable');
  }
  async #append(client, owner, id, version, input, action, receipts) {
    await this.#checkAssets(client, owner, input.assets);
    const text = stringifyNative(input.document), bytes = Buffer.from(text);
    if (!this.#revisionBlobs && this.#ctx.pool.storageModel === 'kernel-scoped-documents') fail(503, 'motion_revision_storage_unavailable');
    const budget = await client.query('SELECT COALESCE(SUM(COALESCE(document_bytes,octet_length(document::text))),0)::bigint AS bytes FROM motion_revisions WHERE owner_issuer=$1 AND owner_sub=$2', owner);
    // Durable bytes are exact; legacy JSONB reserves room for its expanded encoding.
    if (Number(budget.rows[0].bytes) + (this.#revisionBlobs ? bytes.length : 2 * bytes.length) > LIMITS.revisionBytes) fail(409, 'motion_revision_storage_limit');
    let receipt;
    if (this.#revisionBlobs) { receipt = await this.#revisionBlobs.put(bytes, action); receipts.push(receipt); }
    await client.query('INSERT INTO motion_revisions (project_id,owner_issuer,owner_sub,revision,title,document,document_blob,document_bytes,document_sha256) VALUES ($3,$1,$2,$4,$5,$6::jsonb,$7,$8,$9)', [...owner, id, version, input.title, receipt ? null : text, receipt?.ref.id ?? null, receipt?.ref.bytes ?? null, receipt?.ref.sha256 ?? null]);
    for (const asset of input.assets) await client.query('INSERT INTO motion_revision_assets (project_id,revision,owner_issuer,owner_sub,asset_id) VALUES ($3,$4,$1,$2,$5)', [...owner, id, version, asset]);
  }
  async #replay(client, owner, input, fingerprint, action) {
    const result = await client.query('SELECT fingerprint,project_id,revision FROM motion_requests WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [...owner, input.requestKey]);
    if (!result.rows.length) return null;
    if (result.rows[0].fingerprint !== fingerprint) fail(409, 'motion_idempotency_conflict');
    return this.#read(client, owner, result.rows[0].project_id, result.rows[0].revision, action);
  }
  #recordRequest(client, owner, input, fingerprint, id, version) {
    return client.query('INSERT INTO motion_requests (owner_issuer,owner_sub,request_key,fingerprint,project_id,revision) VALUES ($1,$2,$3,$4,$5,$6)', [...owner, input.requestKey, fingerprint, id, version]);
  }
  create(value) { return this.#create(value, 'create'); }
  copy(value, sourceTag) {
    if (typeof sourceTag !== 'string' || !sourceTag || sourceTag.length > 256) fail(400, 'motion_invalid_copy_source');
    return this.#create(value, 'copy', sourceTag);
  }
  async copyReplay(requestKey, sourceTag, title) {
    requestKey = uuid(requestKey);
    if (typeof sourceTag !== 'string' || !sourceTag || sourceTag.length > 256) fail(400, 'motion_invalid_copy_source');
    const original = await this.#access('copy');
    const held = await this.#transaction('copy', false, async (client, owner) => {
      const result = await client.query('SELECT fingerprint,project_id,revision FROM motion_requests WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [...owner, requestKey]);
      if (!result.rows.length) return null;
      const row = result.rows[0]; return { fingerprint: row.fingerprint, snapshot: await this.#read(client, owner, row.project_id, row.revision, 'copy') };
    }, original);
    if (!held) return null;
    // The independent copy retains the original native data even after the parent
    // is deleted. Canonicalize it again: PostgreSQL JSONB reorders object keys.
    let input = documentInput({ title: title ?? held.snapshot.title, document: held.snapshot.document, assets: held.snapshot.assets, requestKey });
    input = documentInput({ ...input, document: await this.#validateDocument(input.document) });
    const fingerprint = digest(stringifyNative(['copy', sourceTag, input.title, input.document, input.assets]));
    await this.#access('copy', original);
    if (held.fingerprint !== fingerprint) fail(409, 'motion_idempotency_conflict');
    return this.#transaction('copy', false, (client, owner) => this.#read(client, owner, held.snapshot.id, held.snapshot.revision, 'copy'), original);
  }
  async #create(value, action, sourceTag) {
    const original = await this.#access(action);
    let input = documentInput(value);
    input = documentInput({ ...input, document: await this.#validateDocument(input.document) });
    if (value.baseRevision !== undefined) fail(400, 'motion_invalid_input');
    const fingerprint = digest(stringifyNative(action === 'copy' ? ['copy', sourceTag, input.title, input.document, input.assets] : ['create', input.title, input.document, input.assets]));
    return this.#transaction(action, true, async (client, owner, receipts) => {
      const replay = await this.#replay(client, owner, input, fingerprint, action); if (replay) return replay;
      const count = await client.query('SELECT COUNT(*)::int AS count FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2', owner);
      if (count.rows[0].count >= LIMITS.projects) fail(409, 'motion_project_limit');
      const id = randomUUID();
      await client.query('INSERT INTO motion_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4)', [...owner, id, input.title]);
      await this.#append(client, owner, id, 1, input, action, receipts); await this.#recordRequest(client, owner, input, fingerprint, id, 1);
      return this.#read(client, owner, id, 1, action);
    }, original);
  }
  async save(id, value) {
    const original = await this.#access('change');
    id = uuid(id); let input = documentInput(value); const expected = revision(value.baseRevision);
    input = documentInput({ ...input, document: await this.#validateDocument(input.document) });
    const fingerprint = digest(stringifyNative(['save', id, expected, input.title, input.document, input.assets]));
    return this.#transaction('change', true, async (client, owner, receipts) => {
      const replay = await this.#replay(client, owner, input, fingerprint, 'change'); if (replay) return replay;
      const result = await client.query('SELECT current_revision FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 FOR UPDATE', [...owner, id]);
      if (!result.rows.length) fail(404, 'motion_project_not_found');
      if (result.rows[0].current_revision !== expected) fail(409, 'motion_revision_conflict');
      if (expected >= LIMITS.revisions) fail(409, 'motion_revision_limit');
      await this.#append(client, owner, id, expected + 1, input, 'change', receipts);
      await client.query('UPDATE motion_projects SET title=$4,current_revision=$5,updated_at=now() WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [...owner, id, input.title, expected + 1]);
      await this.#recordRequest(client, owner, input, fingerprint, id, expected + 1);
      return this.#read(client, owner, id, expected + 1, 'change');
    }, original);
  }
  revisions(id) {
    id = uuid(id);
    return this.#transaction('read', false, async (client, owner) => {
      const found = await client.query('SELECT project_id FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [...owner, id]);
      if (!found.rows.length) fail(404, 'motion_project_not_found');
      const result = await client.query('SELECT revision,title,created_at FROM motion_revisions WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 ORDER BY revision DESC LIMIT 1000', [...owner, id]);
      return result.rows.map(row => ({ revision: row.revision, title: row.title, createdAt: new Date(row.created_at).toISOString() }));
    });
  }
  async delete(id) {
    id = uuid(id); let retired = [];
    const result = await this.#transaction('delete', true, async (client, owner) => {
      retired = (await client.query('SELECT document_blob,document_bytes,document_sha256 FROM motion_revisions WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND document_blob IS NOT NULL', [...owner, id])).rows;
      const deleted = await client.query('DELETE FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [...owner, id]);
      if (!deleted.rowCount) fail(404, 'motion_project_not_found'); return { deleted: true };
    });
    let cleanupPending = false;
    for (const row of retired) {
      try {
        if (!this.#revisionBlobs) fail(503, 'motion_revision_storage_unavailable');
        await this.#revisionBlobs.remove({ id: row.document_blob, bytes: row.document_bytes, sha256: row.document_sha256 });
      } catch { cleanupPending = true; }
    }
    return cleanupPending ? { ...result, cleanupPending } : result;
  }
  /** Input comes from the trusted decoder; raster decode and model validation stay outside SQL transactions. */
  async uploadAsset(value) {
    const original = await this.#access('upload');
    fields(value, ['bytes']);
    if (!(value.bytes instanceof Uint8Array) || !value.bytes.length || value.bytes.length > LIMITS.imageBytes) fail(413, 'motion_image_limit');
    const decoded = await this.#decodeRaster(Buffer.from(value.bytes));
    const { type, width, height } = decoded;
    if (!(decoded.bytes instanceof Uint8Array) || !decoded.bytes.length || decoded.bytes.length > LIMITS.imageBytes) fail(413, 'motion_image_limit');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)
        || ![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= LIMITS.dimension)
        || width * height > LIMITS.pixels) fail(400, 'motion_invalid_raster');
    const bytes = Buffer.from(decoded.bytes), hash = digest(bytes), id = randomUUID();
    if (!this.#blobs && this.#ctx.pool.storageModel === 'kernel-scoped-documents') fail(503, 'motion_blob_storage_unavailable');
    let receipt;
    try {
      const result = await this.#transaction('upload', true, async (client, owner) => {
        const count = await client.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::bigint AS bytes FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2', owner);
        if (count.rows[0].count >= LIMITS.assets || Number(count.rows[0].bytes) + bytes.length > LIMITS.assetBytes) fail(409, 'motion_asset_limit');
        if (this.#blobs) receipt = await this.#blobs.put(bytes);
        await client.query('INSERT INTO motion_assets (asset_id,owner_issuer,owner_sub,media_type,width,height,byte_length,sha256,content_base64,blob_handle) VALUES ($3,$1,$2,$4,$5,$6,$7,$8,$9,$10)', [...owner, id, type, width, height, bytes.length, hash, receipt ? null : bytes.toString('base64'), receipt?.ref.id ?? null]);
        return { id, type, width, height, bytes: bytes.length, sha256: hash };
      }, original, () => receipt?.commit());
      return result;
    } catch (error) { await receipt?.rollback(); throw error; }
  }

  listAssets() {
    return this.#transaction('read', false, async (client, owner) => {
      const result = await client.query('SELECT asset_id,media_type,width,height,byte_length,sha256 FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY created_at DESC,asset_id LIMIT 64', owner);
      return result.rows.map(row => ({ id: row.asset_id, type: row.media_type, width: row.width, height: row.height, bytes: row.byte_length, sha256: row.sha256 }));
    });
  }
  async deleteAsset(id) {
    id = uuid(id); let retired;
    const result = await this.#transaction('delete', true, async (client, owner) => {
      const references = await client.query('SELECT COUNT(*)::int AS count FROM motion_revision_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [...owner, id]);
      if (references.rows[0].count) fail(409, 'motion_asset_in_use');
      const found = await client.query('SELECT blob_handle,sha256,byte_length FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [...owner, id]);
      if (!found.rows.length) fail(404, 'motion_asset_not_found');
      const row = found.rows[0];
      if (row.blob_handle) retired = { id: row.blob_handle, sha256: row.sha256, bytes: row.byte_length };
      const deleted = await client.query('DELETE FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [...owner, id]);
      if (!deleted.rowCount) fail(404, 'motion_asset_not_found'); return { deleted: true };
    });
    if (retired) {
      try { if (!this.#blobs) fail(503, 'motion_blob_storage_unavailable'); await this.#blobs.remove(retired); }
      catch { return { ...result, cleanupPending: true }; }
    }
    return result;
  }
  async #asset(client, owner, id, action = 'read') {
    const result = await client.query('SELECT asset_id,media_type,width,height,byte_length,sha256,content_base64,blob_handle FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [...owner, id]);
    if (!result.rows.length) fail(404, 'motion_asset_not_found');
    const row = result.rows[0];
    if (row.blob_handle && !this.#blobs) fail(503, 'motion_blob_storage_unavailable');
    const bytes = row.blob_handle ? await this.#blobs.read({ id: row.blob_handle, sha256: row.sha256, bytes: row.byte_length }, action) : Buffer.from(row.content_base64, 'base64');
    if (bytes.length !== row.byte_length || digest(bytes) !== row.sha256) fail(503, 'motion_asset_integrity_error');
    return { id: row.asset_id, type: row.media_type, width: row.width, height: row.height, sha256: row.sha256, bytes };
  }
  asset(id) {
    id = uuid(id);
    return this.#transaction('read', false, (client, owner) => this.#asset(client, owner, id));
  }
  /** Sink is the source-owned streaming transport, never a caller URL/path or identity.
   * The shared read lease and original SQL snapshot remain live throughout sink backpressure.
   */
  async exportBundleTo(id, version, sink) {
    const original = await this.#access('export'); id = uuid(id); if (version !== undefined) version = revision(version);
    if (typeof sink !== 'function') fail(400, 'motion_bundle_sink_required');
    return this.#transaction('export', false, async (client, owner) => {
      const project = await this.#read(client, owner, id, version, 'export');
      const rows = project.assets.length ? (await client.query('SELECT asset_id,media_type,width,height,byte_length,sha256 FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[]) ORDER BY asset_id', [...owner, project.assets])).rows : [];
      if (rows.length !== project.assets.length) fail(503, 'motion_asset_unavailable');
      const assets = rows.map(row => ({ id: row.asset_id, type: row.media_type, width: row.width, height: row.height, bytes: row.byte_length, sha256: row.sha256 }));
      const stream = encodeBundle({ title: project.title, document: project.document, assets }, async asset => (await this.#asset(client, owner, asset, 'export')).bytes, () => this.#access('export', original));
      const hasher = createHash('sha256'); let bytes = 0;
      for await (const chunk of stream) { await this.#access('export', original); hasher.update(chunk); bytes += chunk.length; await sink(chunk); await this.#access('export', original); }
      return { project: id, revision: project.revision, bytes, sha256: hasher.digest('hex'), format: 'oshal-motion-bundle', version: 1 };
    }, original);
  }
  /** A portable copy creates new recipient-owned assets; archive ids are local references, never authority. */
  async importBundle(source, options) {
    const original = await this.#access('copy'); fields(options, ['requestKey','title']); const requestKey = uuid(options.requestKey);
    const bundle = await decodeBundle(source, () => this.#access('copy', original));
    const title = options.title ?? bundle.manifest.title;
    if (typeof title !== 'string' || !title.trim() || title.length > LIMITS.title) fail(400, 'motion_invalid_title');
    const fingerprint = digest(JSON.stringify(['portable-import', bundle.sha256, title]));
    const replay = await this.#transaction('copy', false, async (client, owner) => {
      const held = await client.query('SELECT fingerprint,project_id,revision FROM motion_requests WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [...owner, requestKey]);
      if (!held.rows.length) return null;
      if (held.rows[0].fingerprint !== fingerprint) fail(409, 'motion_idempotency_conflict');
      return this.#read(client, owner, held.rows[0].project_id, held.rows[0].revision, 'copy');
    }, original);
    if (replay) return replay;
    const incoming = new Map();
    for (const asset of bundle.assets) {
      await this.#access('copy', original); const decoded = await this.#decodeRaster(asset.data);
      if (!(decoded.bytes instanceof Uint8Array) || !decoded.bytes.length || decoded.bytes.length > LIMITS.imageBytes
          || decoded.type !== 'image/png' || decoded.width !== asset.width || decoded.height !== asset.height) fail(400, 'motion_bundle_invalid_raster');
      const bytes = Buffer.from(decoded.bytes);
      incoming.set(asset.id, { oldSha: asset.sha256, id: randomUUID(), type: decoded.type, width: decoded.width, height: decoded.height, bytes, sha256: digest(bytes) });
    }
    const document = parseNative(stringifyNative(bundle.document)), renderer = []; let rendererBytes = 0;
    for (const item of Object.values(document.items ?? {})) {
      if (item?.kind?.type !== 'Footage') continue;
      const matched = typeof item.kind.path === 'string' && /^oshal-asset:([^@]+)@([0-9a-f]{64})$/.exec(item.kind.path), asset = matched && incoming.get(matched[1]);
      if (!asset || asset.oldSha !== matched[2]) fail(400, 'motion_bundle_source_unavailable');
      item.kind.path = 'oshal-asset:' + asset.id + '@' + asset.sha256;
      if (!renderer.some(row => row.id === asset.id)) {
        rendererBytes += asset.bytes.length; if (rendererBytes > 6291456) fail(413, 'motion_asset_transport_limit');
        renderer.push({ id: asset.id, sha256: asset.sha256, data: asset.bytes.toString('base64') });
      }
    }
    // Supplemental attached sources stay portable without inflating compositor input.
    let input = documentInput({ title, document, assets: [...incoming.values()].map(asset => asset.id), requestKey });
    input = documentInput({ ...input, document: await this.#validateDocument(input.document, renderer) });
    await this.#access('copy', original);
    return this.#transaction('copy', true, async (client, owner, receipts) => {
      const held = await client.query('SELECT fingerprint,project_id,revision FROM motion_requests WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [...owner, requestKey]);
      if (held.rows.length) {
        if (held.rows[0].fingerprint !== fingerprint) fail(409, 'motion_idempotency_conflict');
        return this.#read(client, owner, held.rows[0].project_id, held.rows[0].revision, 'copy');
      }
      const budget = (await client.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::bigint AS bytes FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2', owner)).rows[0];
      const total = [...incoming.values()].reduce((sum, asset) => sum + asset.bytes.length, 0);
      if (budget.count + incoming.size > LIMITS.assets || Number(budget.bytes) + total > LIMITS.assetBytes) fail(409, 'motion_asset_limit');
      const count = await client.query('SELECT COUNT(*)::int AS count FROM motion_projects WHERE owner_issuer=$1 AND owner_sub=$2', owner);
      if (count.rows[0].count >= LIMITS.projects) fail(409, 'motion_project_limit');
      if (this.#ctx.pool.storageModel === 'kernel-scoped-documents' && !this.#blobs) fail(503, 'motion_blob_storage_unavailable');
      for (const asset of incoming.values()) {
        let receipt; if (this.#blobs) { receipt = await this.#blobs.put(asset.bytes, 'copy'); receipts.push(receipt); }
        await client.query('INSERT INTO motion_assets (asset_id,owner_issuer,owner_sub,media_type,width,height,byte_length,sha256,content_base64,blob_handle) VALUES ($3,$1,$2,$4,$5,$6,$7,$8,$9,$10)', [...owner, asset.id, asset.type, asset.width, asset.height, asset.bytes.length, asset.sha256, receipt ? null : asset.bytes.toString('base64'), receipt?.ref.id ?? null]);
      }
      const id = randomUUID(); await client.query('INSERT INTO motion_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4)', [...owner, id, title]);
      await this.#append(client, owner, id, 1, input, 'copy', receipts); await this.#recordRequest(client, owner, input, fingerprint, id, 1);
      return this.#read(client, owner, id, 1, 'copy');
    }, original);
  }
}
