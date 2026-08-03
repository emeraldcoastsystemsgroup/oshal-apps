"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — marine slice W1: types for a
 *                     |                             | tidal/current-harvesting persistent node. Models the
 *                     |                             | site (harmonic constituents), the harvester, the load
 *                     |                             | set and the store, so "is it perpetual?" becomes a
 *                     |                             | simulated verdict instead of an average-power hand-wave.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Extracted the harvest-agnostic half (PowerLoad, StorageConfig,
 *                     |                             | the sample and verdict shapes) to @/shared/energy. What is
 *                     |                             | left here is what is genuinely tidal — harmonics and a rotor
 *                     |                             | — plus the two marine widenings (currentMs, siteName) that
 *                     |                             | keep this slice's public API byte-compatible.
 */
Object.defineProperty(exports, "__esModule", { value: true });
