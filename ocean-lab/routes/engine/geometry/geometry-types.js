"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the domain-free geometry vocabulary. It lives
 *                     |                             | in shared/ rather than in a rotor feature because a hull, a
 *                     |                             | probe body and a rotor blade are the SAME lofted-solid problem;
 *                     |                             | putting the mesh vocabulary in one slice is what stops a second
 *                     |                             | domain from reaching sideways into the first one. Nothing here
 *                     |                             | knows what a chord or a twist is — the caller places sections,
 *                     |                             | this slice only knows points, triangles and topology.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cap options no longer say "fan" — the loft ear-clips them now —
 *                     |                             | and {@link MeshValidation.valid} says what it does NOT cover:
 *                     |                             | every check behind it is topological, so it cannot see two
 *                     |                             | facets overlapping in space.
 */
Object.defineProperty(exports, "__esModule", { value: true });
