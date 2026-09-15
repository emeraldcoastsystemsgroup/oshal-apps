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
 */

import type { RigSpec } from './rig-contract';

/** @description The kind name a rig enrols under. */
export const PROP_KIND = 'prop';

/**
 * @description The package that OWNS the `prop` vocabulary. Named in the capabilities response so
 * a reader of this API can see that the senses and acts below are not this package's invention —
 * they are one row of the swarm's peripheral vocabulary, and the place to change them is there.
 */
export const PROP_VOCABULARY_OWNER = 'embodied';

/**
 * @description `embodied`'s `KIND_VOCABULARY.prop`, pinned here as data.
 *
 * WHY A COPY AND NOT AN IMPORT: store packages install one at a time into `deployed-apps/`, so a
 * `require('../../embodied/...')` resolves only where embodied happens to be installed and throws
 * MODULE_NOT_FOUND everywhere else — it would make an animatronic rig unusable without a robotics
 * package. The copy is safe because it cannot drift: `tests/engine-kind.test.js` imports
 * embodied's real row and refuses any difference, in either direction.
 *
 * Change it THERE, never here.
 */
export const PROP_VOCABULARY = Object.freeze({
  senses: Object.freeze(['channel-state', 'controller-hello', 'supply']),
  acts: Object.freeze(['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm', 'e-stop']),
  minSafetyClass: 1 as const,
});

/**
 * @description The acts a prop can take that never wait for a confirm — embodied's
 * `CONFIRM_EXEMPT_ACTS` narrowed to this kind's vocabulary. `disarm` is in it for the same reason
 * `e-stop` is: it REMOVES authority, and an act that removes authority must not be able to be
 * blocked by a dialog. This package's own rail is STRICTER than the kind's floor — it answers 428
 * to an unconfirmed `arm` at every safety class, where the vocabulary only demands a confirm from
 * class 2 up. A kind is a minimum, never a ceiling.
 */
export const PROP_CONFIRM_EXEMPT: ReadonlySet<string> = new Set(['e-stop', 'disarm']);

/** @description The manifest shape — embodied's `CapabilityManifest`, narrowed to kind `prop`. */
export interface PropCapabilityManifest {
  nodeId: string;
  kind: typeof PROP_KIND;
  model: string;
  safetyClass: 1 | 2;
  senses: string[];
  acts: string[];
  envelope: Record<string, number>;
}

/** @description Stall torque at or above this many kg·cm makes the rig kinetic (class 2), not low-energy. */
export const KINETIC_STALL_KGCM = 10;

/**
 * @description The capability manifest a rig would enrol with.
 * @param nodeId - The rig's node id (short lowercase identifier).
 * @param rig - The rig.
 * @param stallKgCm - The strongest servo's stall torque, from the catalog (0 when unknown).
 * @returns The manifest.
 */
export function capabilityManifestFor(nodeId: string, rig: RigSpec, stallKgCm: number): PropCapabilityManifest {
  return {
    nodeId,
    kind: PROP_KIND,
    model: `${rig.controller.board}/${rig.channels.length}ch`,
    safetyClass: stallKgCm >= KINETIC_STALL_KGCM ? 2 : 1,
    senses: [...PROP_VOCABULARY.senses],
    acts: [...PROP_VOCABULARY.acts],
    envelope: {
      channels: rig.channels.length,
      maxDegPerS: rig.channels.reduce((m, c) => Math.max(m, c.maxDegPerS), 0),
      supplyVolts: rig.supply.volts,
      supplyAmps: rig.supply.amps,
      stallKgCm,
    },
  };
}
