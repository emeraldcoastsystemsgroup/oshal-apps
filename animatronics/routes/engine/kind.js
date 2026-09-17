"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the `prop` peripheral kind in the ADR-151 D1
 *                     |                             | shape (kind, safety class floor, closed senses and acts
 *                     |                             | vocabularies, confirm-exempt acts) and the capability manifest
 *                     |                             | a rig would enrol with. This package OWNS the vocabulary for
 *                     |                             | now; the fold-in target is embodied's
 *                     |                             | engine/nodes/capability-manifest.ts KIND_VOCABULARY, after its
 *                     |                             | open claim releases. A cross-package read-only test pins the
 *                     |                             | field set to embodied's CapabilityManifest so the seam cannot
 *                     |                             | drift while the two live apart.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | THE FOLD-IN LANDED. `embodied` now owns the `prop` row in its
 *                     |                             | KIND_VOCABULARY (ADR-156 D6, core BACKLOG 2026-09-14), so this
 *                     |                             | module stopped being a second DECLARATION and became the
 *                     |                             | package's BINDING to embodied's row: the senses, the acts, the
 *                     |                             | class floor and the confirm-exempt set are embodied's decision
 *                     |                             | and nothing here may choose differently. It is carried as data
 *                     |                             | rather than a `require` of the sibling package because store
 *                     |                             | packages install independently — animatronics runs on boxes
 *                     |                             | where `deployed-apps/embodied` does not exist, and a sibling
 *                     |                             | import would take the whole package down with
 *                     |                             | MODULE_NOT_FOUND. tests/engine-kind.test.js imports embodied's
 *                     |                             | real row and fails on ANY drift, which is what makes this a
 *                     |                             | pinned copy rather than a fork.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | THE COPY IS GONE — the row is now READ from embodied at run
 *                     |                             | time, which is what the core BACKLOG entry asked for and what
 *                     |                             | entry 2 stopped short of. A frozen literal that a test holds
 *                     |                             | equal to embodied's is still a second declaration of one
 *                     |                             | vocabulary: change embodied's row and this package went on
 *                     |                             | reporting the old one until someone noticed the test. Now
 *                     |                             | `loadPropVocabulary` resolves embodied's COMPILED
 *                     |                             | capability-manifest module beside this package and reads
 *                     |                             | `KIND_VOCABULARY.prop` and `CONFIRM_EXEMPT_ACTS` out of it, so
 *                     |                             | there is exactly one place the senses, the acts, the class
 *                     |                             | floor and the confirm rule are written down. The
 *                     |                             | MODULE_NOT_FOUND worry that motivated the copy is answered
 *                     |                             | without one: the resolve is a file check plus a guarded
 *                     |                             | require, and a box without embodied gets an HONEST refusal —
 *                     |                             | no vocabulary, no capability manifest, and `/capabilities`
 *                     |                             | saying which package owns the row — instead of a local
 *                     |                             | invention. Nothing else in the package depends on it: a rig,
 *                     |                             | its poses, the rehearsal, the supply budget and the Web Serial
 *                     |                             | stream all work with embodied absent.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KINETIC_STALL_KGCM = exports.EMBODIED_VOCABULARY_MODULE = exports.PROP_VOCABULARY_OWNER = exports.PROP_KIND = void 0;
exports.defaultPackagesRoot = defaultPackagesRoot;
exports.loadPropVocabulary = loadPropVocabulary;
exports.capabilityManifestFor = capabilityManifestFor;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** @description The kind name a rig enrols under. */
exports.PROP_KIND = 'prop';
/**
 * @description The package that OWNS the `prop` vocabulary. Named in the capabilities response and
 * in every refusal, so a reader of this API can see that the senses and acts below are not this
 * package's invention — they are one row of the swarm's peripheral vocabulary, and the place to
 * change them is there.
 */
exports.PROP_VOCABULARY_OWNER = 'embodied';
/** @description The owner's compiled vocabulary module, relative to the packages root. */
exports.EMBODIED_VOCABULARY_MODULE = 'routes/engine/nodes/capability-manifest.js';
/**
 * @description Where store packages sit beside each other — this package's parent directory. The
 * compiled module lives at `<package>/routes/engine/kind.js`, so the packages root is three up.
 * @returns The absolute packages root.
 */
function defaultPackagesRoot() {
    return node_path_1.default.resolve(__dirname, '..', '..', '..');
}
const bindings = new Map();
/**
 * @description Read embodied's compiled `prop` row. Fail-closed on every unhappy shape: a missing
 * package, a module that throws, a `KIND_VOCABULARY` without the row, a row missing its lists or
 * its class floor, or an owner module with no `CONFIRM_EXEMPT_ACTS` all refuse rather than
 * substitute a local guess — a vocabulary this package made up would be exactly the second
 * declaration this binding exists to remove.
 * @param packagesRoot - Where the packages are installed side by side (defaults to this package's parent).
 * @returns The binding, or the reason there is none.
 */
function readBinding(packagesRoot) {
    const file = node_path_1.default.join(packagesRoot, exports.PROP_VOCABULARY_OWNER, ...exports.EMBODIED_VOCABULARY_MODULE.split('/'));
    if (!node_fs_1.default.existsSync(file)) {
        return { ok: false, reason: `${exports.PROP_VOCABULARY_OWNER} is not installed beside this package, so the ${exports.PROP_KIND} vocabulary is unavailable`, module: file };
    }
    try {
        const owner = require(file);
        const row = owner.KIND_VOCABULARY ? owner.KIND_VOCABULARY[exports.PROP_KIND] : undefined;
        if (!row || !Array.isArray(row.senses) || !Array.isArray(row.acts) || typeof row.minSafetyClass !== 'number') {
            return { ok: false, reason: `${exports.PROP_VOCABULARY_OWNER} carries no usable KIND_VOCABULARY.${exports.PROP_KIND} row`, module: file };
        }
        const exempt = owner.CONFIRM_EXEMPT_ACTS;
        if (!(exempt instanceof Set)) {
            return { ok: false, reason: `${exports.PROP_VOCABULARY_OWNER} carries no CONFIRM_EXEMPT_ACTS set`, module: file };
        }
        return {
            ok: true,
            row: Object.freeze({ senses: Object.freeze([...row.senses]), acts: Object.freeze([...row.acts]), minSafetyClass: row.minSafetyClass }),
            confirmExempt: new Set(row.acts.filter((act) => exempt.has(act))),
            module: file,
        };
    }
    catch (error) {
        return { ok: false, reason: `${exports.PROP_VOCABULARY_OWNER}'s vocabulary module could not be read: ${error.message}`, module: file };
    }
}
/**
 * @description This package's binding to embodied's `prop` row. Successful bindings are cached
 * (the module is immutable once loaded); a refusal is NOT, so installing embodied later is picked
 * up without a restart.
 * @param packagesRoot - Where the packages are installed side by side (defaults to this package's parent).
 * @returns The binding, or the reason there is none.
 */
function loadPropVocabulary(packagesRoot) {
    const root = packagesRoot ?? defaultPackagesRoot();
    const cached = bindings.get(root);
    if (cached)
        return cached;
    const binding = readBinding(root);
    if (binding.ok)
        bindings.set(root, binding);
    return binding;
}
/** @description Stall torque at or above this many kg·cm makes the rig kinetic (class 2), not low-energy. */
exports.KINETIC_STALL_KGCM = 10;
/**
 * @description The capability manifest a rig would enrol with, built from the OWNER's row. This
 * package's own rail is stricter than the row's floor — it answers 428 to an unconfirmed `arm` at
 * every safety class, where the vocabulary only demands a confirm from class 2 up. A kind is a
 * minimum, never a ceiling.
 * @param nodeId - The rig's node id (short lowercase identifier).
 * @param rig - The rig.
 * @param stallKgCm - The strongest servo's stall torque, from the catalog (0 when unknown).
 * @param packagesRoot - Where the packages are installed side by side (defaults to this package's parent).
 * @returns The manifest, or null when the vocabulary's owner is not installed.
 */
function capabilityManifestFor(nodeId, rig, stallKgCm, packagesRoot) {
    const binding = loadPropVocabulary(packagesRoot);
    if (!binding.ok)
        return null;
    return {
        nodeId,
        kind: exports.PROP_KIND,
        model: `${rig.controller.board}/${rig.channels.length}ch`,
        safetyClass: stallKgCm >= exports.KINETIC_STALL_KGCM ? 2 : 1,
        senses: [...binding.row.senses],
        acts: [...binding.row.acts],
        envelope: {
            channels: rig.channels.length,
            maxDegPerS: rig.channels.reduce((m, c) => Math.max(m, c.maxDegPerS), 0),
            supplyVolts: rig.supply.volts,
            supplyAmps: rig.supply.amps,
            stallKgCm,
        },
    };
}
