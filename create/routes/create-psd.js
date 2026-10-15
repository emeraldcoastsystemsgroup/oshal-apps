"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PSD_PROFILE = void 0;
exports.psdSourceMetadata = psdSourceMetadata;
exports.parsePsd = parsePsd;
exports.psdInspection = psdInspection;
exports.psdSelection = psdSelection;
exports.importPsd = importPsd;
exports.readPsdSource = readPsdSource;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve original PSD bytes, conversion findings and editable owned layers in one original-owner transaction.
 */
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const node_worker_threads_1 = require("node:worker_threads");
const sharp_1 = __importDefault(require("sharp"));
const create_project_validation_1 = require("./create-project-validation");
const create_project_types_1 = require("./create-project-types");
exports.PSD_PROFILE = Object.freeze({ version: 1, fileBytes: 4194304, retainedSourceBytes: 4194304,
    pngBytes: 16777216, imageBytes: 8388608, dimension: 2048, canvasPixels: 4194304,
    decodedPixels: 8388608, pixelLayers: 32, records: 64, groupDepth: 4, concurrentRequests: 2, parserWorkers: 2, parserTimeoutMs: 10000 });
const digest = (bytes) => (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
function psdSourceMetadata(source) {
    return { profileVersion: 1, projectId: source.project_id, importedRevision: 1, sha256: source.sha256, bytes: Number(source.byte_length), mode: source.import_mode, report: source.report };
}
let workers = 0;
/** Bound parsing workers independently of input compression; no arbitrary source module is accepted. */
async function parsePsd(bytes, packageDir) {
    if (!bytes.length || bytes.length > exports.PSD_PROFILE.fileBytes)
        throw new create_project_types_1.ProjectError(413, 'psd_file_limit');
    if (workers >= 2)
        throw new create_project_types_1.ProjectError(503, 'psd_import_busy');
    workers++;
    try {
        const input = Uint8Array.from(bytes).buffer;
        return await new Promise((resolveResult, reject) => {
            let replied = false;
            const worker = new node_worker_threads_1.Worker((0, node_url_1.pathToFileURL)((0, node_path_1.resolve)(packageDir, 'tools/editor/psd-worker.mjs')), { workerData: input, transferList: [input], resourceLimits: { maxOldGenerationSizeMb: 128 } });
            const timer = setTimeout(() => { void worker.terminate(); reject(new create_project_types_1.ProjectError(503, 'psd_parser_timeout')); }, 10000);
            worker.once('message', (message) => {
                replied = true;
                clearTimeout(timer);
                void worker.terminate();
                if (message.parsed)
                    resolveResult(message.parsed);
                else
                    reject(new create_project_types_1.ProjectError(message.error?.includes('limit') ? 413 : 400, message.error ?? 'invalid_psd'));
            });
            worker.once('error', () => { clearTimeout(timer); reject(new create_project_types_1.ProjectError(400, 'invalid_psd')); });
            worker.once('exit', () => { clearTimeout(timer); if (!replied)
                reject(new create_project_types_1.ProjectError(503, 'psd_parser_unavailable')); });
        });
    }
    finally {
        workers--;
    }
}
function psdInspection(bytes, parsed) {
    return { profile: exports.PSD_PROFILE, sha256: digest(bytes), bytes: bytes.length, width: parsed.width, height: parsed.height,
        editable: parsed.editable, flattened: parsed.flattenable, pixelLayers: parsed.layers.filter(l => !l.section).length, report: parsed.report };
}
function parser(packageDir) {
    const file = (0, node_path_1.resolve)(packageDir, 'tools/editor/psd-reader.mjs'), url = (0, node_url_1.pathToFileURL)(file);
    url.searchParams.set('revision', digest((0, node_fs_1.readFileSync)(file)));
    return import(url.href);
}
function psdSelection(value) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160
        || typeof value.mode !== 'string' || !['editable', 'flattened'].includes(value.mode)
        || typeof value.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
        || typeof value.requestKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.requestKey))
        throw new create_project_types_1.ProjectError(400, 'invalid_psd_selection');
    return { title: value.title.trim(), mode: value.mode, expectedSha256: value.expectedSha256, requestKey: value.requestKey };
}
async function original(client, owner, key) {
    const result = await client.query('SELECT project_id,sha256,byte_length,report,import_mode,request_digest,request_key FROM create_psd_sources WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [owner.issuer, owner.sub, key]);
    return result.rows[0];
}
async function revisionOne(client, owner, id) {
    const result = await client.query('SELECT p.project_id,r.title,r.document,p.created_at,r.created_at AS updated_at FROM create_projects p JOIN create_project_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=1', [owner.issuer, owner.sub, id]);
    const row = result.rows[0];
    if (!row)
        throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
    return { id: row.project_id, title: row.title, revision: 1, document: row.document, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
async function prepareImages(parsed, selection) {
    if (selection.mode === 'editable' && !parsed.editable)
        throw new create_project_types_1.ProjectError(422, 'psd_editable_unsupported');
    if (selection.mode === 'flattened' && !parsed.flattenable)
        throw new create_project_types_1.ProjectError(422, 'psd_flattened_unsupported');
    const source = selection.mode === 'editable' ? parsed.layers.filter(l => !l.section) : [{ index: -1, width: parsed.width, height: parsed.height, rgba: parsed.merged }];
    const images = new Map();
    let total = 0;
    for (const layer of source) {
        if (!layer.rgba)
            throw new create_project_types_1.ProjectError(400, 'psd_pixel_layer_unsupported');
        const bytes = await (0, sharp_1.default)(Buffer.from(layer.rgba), { raw: { width: layer.width, height: layer.height, channels: 4 }, limitInputPixels: exports.PSD_PROFILE.canvasPixels }).png().toBuffer();
        total += bytes.length;
        if (bytes.length > exports.PSD_PROFILE.imageBytes || total > exports.PSD_PROFILE.pngBytes)
            throw new create_project_types_1.ProjectError(413, 'psd_png_limit');
        const id = (0, node_crypto_1.randomUUID)();
        images.set(layer.index, { bytes, asset: { id, src: create_project_types_1.PROJECT_ASSET_PREFIX + id, width: layer.width, height: layer.height, bytes: bytes.length, sha256: digest(bytes) } });
    }
    return images;
}
/** One owned writer/client couples image parts, original parts, report and first editable revision. */
async function importPsd(store, owner, bytes, parsed, selection, validator, packageDir, dataRoot, confirm) {
    const sha = digest(bytes);
    if (sha !== selection.expectedSha256)
        throw new create_project_types_1.ProjectError(409, 'psd_source_changed');
    const requestDigest = digest(JSON.stringify(['create-psd/1', sha, selection.mode, selection.title]));
    const files = [];
    let completed = false;
    try {
        const result = await store.transaction(owner, true, async (client) => {
            await store.ownerLock(client, owner);
            const previous = await original(client, owner, selection.requestKey);
            if (previous) {
                if (previous.request_digest !== requestDigest)
                    throw new create_project_types_1.ProjectError(409, 'psd_request_conflict');
                return { project: await revisionOne(client, owner, previous.project_id), source: psdSourceMetadata(previous), replayed: true };
            }
            const total = await client.query('SELECT COALESCE(SUM(byte_length),0)::bigint AS bytes FROM create_psd_sources WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
            if (Number(total.rows[0].bytes) + bytes.length > exports.PSD_PROFILE.retainedSourceBytes)
                throw new create_project_types_1.ProjectError(413, 'psd_original_storage_limit');
            const images = await prepareImages(parsed, selection), assets = new Map([...images].map(([index, value]) => [index, value.asset]));
            let document;
            if (selection.mode === 'editable') {
                try {
                    document = (await parser(packageDir)).psdDocument(parsed, assets, selection.title);
                }
                catch {
                    throw new create_project_types_1.ProjectError(400, 'psd_group_frame_unsupported');
                }
            }
            else {
                const image = assets.get(-1);
                document = { version: 1, name: selection.title, width: parsed.width, height: parsed.height, background: 'transparent',
                    layers: [{ id: 'psd-merged', type: 'image', name: 'Flattened PSD preview', assetId: image.id, x: 0, y: 0, w: parsed.width, h: parsed.height, rotation: 0, opacity: 1, visible: true, locked: false }],
                    images: { [image.id]: { src: image.src, width: image.width, height: image.height } } };
            }
            const input = (0, create_project_validation_1.projectInput)({ title: selection.title, document }, validator);
            for (const image of images.values()) {
                await confirm();
                if (!store.nativeImageStorage) {
                    const directory = (0, node_path_1.join)(dataRoot, digest(JSON.stringify([owner.issuer, owner.sub])));
                    await (0, promises_1.mkdir)(directory, { recursive: true, mode: 0o700 });
                    const stat = await (0, promises_1.lstat)(directory);
                    if (!stat.isDirectory() || stat.isSymbolicLink())
                        throw new create_project_types_1.ProjectError(503, 'project_asset_storage_unavailable');
                    const path = (0, node_path_1.join)(directory, image.asset.id + '.png');
                    await (0, promises_1.writeFile)(path, image.bytes, { flag: 'wx', mode: 0o600 });
                    const file = await (0, promises_1.lstat)(path);
                    files.push({ path, dev: file.dev, ino: file.ino });
                }
                await store.addAssetInTransaction(client, owner, image.asset, image.bytes);
            }
            const project = await store.createInTransaction(client, owner, input);
            await client.query('INSERT INTO create_psd_sources (project_id,owner_issuer,owner_sub,request_key,request_digest,sha256,byte_length,import_mode,report) VALUES ($3,$1,$2,$4,$5,$6,$7,$8,$9::jsonb)', [owner.issuer, owner.sub, project.id, selection.requestKey, requestDigest, sha, bytes.length, selection.mode, JSON.stringify(parsed.report)]);
            for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
                const part = bytes.subarray(offset, offset + 65536);
                await client.query('INSERT INTO create_psd_source_parts (project_id,owner_issuer,owner_sub,part_index,byte_length,sha256,content_base64) VALUES ($3,$1,$2,$4,$5,$6,$7)', [owner.issuer, owner.sub, project.id, index, part.length, digest(part), part.toString('base64')]);
            }
            return { project, source: psdSourceMetadata({ project_id: project.id, sha256: sha, byte_length: bytes.length, report: parsed.report, import_mode: selection.mode }), replayed: false };
        }, confirm);
        completed = true;
        return result;
    }
    finally {
        if (!completed && files.length) {
            // A lost COMMIT acknowledgement must never remove already published files.
            // If the original is durably present (or reconciliation itself refuses),
            // retain immutable bytes; the same sealed request key recovers publication.
            let absent = false;
            try {
                absent = await store.transaction(owner, false, async (client) => !(await original(client, owner, selection.requestKey)));
            }
            catch { /* uncertain commit retains bytes */ }
            if (absent)
                for (const file of files) {
                    const current = await (0, promises_1.lstat)(file.path);
                    if (current.isFile() && !current.isSymbolicLink() && current.dev === file.dev && current.ino === file.ino)
                        await (0, promises_1.unlink)(file.path);
                }
        }
    }
}
/** Read only an actual original owned project/source join, then verify every byte before releasing it. */
async function readPsdSource(store, owner, id, content, confirm) {
    return store.transaction(owner, false, async (client) => {
        const metadata = await client.query('SELECT s.project_id,s.sha256,s.byte_length,s.report,s.import_mode,s.request_digest,s.request_key FROM create_psd_sources s JOIN create_projects p ON p.project_id=s.project_id AND p.owner_issuer=s.owner_issuer AND p.owner_sub=s.owner_sub WHERE s.owner_issuer=$1 AND s.owner_sub=$2 AND s.project_id=$3', [owner.issuer, owner.sub, id]);
        const source = metadata.rows[0];
        if (!source)
            throw new create_project_types_1.ProjectError(404, 'psd_source_not_found');
        if (!Number.isSafeInteger(Number(source.byte_length)) || Number(source.byte_length) < 1 || Number(source.byte_length) > exports.PSD_PROFILE.fileBytes || !/^[a-f0-9]{64}$/.test(source.sha256))
            throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
        if (!content)
            return { source };
        const parts = await client.query('SELECT part_index,byte_length,sha256,content_base64 FROM create_psd_source_parts WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 ORDER BY part_index', [owner.issuer, owner.sub, id]), chunks = [];
        let size = 0;
        if (parts.rows.length !== Math.ceil(Number(source.byte_length) / 65536))
            throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
        for (const [index, part] of parts.rows.entries()) {
            await confirm();
            if (part.part_index !== index || typeof part.content_base64 !== 'string' || part.content_base64.length > 87384)
                throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
            const bytes = Buffer.from(part.content_base64, 'base64');
            size += bytes.length;
            if (bytes.length !== Math.min(65536, Number(source.byte_length) - index * 65536) || bytes.length !== Number(part.byte_length) || bytes.toString('base64') !== part.content_base64 || digest(bytes) !== part.sha256 || size > exports.PSD_PROFILE.fileBytes)
                throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
            chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks, size);
        if (size !== Number(source.byte_length) || digest(bytes) !== source.sha256)
            throw new create_project_types_1.ProjectError(503, 'psd_source_unavailable');
        return { source, bytes };
    }, confirm);
}
