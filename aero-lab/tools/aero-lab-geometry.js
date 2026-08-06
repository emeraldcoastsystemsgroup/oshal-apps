/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- testable
 *                     |                             | browser-side design readouts aligned with
 *                     |                             | engine/service.py, including the server's
 *                     |                             | 79.9 m span ceiling. The UMD wrapper keeps
 *                     |                             | one shipped implementation usable by both
 *                     |                             | the classic browser script and Node parity
 *                     |                             | regression tests.
 */
'use strict';

(function exposeAeroLabGeometry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.AERO_LAB_GEOMETRY = api;
}(typeof globalThis === 'object' ? globalThis : this, function makeAeroLabGeometry() {
  /**
   * The server deliberately keeps generated wings below its 80 m structural
   * envelope even when sqrt(AR * S) reaches farther at the corner of the input
   * box. This is display geometry only; the engine remains performance authority.
   */
  const MAX_SPAN_M = 79.9;

  /**
   * @description Derive the three input-only values displayed above the cockpit.
   * The formula and names mirror `engine/service.py::_design_readouts`; the
   * cross-runtime regression executes both implementations over the same vectors.
   * Invalid partial input returns NaN readouts so the UI renders em-dashes.
   * @param {object} design - Current design-vector draft.
   * @returns {{span_m:number, mean_chord_m:number, pack_Wh:number}}
   */
  function deriveDesignReadouts(design) {
    const areaM2 = Number(design && design.area_m2);
    const aspectRatio = Number(design && design.aspect_ratio);
    const batteryMassKg = Number(design && design.battery_mass_kg);
    const packWhPerKg = Number(design && design.pack_Wh_per_kg);
    const rawSpanM = Math.sqrt(aspectRatio * areaM2);
    const spanM = Number.isFinite(rawSpanM) && rawSpanM > 0
      ? Math.min(rawSpanM, MAX_SPAN_M)
      : NaN;
    return {
      span_m: spanM,
      mean_chord_m: spanM > 0 && Number.isFinite(areaM2) ? areaM2 / spanM : NaN,
      pack_Wh: Number.isFinite(batteryMassKg) && Number.isFinite(packWhPerKg)
        ? batteryMassKg * packWhPerKg
        : NaN,
    };
  }

  return Object.freeze({ MAX_SPAN_M, deriveDesignReadouts });
}));
