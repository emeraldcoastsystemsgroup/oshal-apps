"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — BACKLOG B23: the contract for a scene that arrives from outside (the `spaces` package builds one from a ready scan and offers it as an ADR-139 artifact). Reads the `{scene, stats, scanId, title}` envelope, refuses it against the engine's own bounds (a room-sized extent, a ceiling, a volume the 5 cm voxel map can hold, a solid count the flight grid can carve) and then against `validateScene`, and keeps the accepted scenes PER OWNER as canonical JSON so every reset builds a fresh, mutable scene the way a built-in scenario's `build()` does. Every refusal names the rule it broke — a half-imported world is never registered.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportedSceneStore = exports.isImportedScenarioId = exports.scenarioIdForScan = exports.SceneImportError = exports.SCENE_LIMITS = exports.MAX_SCENES_PER_OWNER = exports.MAX_SCENE_BYTES = exports.IMPORTED_SCENARIO_PREFIX = exports.EMBODIED_SCENE_TYPE = void 0;
exports.readSceneArtifact = readSceneArtifact;
const scenes_1 = require("./scenes");
/** @description The MIME the `spaces` package publishes a scan-derived scene under (ADR-139 `provides`). */
exports.EMBODIED_SCENE_TYPE = 'application/vnd.oshal.embodied-scene+json';
/** @description Imported scenario ids are namespaced so they can never shadow a built-in. */
exports.IMPORTED_SCENARIO_PREFIX = 'scan:';
/** @description Biggest artifact this destination will redeem — a scene is boxes and numbers, not a splat. */
exports.MAX_SCENE_BYTES = 8 * 1024 * 1024;
/** @description How many imported scenes one owner may keep; the oldest is dropped when a new one arrives. */
exports.MAX_SCENES_PER_OWNER = 8;
/**
 * @description The engine's own bounds on a scene it did not write. The voxel map is 5 cm
 * (`VoxelMap`), so the volume cap is what one owner's map, its clone and the flight grid can hold
 * (400 m³ ≈ 3.2 M voxels a map); the spans and the ceiling are what "a room" means — the `spaces`
 * ceiling fit is for rooms, and a flat or hollow-thin capture is a refusal, not a world. The solid
 * cap is above the converter's own default box cap (1500) and below what the grid carve is sized for.
 */
exports.SCENE_LIMITS = {
    minSpanM: 1.5,
    maxSpanM: 20,
    minCeilingM: 1.6,
    maxCeilingM: 5,
    maxVolumeM3: 400,
    minSolids: 1,
    maxSolids: 2000,
};
/** @description A refusal that names the rule it broke, so the 4xx can say it out loud. */
class SceneImportError extends Error {
    rule;
    status;
    issues;
    constructor(rule, message, status = 422, issues = []) {
        super(message);
        this.rule = rule;
        this.status = status;
        this.issues = issues;
        this.name = 'SceneImportError';
    }
}
exports.SceneImportError = SceneImportError;
/** @description The scenario id a scan registers under. */
const scenarioIdForScan = (scanId) => `${exports.IMPORTED_SCENARIO_PREFIX}${scanId}`;
exports.scenarioIdForScan = scenarioIdForScan;
/** @description True for an id in the imported namespace (never a built-in). */
const isImportedScenarioId = (id) => id.startsWith(exports.IMPORTED_SCENARIO_PREFIX);
exports.isImportedScenarioId = isImportedScenarioId;
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
/**
 * @description Read the envelope the `spaces` converter publishes: `{scene, stats, scanId, title}`.
 * @param raw - The redeemed artifact bytes (or text).
 * @returns The envelope's parts, unvalidated beyond their shape.
 * @throws SceneImportError - `malformed_json` / `envelope` / `scan_id` when the bytes are not that envelope.
 */
function readEnvelope(raw) {
    let parsed;
    try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    }
    catch (error) {
        throw new SceneImportError('malformed_json', `the artifact is not JSON: ${error instanceof Error ? error.message : String(error)}`, 400);
    }
    if (!isRecord(parsed) || !isRecord(parsed.scene)) {
        throw new SceneImportError('envelope', 'an embodied scene artifact is {scene, stats, scanId, title} — no scene object was found', 400);
    }
    const scanId = typeof parsed.scanId === 'string' ? parsed.scanId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(scanId)) {
        throw new SceneImportError('scan_id', 'the artifact carries no usable scanId (letters, digits, - and _, 1–64 characters)', 400);
    }
    const title = (typeof parsed.title === 'string' ? parsed.title : '').trim().slice(0, 120) || `Scan ${scanId.slice(0, 8)}`;
    return { scene: parsed.scene, scanId, title, stats: isRecord(parsed.stats) ? parsed.stats : {} };
}
/**
 * @description Refuse a scene whose declared shape is not the `Scene` shape at all, before any geometry is trusted.
 * @param candidate - The envelope's `scene`.
 * @returns The same object, typed.
 * @throws SceneImportError - `scene_shape` naming the member that is wrong.
 */
function readSceneShape(candidate) {
    const room = candidate.room;
    if (!isRecord(room) || !['minX', 'maxX', 'minY', 'maxY', 'ceiling'].every((k) => isFiniteNumber(room[k]))) {
        throw new SceneImportError('scene_shape', 'scene.room must carry finite minX/maxX/minY/maxY/ceiling', 400);
    }
    for (const key of ['obstacles', 'surfaces', 'objects', 'zones', 'appliances']) {
        if (!Array.isArray(candidate[key]))
            throw new SceneImportError('scene_shape', `scene.${key} must be an array`, 400);
    }
    const park = candidate.basePark;
    if (!isRecord(park) || !isFiniteNumber(park.x) || !isFiniteNumber(park.y) || !isFiniteNumber(park.yaw)) {
        throw new SceneImportError('scene_shape', 'scene.basePark must carry finite x/y/yaw', 400);
    }
    const home = candidate.droneHome;
    if (!Array.isArray(home) || home.length !== 3 || !home.every(isFiniteNumber)) {
        throw new SceneImportError('scene_shape', 'scene.droneHome must be three finite numbers', 400);
    }
    return candidate;
}
/**
 * @description Hold the scene to the engine's own bounds: a room-sized extent, a ceiling, a volume
 * the 5 cm voxel map can hold, and a solid count between "there is something here" and what the grid carve is sized for.
 * @param scene - The shape-checked scene.
 * @throws SceneImportError - `extent` / `ceiling` / `volume` / `solids` naming the bound it broke.
 */
function enforceSceneLimits(scene) {
    const { minX, maxX, minY, maxY, ceiling } = scene.room;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const L = exports.SCENE_LIMITS;
    for (const [axis, span] of [['x', spanX], ['y', spanY]]) {
        if (!(span >= L.minSpanM))
            throw new SceneImportError('extent', `the capture is ${span.toFixed(2)} m across in ${axis} — a world needs at least ${L.minSpanM} m (an empty or flat scan)`);
        if (span > L.maxSpanM)
            throw new SceneImportError('extent', `the capture is ${span.toFixed(1)} m across in ${axis} — this engine maps rooms up to ${L.maxSpanM} m`);
    }
    if (!(ceiling >= L.minCeilingM))
        throw new SceneImportError('ceiling', `the ceiling fits at ${ceiling.toFixed(2)} m — below ${L.minCeilingM} m nothing can fly (pass scaleM for a non-metric capture)`);
    if (ceiling > L.maxCeilingM)
        throw new SceneImportError('ceiling', `the ceiling fits at ${ceiling.toFixed(1)} m — this engine maps rooms up to ${L.maxCeilingM} m`);
    const volume = spanX * spanY * ceiling;
    if (volume > L.maxVolumeM3)
        throw new SceneImportError('volume', `the capture is ${Math.round(volume)} m³ — the 5 cm voxel map holds up to ${L.maxVolumeM3} m³`);
    if (scene.obstacles.length < L.minSolids)
        throw new SceneImportError('solids', 'the capture carved no solids at all — nothing was seen (an empty scan)');
    if (scene.obstacles.length > L.maxSolids)
        throw new SceneImportError('solids', `the capture carved ${scene.obstacles.length} solids — this engine flies up to ${L.maxSolids} (lower maxBoxes on the converter)`);
}
/**
 * @description Read a redeemed scene artifact into a registrable scene: the envelope, the `Scene`
 * shape, the engine's bounds, then the scene rules every hidden scene keeps. The scene is renamed to
 * its scenario id so a world started from it reports the id the owner asked for.
 * @param raw - The redeemed artifact bytes.
 * @returns The scene with its id, scanId, title and the converter's stats.
 * @throws SceneImportError - Naming the rule it broke; nothing is registered on a throw.
 */
function readSceneArtifact(raw) {
    const { scene: candidate, scanId, title, stats } = readEnvelope(raw);
    const scene = readSceneShape(candidate);
    enforceSceneLimits(scene);
    const id = (0, exports.scenarioIdForScan)(scanId);
    scene.name = id;
    const issues = (0, scenes_1.validateScene)(scene);
    if (issues.length) {
        throw new SceneImportError('scene_rules', `the scene breaks ${issues.length} rule${issues.length === 1 ? '' : 's'} this world keeps: ${issues[0]}`, 422, issues);
    }
    return { id, scanId, title, stats, scene };
}
/**
 * @description The imported scenes one owner may reset a world onto. Scenes are kept as canonical
 * JSON and re-parsed on every read, so each reset gets a fresh mutable scene exactly as a built-in
 * scenario's `build()` does — a world can never mutate the registered copy.
 */
class ImportedSceneStore {
    bySub = new Map();
    /** @description Register an owner's imported scene, evicting that owner's oldest past the cap. @returns Its scenario id. */
    put(sub, imported) {
        let mine = this.bySub.get(sub);
        if (!mine) {
            mine = new Map();
            this.bySub.set(sub, mine);
        }
        mine.delete(imported.id);
        mine.set(imported.id, {
            json: JSON.stringify(imported.scene), title: imported.title, scanId: imported.scanId, stats: imported.stats,
            importedAt: new Date().toISOString(), solids: imported.scene.obstacles.length, room: imported.scene.room,
            surfaces: imported.scene.surfaces.length, objects: imported.scene.objects.length, appliances: imported.scene.appliances.length,
        });
        while (mine.size > exports.MAX_SCENES_PER_OWNER) {
            const oldest = mine.keys().next().value;
            if (oldest === undefined)
                break;
            mine.delete(oldest);
        }
        return imported.id;
    }
    /** @description A fresh, mutable copy of an owner's imported scene, or null when that owner has no such id. */
    get(sub, id) {
        const row = this.bySub.get(sub)?.get(id);
        return row ? JSON.parse(row.json) : null;
    }
    /** @description An owner's imported scenes as `/capabilities.scenarios` lists them, newest last. */
    list(sub) {
        const mine = this.bySub.get(sub);
        if (!mine)
            return [];
        return [...mine.entries()].map(([id, row]) => ({
            id, name: row.title, room: row.room, surfaces: row.surfaces, objects: row.objects, appliances: row.appliances,
            source: 'scan', scanId: row.scanId, solids: row.solids, importedAt: row.importedAt,
        }));
    }
    /** @description Forget one of an owner's imported scenes. @returns True when it was there. */
    remove(sub, id) {
        return this.bySub.get(sub)?.delete(id) ?? false;
    }
}
exports.ImportedSceneStore = ImportedSceneStore;
//# sourceMappingURL=imported-scenes.js.map