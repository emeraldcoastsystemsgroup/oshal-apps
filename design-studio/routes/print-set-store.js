"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: where a product's print set lives and how
 *                     |                             | it is written. The cad-studio data-dir idiom: a root that is
 *                     |                             | never inside the package directory - DESIGN_STUDIO_DATA_DIR, else
 *                     |                             | the native kernel's lasting directory (OSHAL_PACKAGE_DATA_DIR,
 *                     |                             | the manifest's lastingStorage), else the shared workspace, else
 *                     |                             | a local fallback - then <root>/<sha(sub)>/<projectId>/ with every
 *                     |                             | file name a constant or derived from a validated part id. One set
 *                     |                             | per product: begin wipes the directory and writes set.json; each
 *                     |                             | part arrives as bytes that are parsed back and checked watertight
 *                     |                             | before they are kept (a mesh that is not watertight is recorded
 *                     |                             | unprintable with the fault, its bytes dropped); finish refuses
 *                     |                             | while a part has neither a file nor a reason, then writes the
 *                     |                             | sheet, the BOM and the manifest and digests them.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_DIR_ENV = void 0;
exports.resolveDataRoot = resolveDataRoot;
exports.subHash = subHash;
exports.setDir = setDir;
exports.readState = readState;
exports.beginSet = beginSet;
exports.addPart = addPart;
exports.markUnprintable = markUnprintable;
exports.finishSet = finishSet;
exports.readManifest = readManifest;
exports.readSent = readSent;
exports.recordSent = recordSent;
exports.servedFiles = servedFiles;
exports.listing = listing;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const phase_model_1 = require("./phase-model");
const print_set_mesh_1 = require("./print-set-mesh");
const print_set_model_1 = require("./print-set-model");
exports.DATA_DIR_ENV = 'DESIGN_STUDIO_DATA_DIR';
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * @description Resolve the print-set root: explicit env, the native lasting directory, the shared workspace, or a local fallback.
 * @param env - Usually process.env.
 * @param exists - Directory probe, injectable for specs.
 * @returns An absolute directory (not necessarily created yet).
 */
function resolveDataRoot(env, exists = node_fs_1.default.existsSync) {
    const explicit = (env[exports.DATA_DIR_ENV] ?? '').trim();
    if (explicit)
        return node_path_1.default.resolve(explicit);
    const lasting = (env.OSHAL_PACKAGE_DATA_DIR ?? '').trim();
    if (lasting)
        return node_path_1.default.join(node_path_1.default.resolve(lasting), 'print-sets');
    const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
    if (shared)
        return node_path_1.default.join(node_path_1.default.resolve(shared), 'design-studio');
    if (exists(CONTAINER_WORKSPACE_ROOT))
        return node_path_1.default.join(CONTAINER_WORKSPACE_ROOT, 'design-studio');
    return node_path_1.default.join(node_path_1.default.resolve(process.cwd(), 'workspace-shared'), 'design-studio');
}
/** @description A short stable hash of the owner sub for the directory name (the sub itself is never a path). */
function subHash(sub) { return (0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 16); }
/** @description The directory of one product's set: <root>/<sha(sub)>/<projectId>. */
function setDir(root, sub, projectId) {
    const id = String(projectId).toLowerCase();
    if (!UUID.test(id))
        throw new RangeError('Expected a project id');
    return node_path_1.default.join(root, subHash(sub), id);
}
const readJson = (file) => { try {
    return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
}
catch {
    return null;
} };
const writeJson = (file, value) => { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); node_fs_1.default.writeFileSync(file, bytes); return bytes; };
/** @description The set state of a product, or null when none was begun. */
function readState(dir) {
    const s = readJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.state));
    return s && s.schema === print_set_model_1.SET_SCHEMA ? s : null;
}
/**
 * @description Begin a product's set: the directory is wiped and the design's rows are kept.
 * @param dir - The set directory. @param project - The project id and name. @param input - The validated rows.
 * @returns The state as written.
 */
function beginSet(dir, project, input) {
    node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const state = { schema: print_set_model_1.SET_SCHEMA, project: project.id, name: project.name, begunAt: new Date().toISOString(), ...input, results: {} };
    writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.state), state);
    return state;
}
/** The begun set, or a refusal that names what to do. */
function openSet(dir) {
    const state = readState(dir);
    if (!state)
        throw new phase_model_1.ModelError('no print set has been begun for this product: POST /print-set first', 'no_print_set', 'print-set', 409);
    if (node_fs_1.default.existsSync(node_path_1.default.join(dir, print_set_model_1.SET_FILES.manifest)))
        throw new phase_model_1.ModelError('this print set is finished; begin a new one to change it', 'print_set_finished', 'print-set', 409);
    return state;
}
/** @description The extents of a report as x × y × z, one decimal. */
function extentsOf(report) {
    const e = report.extentsMm;
    return e ? e.max.map((v, i) => Math.round((v - e.min[i]) * 10) / 10) : null;
}
/**
 * @description Keep one exported part: the bytes are parsed back and checked watertight first; a mesh that fails is
 * recorded unprintable with the fault and its bytes are dropped (never a silent skip, never a bad file in the set).
 * @param dir - The set directory. @param id - The validated part id. @param stl - The file bytes.
 * @param source - Where it came from. @param report - The kernel's report as read.
 * @returns The part's result as recorded.
 */
function addPart(dir, id, stl, source, report) {
    const state = openSet(dir);
    if (!state.parts.some((p) => p.id === id))
        throw new phase_model_1.ModelError(`${id} is not a part of this set; begin the set with every part`, 'part_not_in_set', 'partId', 409);
    let result;
    if (!report.valid)
        result = { status: 'unprintable', reason: 'CAD Studio\'s kernel reports the solid as not valid' };
    else {
        let check;
        try {
            check = (0, print_set_mesh_1.meshCheck)((0, print_set_mesh_1.parseStl)(stl));
        }
        catch (error) {
            check = null;
            result = { status: 'unprintable', reason: error instanceof RangeError ? error.message : 'the file is not an STL' };
        }
        if (check && !check.watertight)
            result = { status: 'unprintable', reason: (0, print_set_mesh_1.meshFault)(check) };
        else if (check) {
            const file = (0, print_set_model_1.fileFor)(id);
            node_fs_1.default.writeFileSync(node_path_1.default.join(dir, file), stl);
            result = { status: 'exported', file, sha256: (0, print_set_mesh_1.sha256Hex)(stl), bytes: stl.length, triangles: check.triangles, kernelMassEachG: report.massG === null ? null : Math.round(report.massG * 100) / 100, volumeCm3: report.volumeMm3 === null ? null : Math.round(report.volumeMm3 / 10) / 100, extentsMm: extentsOf(report), densityGcm3: report.densityGcm3, source, report };
        }
    }
    state.results[id] = result;
    writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.state), state);
    return result;
}
/**
 * @description Record a part as unprintable with the reason the caller states (no program, not built, the engine refused).
 * @param dir - The set directory. @param id - The validated part id. @param reason - Why.
 * @returns The result as recorded.
 */
function markUnprintable(dir, id, reason) {
    const state = openSet(dir);
    if (!state.parts.some((p) => p.id === id))
        throw new phase_model_1.ModelError(`${id} is not a part of this set; begin the set with every part`, 'part_not_in_set', 'partId', 409);
    const file = node_path_1.default.join(dir, (0, print_set_model_1.fileFor)(id));
    if (node_fs_1.default.existsSync(file))
        node_fs_1.default.rmSync(file, { force: true });
    const result = { status: 'unprintable', reason };
    state.results[id] = result;
    writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.state), state);
    return result;
}
/**
 * @description Finish the set: refused while a part with a program has neither a file nor a reason; then the sheet, the BOM
 * and the manifest are written and digested.
 * @param dir - The set directory.
 * @returns The manifest and its sha256.
 */
function finishSet(dir) {
    const state = openSet(dir);
    const missing = state.parts.filter((p) => p.program && !state.results[p.id]).map((p) => p.id);
    if (missing.length)
        throw new phase_model_1.ModelError(`every part needs a file or a reason before the set is finished; missing: ${missing.join(', ')}`, 'set_incomplete', 'parts', 409);
    for (const p of state.parts)
        if (!state.results[p.id])
            state.results[p.id] = { status: 'unprintable', reason: 'no CAD program in the design for this part' };
    const finishedAt = new Date().toISOString();
    const sheet = Buffer.from((0, print_set_model_1.printSheet)(state, finishedAt));
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, print_set_model_1.SET_FILES.sheet), sheet);
    const bom = Buffer.from((0, print_set_model_1.bomCsv)(state));
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, print_set_model_1.SET_FILES.bom), bom);
    const manifest = (0, print_set_model_1.manifestOf)(state, finishedAt, { sheet: { sha256: (0, print_set_mesh_1.sha256Hex)(sheet), bytes: sheet.length }, bom: { sha256: (0, print_set_mesh_1.sha256Hex)(bom), bytes: bom.length } });
    const bytes = writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.manifest), manifest);
    writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.state), state);
    return { manifest, manifestSha256: (0, print_set_mesh_1.sha256Hex)(bytes) };
}
/** @description The finished manifest of a set, with its file's sha256, or null. */
function readManifest(dir) {
    const file = node_path_1.default.join(dir, print_set_model_1.SET_FILES.manifest);
    if (!node_fs_1.default.existsSync(file))
        return null;
    const bytes = node_fs_1.default.readFileSync(file);
    try {
        return { manifest: JSON.parse(bytes.toString('utf8')), manifestSha256: (0, print_set_mesh_1.sha256Hex)(bytes) };
    }
    catch {
        return null;
    }
}
/** @description The hand-offs recorded beside a set. */
function readSent(dir) { return readJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.sent)) ?? []; }
/** @description Append one hand-off. */
function recordSent(dir, record) {
    const all = [...readSent(dir), record].slice(-200);
    writeJson(node_path_1.default.join(dir, print_set_model_1.SET_FILES.sent), all);
    return all;
}
/** @description The names a finished set serves: its STL files, the sheet, the BOM and the manifest. */
function servedFiles(manifest) {
    const files = Array.isArray(manifest.files) ? manifest.files.map((f) => String(f.file ?? '')) : [];
    return new Set([...files, print_set_model_1.SET_FILES.manifest].filter(Boolean));
}
/**
 * @description The listing a page reads: the finished manifest (with its sha) or the state of a set in progress, and the hand-offs.
 * @param dir - The set directory.
 * @returns The listing, or null when nothing was ever begun.
 */
function listing(dir) {
    const state = readState(dir);
    if (!state)
        return null;
    const done = readManifest(dir);
    const { exported, unprintable } = (0, print_set_model_1.rowsOf)(state);
    const base = { project: state.project, name: state.name, engine: state.engine, designRevision: state.designRevision, designRoute: state.designRoute, begunAt: state.begunAt, parts: state.parts.length, exported: exported.length, unprintable: unprintable.map((r) => ({ id: r.id, name: r.name, reason: r.reason })), sent: readSent(dir), files: { sheet: print_set_model_1.SET_FILES.sheet, bom: print_set_model_1.SET_FILES.bom, manifest: print_set_model_1.SET_FILES.manifest } };
    if (!done)
        return { ...base, finished: false, manifest: null, manifestSha256: null, pending: state.parts.filter((p) => !state.results[p.id]).map((p) => p.id) };
    return { ...base, finished: true, finishedAt: done.manifest.finishedAt, manifest: done.manifest, manifestSha256: done.manifestSha256, pending: [] };
}
//# sourceMappingURL=print-set-store.js.map