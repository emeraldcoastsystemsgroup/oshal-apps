/** CHANGE LOG: 2026-11-05 | maintainer@emeraldcoastsystemsgroup.com | Recheck the exact owned source-change permission without granting processing or worker configuration. */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorOwnerKey = exports.CAPTION_REQUIREMENTS = void 0;
exports.captionSchemaStatements = captionSchemaStatements;
exports.decorateCaptionImages = decorateCaptionImages;
exports.createCaptionEditorRoutes = createCaptionEditorRoutes;
exports.datasetCaptionReadiness = datasetCaptionReadiness;
exports.captionStateCallback = captionStateCallback;
exports.datasetStateCallback = datasetStateCallback;
exports.editorAccess = access;
exports.editorTransaction = transaction;
exports.assertEditorCharacterOwner = assertEditorCharacterOwner;
exports.bindNewCharacterEditor = bindNewCharacterEditor;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-bound CAS caption intentions, genuine worker acknowledgements, training readiness and cosmetic character metadata; trained model/identity anchors remain immutable.
 */
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const lora_callback_grants_1 = require("./lora-callback-grants");
const lora_train_dispatch_1 = require("./lora-train-dispatch");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
class CaptionError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
function original(ctx) {
    const a = ctx.authorization?.currentActor();
    if (!a?.isActive || !a.issuer || !a.sub || !a.principalId || a.tenantIds?.length !== 1)
        throw new CaptionError('An active original person is required.', 401);
    return {
        issuer: a.issuer,
        sub: a.sub,
        principalId: a.principalId,
        tenant: a.tenantIds[0]
    };
}
const ownerKey = (a) => hash(JSON.stringify(a));
exports.editorOwnerKey = ownerKey;
async function access(ctx, permission, expected) {
    const a = original(ctx);
    if (expected && JSON.stringify(a) !== JSON.stringify(expected))
        throw new CaptionError('The original person changed.', 401);
    for (const required of new Set(['lora.read', permission])) {
        if (!(await ctx.authorization.authorize({
            permission: required
        })).allowed)
            throw new CaptionError('Your current role does not allow this action.', 403);
        if (JSON.stringify(original(ctx)) !== JSON.stringify(a))
            throw new CaptionError('The original person changed.', 401);
    }
    if (JSON.stringify(original(ctx)) !== JSON.stringify(a))
        throw new CaptionError('The original person changed.', 401);
    return a;
}
async function transaction(ctx, permission, a, work) {
    await access(ctx, permission, a);
    const client = await ctx.pool.connect();
    let begun = false;
    try {
        await client.query('BEGIN');
        begun = true;
        await client.query("SELECT set_config('lora_editor.owner_key',$1,true)", [ownerKey(a)]);
        const out = await work(client);
        await access(ctx, permission, a);
        await client.query('COMMIT');
        begun = false;
        return out;
    }
    catch (error) {
        if (begun)
            await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
const identityColumns = ['character_id', 'owner_key', 'revision', 'updated_at'];
const captionColumns = ['image_id', 'character_id', 'owner_key', 'caption', 'caption_revision', 'applied_revision', 'caption_sha256', 'applied_sha256', 'status', 'update_id', 'ticket_id', 'updated_at'];
exports.CAPTION_REQUIREMENTS = [{
        table: 'oshal_lora_dataset_imports',
        columns: ['image_id', 'character_id', 'owner_key', 'import_revision', 'ticket_id', 'updated_at']
    }, {
        table: 'oshal_lora_dataset_captions',
        columns: captionColumns
    }, {
        table: 'oshal_lora_character_editor',
        columns: identityColumns
    }];
function captionSchemaStatements() {
    const statements = [`CREATE TABLE IF NOT EXISTS oshal_lora_dataset_imports (image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE,character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,owner_key TEXT NOT NULL,import_revision INTEGER NOT NULL,ticket_id TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`, `CREATE TABLE IF NOT EXISTS oshal_lora_dataset_captions (image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE, character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE, owner_key TEXT NOT NULL, caption TEXT NOT NULL, caption_revision INTEGER NOT NULL, applied_revision INTEGER NOT NULL DEFAULT 0, caption_sha256 TEXT NOT NULL, applied_sha256 TEXT, status TEXT NOT NULL, update_id UUID NOT NULL, ticket_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`, `CREATE TABLE IF NOT EXISTS oshal_lora_character_editor (character_id UUID PRIMARY KEY REFERENCES oshal_lora_characters(id) ON DELETE CASCADE, owner_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`];
    for (const table of ['oshal_lora_dataset_imports', 'oshal_lora_dataset_captions', 'oshal_lora_character_editor'])
        statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS ${table}_read ON ${table}`, `CREATE POLICY ${table}_read ON ${table} FOR SELECT USING (EXISTS (SELECT 1 FROM oshal_lora_characters c WHERE c.id=${table}.character_id AND (c.owner_sub=current_setting('oshal.current_sub',true) OR current_setting('oshal.is_operator',true)='on')))`, `DROP POLICY IF EXISTS ${table}_write ON ${table}`, `CREATE POLICY ${table}_write ON ${table} FOR ALL USING (owner_key=current_setting('lora_editor.owner_key',true) AND EXISTS (SELECT 1 FROM oshal_lora_characters c WHERE c.id=${table}.character_id AND c.owner_sub=current_setting('oshal.current_sub',true))) WITH CHECK (owner_key=current_setting('lora_editor.owner_key',true) AND EXISTS (SELECT 1 FROM oshal_lora_characters c WHERE c.id=${table}.character_id AND c.owner_sub=current_setting('oshal.current_sub',true)))`);
    return statements;
}
function caption(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 2048)
        throw new CaptionError('Caption must contain 1–2048 UTF-8 bytes without a null character.');
    return value;
}
function revision(value) {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1000000)
        throw new CaptionError('Use the current bounded caption revision.');
    return Number(value);
}
function body(req, allowed) {
    const raw = req.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new CaptionError('Use a bounded editor object.');
    const b = {
        ...raw
    };
    for (const [key, value] of Object.entries(req.params)) {
        if (b[key] !== undefined) {
            if (String(b[key]) !== String(value))
                throw new CaptionError('The editor path identity does not match the request.', 409);
            if (!allowed.includes(key))
                delete b[key];
        }
    }
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !allowed.includes(k)))
        throw new CaptionError('Unsupported editor field.');
    return b;
}
const answer = (res, error) => res.status(error instanceof CaptionError ? error.status : 503).json({
    error: error instanceof CaptionError ? 'lora_editor_refused' : 'lora_editor_unavailable',
    message: error instanceof CaptionError ? error.message : 'The saved editor source is unavailable. Your field edit was kept.'
});
function publicImage(image, state) {
    return {
        id: String(image.id),
        filename: image.filename,
        caption: state?.caption ?? image.caption,
        applied_caption: image.caption,
        caption_revision: Number(state?.caption_revision ?? 0),
        applied_revision: Number(state?.applied_revision ?? 0),
        caption_status: state?.status ?? (image.status === 'ready' ? 'applied' : image.status)
    };
}
async function decorateCaptionImages(ctx, characterId, images) {
    let a;
    try {
        a = original(ctx);
    }
    catch {
        return images.map(i => ({
            ...i,
            ...publicImage(i, null)
        }));
    }
    const rows = (await ctx.pool.query('SELECT * FROM oshal_lora_dataset_captions WHERE character_id=$1 AND owner_key=$2', [characterId, ownerKey(a)])).rows;
    return images.map(i => ({
        ...i,
        ...publicImage(i, rows.find((s) => s.image_id === i.id))
    }));
}
async function can(ctx, permission, a) {
    try {
        await access(ctx, permission, a);
        return true;
    }
    catch (error) {
        if (error instanceof CaptionError && error.status === 403)
            return false;
        throw error;
    }
}
async function owned(ctx, deps, req, subject, permission) {
    const a = await access(ctx, permission);
    if (deps.callerSub(req) !== a.sub)
        throw new CaptionError('The original person does not match the request.', 401);
    const character = await deps.loadCharacter(ctx, subject, a.sub);
    if (!character)
        throw new CaptionError('Character not found.', 404);
    await assertEditorCharacterOwner(ctx, character.id, a);
    return {
        a,
        character
    };
}
async function queue(ctx, deps, character, a, state, image) {
    try {
        await access(ctx, 'lora.execute', a);
    }
    catch (error) {
        if (error instanceof CaptionError && error.status === 403)
            return {
                status: 'permission-required'
            };
        throw error;
    }
    const ticket = await ctx.ticketService.createTicket({
        title: `Save caption ${image.filename}`,
        ticketType: 'lora-train',
        description: 'Atomically update the selected owned dataset caption and acknowledge its exact source revision.',
        status: 'approved',
        priority: 'none',
        labels: ['lora', 'caption', character.config.subject],
        workspaceId: null,
        assignedAgentId: deps.directorAgentId,
        parentTicketId: null,
        externalProvider: null,
        externalId: null,
        externalUrl: null,
        ownerSub: a.sub,
        metadata: {
            app: 'lora',
            character: character.config.subject,
            action: 'caption-write',
            datasetImageId: image.id,
            captionRevision: state.caption_revision,
            updateId: state.update_id
        }
    });
    await transaction(ctx, 'lora.execute', a, async (client) => {
        const bound = await client.query(`UPDATE oshal_lora_dataset_captions SET ticket_id=$4,status='pending',updated_at=NOW() WHERE image_id=$1 AND owner_key=$2 AND update_id=$3 RETURNING image_id`, [image.id, ownerKey(a), state.update_id, ticket.ticketId]);
        if (bound.rowCount !== 1)
            throw new CaptionError('The saved caption changed before dispatch. Reload it.', 409);
    });
    await access(ctx, 'lora.execute', a);
    const command = (0, lora_train_dispatch_1.buildCaptionUpdateCommand)(character.config, {
        imageId: String(image.id),
        filename: image.filename,
        caption: state.caption,
        revision: Number(state.caption_revision),
        updateId: state.update_id,
        sha256: state.caption_sha256
    }, a.sub), dispatched = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, {
        characterId: character.id,
        ownerSub: a.sub,
        ticketId: ticket.ticketId,
        dispatchKind: 'caption-write'
    }, command);
    if (!dispatched.ok)
        await transaction(ctx, 'lora.source.change', a, async (client) => client.query(`UPDATE oshal_lora_dataset_captions SET status='failed',updated_at=NOW() WHERE image_id=$1 AND owner_key=$2 AND update_id=$3 AND status='pending'`, [image.id, ownerKey(a), state.update_id]));
    return {
        status: dispatched.ok ? 'queued' : 'failed',
        ticketId: ticket.ticketId,
        ...(dispatched.ok ? {} : {
            message: dispatched.error || 'The worker did not accept this caption update.'
        })
    };
}
function createCaptionEditorRoutes(ctx, deps) {
    const router = (0, express_1.Router)();
    router.get('/editor-contract', async (req, res) => {
        try {
            await access(ctx, 'lora.read');
            res.json({
                version: 1,
                caption: {
                    maxUtf8Bytes: 2048,
                    save: 'PATCH /dataset/:imageId/caption',
                    retry: 'POST /dataset/:imageId/caption/retry',
                    required: ['subject', 'baseRevision'],
                    rules: ['Read actual saved image ID and revision; never guess identities.', 'Only acknowledged worker bytes advance applied_revision.', 'Pending captions block training; trained weights remain immutable.']
                },
                identity: {
                    path: '/characters/:subject/editor',
                    editable: ['displayName'],
                    immutable: ['triggerWord', 'heroImage', 'baseModel', 'trainedWeights']
                }
            });
        }
        catch (error) {
            answer(res, error);
        }
    });
    router.get('/dataset/:imageId/caption', async (req, res) => {
        try {
            const imageId = String(req.params.imageId);
            if (!UUID.test(imageId))
                throw new CaptionError('Choose a saved dataset image.');
            const { a, character } = await owned(ctx, deps, req, String(req.query.subject ?? ''), 'lora.read'), image = (await ctx.pool.query('SELECT * FROM oshal_lora_dataset_images WHERE id=$1 AND character_id=$2', [imageId, character.id])).rows[0];
            if (!image)
                throw new CaptionError('Dataset image not found.', 404);
            const state = (await ctx.pool.query('SELECT * FROM oshal_lora_dataset_captions WHERE image_id=$1', [imageId])).rows[0];
            if (state && state.owner_key !== ownerKey(a))
                throw new CaptionError('This source belongs to a different original person.', 403);
            await access(ctx, 'lora.read', a);
            res.json({
                subject: character.config.subject,
                image: publicImage(image, state)
            });
        }
        catch (error) {
            answer(res, error);
        }
    });
    router.get('/characters/:subject/editor', async (req, res) => {
        try {
            const { a, character } = await owned(ctx, deps, req, String(req.params.subject), 'lora.read'), row = (await ctx.pool.query('SELECT display_name FROM oshal_lora_characters WHERE id=$1 AND owner_sub=$2', [character.id, a.sub])).rows[0], state = (await ctx.pool.query('SELECT * FROM oshal_lora_character_editor WHERE character_id=$1', [character.id])).rows[0];
            if (state && state.owner_key !== ownerKey(a))
                throw new CaptionError('This profile is bound to a different original person.', 403);
            res.json({
                subject: character.config.subject,
                characterId: character.id,
                displayName: row.display_name,
                revision: Number(state?.revision ?? 0),
                canConfigure: await can(ctx, 'lora.source.change', a),
                canExecute: await can(ctx, 'lora.execute', a)
            });
        }
        catch (error) {
            answer(res, error);
        }
    });
    router.patch('/characters/:subject/editor', async (req, res) => {
        try {
            const b = body(req, ['displayName', 'baseRevision']), name = typeof b.displayName === 'string' ? b.displayName.trim() : '', base = revision(b.baseRevision);
            if (!name || name.length > 120 || /[\x00-\x1f]/.test(name))
                throw new CaptionError('Use a display name between 1 and 120 characters.');
            const { a, character } = await owned(ctx, deps, req, String(req.params.subject), 'lora.source.change');
            const next = await transaction(ctx, 'lora.source.change', a, async (client) => {
                await client.query('SELECT id FROM oshal_lora_characters WHERE id=$1 AND owner_sub=$2 FOR UPDATE', [character.id, a.sub]);
                const old = (await client.query('SELECT * FROM oshal_lora_character_editor WHERE character_id=$1', [character.id])).rows[0];
                if (old && old.owner_key !== ownerKey(a))
                    throw new CaptionError('This profile belongs to a different original person.', 403);
                if (Number(old?.revision ?? 0) !== base)
                    throw new CaptionError('The display name changed. Reload before saving.', 409);
                await client.query('UPDATE oshal_lora_characters SET display_name=$2 WHERE id=$1 AND owner_sub=$3', [character.id, name, a.sub]);
                await client.query(`INSERT INTO oshal_lora_character_editor(character_id,owner_key,revision) VALUES($1,$2,$3) ON CONFLICT(character_id) DO UPDATE SET revision=EXCLUDED.revision,updated_at=NOW()`, [character.id, ownerKey(a), base + 1]);
                return base + 1;
            });
            res.json({
                subject: character.config.subject,
                characterId: character.id,
                displayName: name,
                revision: next
            });
        }
        catch (error) {
            answer(res, error);
        }
    });
    const edit = (retry) => async (req, res) => {
        try {
            const b = body(req, retry ? ['subject', 'baseRevision'] : ['subject', 'caption', 'baseRevision']), base = revision(b.baseRevision), imageId = String(req.params.imageId);
            if (!UUID.test(imageId))
                throw new CaptionError('Choose a saved dataset image.');
            const { a, character } = await owned(ctx, deps, req, String(b.subject ?? ''), 'lora.source.change');
            const { image, state } = await transaction(ctx, 'lora.source.change', a, async (client) => {
                await client.query('SELECT id FROM oshal_lora_characters WHERE id=$1 AND owner_sub=$2 FOR UPDATE', [character.id, a.sub]);
                const image = (await client.query('SELECT * FROM oshal_lora_dataset_images WHERE id=$1 AND character_id=$2 FOR UPDATE', [imageId, character.id])).rows[0];
                if (!image)
                    throw new CaptionError('Dataset image not found.', 404);
                if (image.status !== 'ready')
                    throw new CaptionError('Wait for the original image import to finish before editing its caption.', 409);
                const names = (await client.query('SELECT filename FROM oshal_lora_dataset_images WHERE character_id=$1', [character.id])).rows.map((i) => String(i.filename).replace(/\.[^.]+$/, '.txt').toLowerCase());
                if (names.filter((n) => n === String(image.filename).replace(/\.[^.]+$/, '.txt').toLowerCase()).length !== 1)
                    throw new CaptionError('Multiple images share this worker caption basename; use an unambiguous dataset filename.', 409);
                const old = (await client.query('SELECT * FROM oshal_lora_dataset_captions WHERE image_id=$1', [imageId])).rows[0];
                if (old && old.owner_key !== ownerKey(a))
                    throw new CaptionError('This caption source is bound to another original person.', 403);
                if (Number(old?.caption_revision ?? 0) !== base)
                    throw new CaptionError('The caption changed. Reload before saving.', 409);
                if (retry) {
                    if (!old || old.status === 'applied')
                        throw new CaptionError('There is no pending caption to retry.', 409);
                    return {
                        image,
                        state: old
                    };
                }
                const desired = caption(b.caption), next = base + 1, update = (0, node_crypto_1.randomUUID)(), sha = hash(desired);
                const state = (await client.query(`INSERT INTO oshal_lora_dataset_captions(image_id,character_id,owner_key,caption,caption_revision,applied_revision,caption_sha256,applied_sha256,status,update_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) ON CONFLICT(image_id) DO UPDATE SET caption=EXCLUDED.caption,caption_revision=EXCLUDED.caption_revision,caption_sha256=EXCLUDED.caption_sha256,status='pending',update_id=EXCLUDED.update_id,ticket_id=NULL,updated_at=NOW() RETURNING *`, [imageId, character.id, ownerKey(a), desired, next, Number(old?.applied_revision ?? 0), sha, old?.applied_sha256 ?? hash(image.caption), update])).rows[0];
                return {
                    image,
                    state
                };
            });
            const dispatch = await queue(ctx, deps, character, a, state, image);
            res.status(202).json({
                ok: true,
                image: {
                    ...publicImage(image, state),
                    caption_status: dispatch.status === 'failed' ? 'failed' : 'pending'
                },
                dispatch
            });
        }
        catch (error) {
            answer(res, error);
        }
    };
    router.patch('/dataset/:imageId/caption', edit(false));
    router.post('/dataset/:imageId/caption/retry', edit(true));
    return router;
}
/** Every managed image must be durable and every requested caption applied before a new training task may start. */
async function datasetCaptionReadiness(ctx, characterId) {
    const rows = (await ctx.pool.query(`SELECT d.id,d.status,c.caption_revision,c.applied_revision,c.status AS caption_status FROM oshal_lora_dataset_images d LEFT JOIN oshal_lora_dataset_captions c ON c.image_id=d.id WHERE d.character_id=$1`, [characterId])).rows;
    const pending = rows.filter((r) => r.status !== 'ready' || r.caption_revision != null && (Number(r.caption_revision) !== Number(r.applied_revision) || r.caption_status !== 'applied'));
    return {
        ok: !pending.length,
        message: pending.length ? 'Apply or retry all pending dataset captions and wait for worker acknowledgement before training.' : ''
    };
}
async function captionStateCallback(ctx, res, character, grant, b) {
    try {
        const a = await access(ctx, 'lora.execute'), image = String(b.image_id ?? ''), update = String(b.update_id ?? ''), rev = revision(b.revision), sha = String(b.sha256 ?? ''), status = String(b.status ?? '');
        await assertEditorCharacterOwner(ctx, character.id, a);
        if (!UUID.test(image) || !UUID.test(update) || !/^[a-f0-9]{64}$/.test(sha) || !['applied', 'failed', 'check'].includes(status) || !grant.ticketId)
            throw new CaptionError('Use an exact caption job receipt.');
        if (status === 'check') {
            await access(ctx, 'lora.source.change', a);
            const row = (await ctx.pool.query(`SELECT image_id FROM oshal_lora_dataset_captions WHERE image_id=$1 AND character_id=$2 AND owner_key=$3 AND update_id=$4 AND caption_revision=$5 AND caption_sha256=$6 AND ticket_id=$7 AND status IN ('pending','failed')`, [image, character.id, ownerKey(a), update, rev, sha, grant.ticketId])).rows[0];
            if (!row)
                throw new CaptionError('The caption job is stale or belongs to another image.', 409);
            await access(ctx, 'lora.source.change', a);
            await access(ctx, 'lora.execute', a);
            res.json({
                ok: true,
                kind: 'caption',
                status: 'check',
                revision: rev
            });
            return false;
        }
        await transaction(ctx, 'lora.execute', a, async (client) => {
            const out = await client.query(`UPDATE oshal_lora_dataset_captions SET status=$7,applied_revision=CASE WHEN $7='applied' THEN caption_revision ELSE applied_revision END,applied_sha256=CASE WHEN $7='applied' THEN caption_sha256 ELSE applied_sha256 END,updated_at=NOW() WHERE image_id=$1 AND character_id=$2 AND owner_key=$3 AND update_id=$4 AND caption_revision=$5 AND caption_sha256=$6 AND ticket_id=$8 AND status IN ('pending','failed') RETURNING caption`, [image, character.id, ownerKey(a), update, rev, sha, status, grant.ticketId]);
            if (out.rowCount !== 1)
                throw new CaptionError('The caption job is stale or belongs to another image.', 409);
            if (status === 'applied')
                await client.query('UPDATE oshal_lora_dataset_images SET caption=$3 WHERE id=$1 AND character_id=$2', [image, character.id, out.rows[0].caption]);
        });
        res.json({
            ok: true,
            kind: 'caption',
            image_id: image,
            revision: rev,
            status
        });
        return true;
    }
    catch (error) {
        answer(res, error);
        return false;
    }
}
async function datasetStateCallback(ctx, res, character) {
    try {
        const a = await access(ctx, 'lora.execute');
        await assertEditorCharacterOwner(ctx, character.id, a);
        const ready = await datasetCaptionReadiness(ctx, character.id);
        if (!ready.ok)
            throw new CaptionError(ready.message, 409);
        const rows = (await ctx.pool.query(`SELECT d.id,d.filename,d.caption,c.owner_key,c.caption_revision,c.applied_revision,c.applied_sha256 FROM oshal_lora_dataset_images d LEFT JOIN oshal_lora_dataset_captions c ON c.image_id=d.id WHERE d.character_id=$1 ORDER BY d.id`, [character.id])).rows;
        if (rows.length > 1000)
            throw new CaptionError('The managed caption manifest exceeds its worker bound.', 413);
        if (rows.some((r) => r.owner_key && r.owner_key !== ownerKey(a)))
            throw new CaptionError('This dataset contains a source bound to a different original person.', 403);
        res.json({
            ok: true,
            kind: 'dataset-state',
            captions: rows.map((r) => ({
                imageId: r.id,
                filename: r.filename,
                revision: Number(r.applied_revision ?? 0),
                sha256: r.applied_sha256 ?? hash(r.caption)
            }))
        });
    }
    catch (error) {
        answer(res, error);
    }
}
/** Legacy owner_sub is not proof of original-person ownership on a shared SQL deployment. Native physical namespaces are authoritative; other rows need creation-time provenance. */
async function assertEditorCharacterOwner(ctx, characterId, person) {
    const a = person ?? (await access(ctx, 'lora.read')), row = (await ctx.pool.query('SELECT owner_key FROM oshal_lora_character_editor WHERE character_id=$1', [characterId])).rows[0];
    if (row) {
        if (row.owner_key !== ownerKey(a))
            throw new CaptionError('This character is bound to a different original person.', 403);
        return;
    }
    if (ctx.pool.storageModel === 'kernel-scoped-documents')
        return;
    throw new CaptionError('This legacy character needs verified original-owner binding before editing. Its original source was kept.', 403);
}
/** Called only with the id RETURNED BY a successful new character INSERT, inside that insert transaction. It never adopts an existing row. */
async function bindNewCharacterEditor(ctx, client, characterId, expected) {
    const raw = ctx.authorization?.currentActor();
    if (!raw?.principalId && !raw?.tenantIds)
        return;
    const a = await access(ctx, 'lora.source.change', expected);
    await client.query("SELECT set_config('lora_editor.owner_key',$1,true)", [ownerKey(a)]);
    await client.query('INSERT INTO oshal_lora_character_editor(character_id,owner_key,revision) VALUES($1,$2,0)', [characterId, ownerKey(a)]);
    await access(ctx, 'lora.source.change', a);
}
