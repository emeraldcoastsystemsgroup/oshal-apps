"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the Betz-optimal blade generator and one
 *                     |                             | reference rotor sized to fit on a print bed. The generator is
 *                     |                             | the honest way to write "a sane twist distribution": rather
 *                     |                             | than a hand-typed table nobody can re-derive, every station's
 *                     |                             | chord and twist comes out of the same two closed-form optimum
 *                     |                             | relations, and the design angle of attack is read off the
 *                     |                             | section's OWN panelled lift line — so changing the aerofoil
 *                     |                             | re-pitches the blade automatically instead of leaving a stale
 *                     |                             | twist schedule attached to a section it no longer suits. The
 *                     |                             | 150 mm rotor is ILLUSTRATIVE: it is a printable test article
 *                     |                             | for the low-Reynolds study, not a recommended power source.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_TIP_RADIUS_M = exports.REFERENCE_DESIGN_LIFT_COEFFICIENT = exports.REFERENCE_DESIGN_TIP_SPEED_RATIO = exports.SEAWATER_DENSITY_KGM3 = void 0;
exports.betzOptimalBlade = betzOptimalBlade;
exports.scaleBlade = scaleBlade;
exports.referenceTidalRotor = referenceTidalRotor;
exports.referenceTidalFlow = referenceTidalFlow;
const logger_1 = require("@/shared/logger");
const section_polar_1 = require("./section-polar");
const log = (0, logger_1.createChildLogger)({ module: 'features/rotor-design/rotor-presets' });
/** @description Seawater density at coastal temperature and salinity, kg/m³. */
exports.SEAWATER_DENSITY_KGM3 = 1025;
/**
 * @description Round a thickness fraction to whole percent. Not cosmetic: the panel solve is
 * memoised on the exact section values, so quantising turns a 13-station blade from 13 distinct
 * dense factorisations into about 7, at a cost (half a percent of chord) far below the accuracy of
 * anything downstream.
 * @param thickness - Thickness fraction.
 * @returns The thickness rounded to the nearest 1 % of chord.
 */
function quantiseThickness(thickness) {
    return Math.round(thickness * 100) / 100;
}
/**
 * @description Build one Betz-optimal design station.
 *
 * Both relations are the classical optimum INCLUDING wake rotation:
 * `φ = ⅔ atan(1/λ_r)` and `c = 8πr(1 − cos φ)/(B · Cl_design)`. The twist then follows from
 * `β = φ − α_design`, and `α_design` is whatever angle the section's own lift line reaches
 * `Cl_design` at — which is why this generator does not need a table of design angles per
 * aerofoil.
 * @param radiusFrac - Radius as a fraction of tip radius.
 * @param options - Resolved generator options.
 * @returns The design station.
 */
function betzStation(radiusFrac, options) {
    const localSpeedRatio = options.designTipSpeedRatio * radiusFrac;
    const phi = (2 / 3) * Math.atan(1 / localSpeedRatio);
    const radiusM = radiusFrac * options.tipRadiusM;
    const chordM = (8 * Math.PI * radiusM * (1 - Math.cos(phi))) / (options.bladeCount * options.designLiftCoefficient);
    const spanFrac = (radiusFrac - options.hubRadiusFrac) / Math.max(1 - options.hubRadiusFrac, 1e-9);
    const section = {
        maxCamber: options.maxCamber,
        camberPos: options.camberPos,
        thickness: quantiseThickness(options.rootThickness + spanFrac * (options.tipThickness - options.rootThickness)),
    };
    const line = (0, section_polar_1.sectionLiftLine)(section);
    const designAlpha = line.zeroLiftAlphaRad + options.designLiftCoefficient / line.liftSlopePerRad;
    return { radiusFrac, chordM, twistDeg: ((phi - designAlpha) * 180) / Math.PI, section };
}
/**
 * @description Generate a Betz-optimal blade: the chord and twist schedule that maximises the
 * power extracted from each annulus at the design tip-speed ratio.
 *
 * The inboard chord flare is real, not a bug — the optimum genuinely wants a very wide root at low
 * local speed ratio, and production blades trade that away for structure and cost. Leaving it in
 * is what makes this blade the right article to test the Betz limit against: with drag removed and
 * a high blade count it should walk right up to 16/27 without ever crossing it, and a generator
 * that had quietly "tidied up" the root would leave a gap that looks like a physics result.
 * @param options - Design inputs. See {@link BetzBladeOptions}.
 * @returns A blade with `stationCount` stations from hub to tip and zero collective pitch.
 * @throws RangeError when the radius, blade count, design tip-speed ratio or station count is
 * not usable.
 */
function betzOptimalBlade(options) {
    const resolved = {
        hubRadiusFrac: 0.25,
        designLiftCoefficient: 1,
        stationCount: 13,
        maxCamber: 0.04,
        camberPos: 0.4,
        rootThickness: 0.18,
        tipThickness: 0.12,
        ...options,
    };
    if (!(resolved.tipRadiusM > 0))
        throw new RangeError(`Tip radius must be positive, got ${resolved.tipRadiusM}`);
    if (!(resolved.bladeCount >= 1))
        throw new RangeError(`Blade count must be >= 1, got ${resolved.bladeCount}`);
    if (!(resolved.designTipSpeedRatio > 0)) {
        throw new RangeError(`Design tip-speed ratio must be positive, got ${resolved.designTipSpeedRatio}`);
    }
    if (!(resolved.stationCount >= 2))
        throw new RangeError(`Need at least 2 stations, got ${resolved.stationCount}`);
    if (!(resolved.hubRadiusFrac > 0 && resolved.hubRadiusFrac < 1)) {
        throw new RangeError(`Hub radius fraction must be in (0,1), got ${resolved.hubRadiusFrac}`);
    }
    const stations = [];
    for (let i = 0; i < resolved.stationCount; i += 1) {
        const radiusFrac = resolved.hubRadiusFrac + ((1 - resolved.hubRadiusFrac) * i) / (resolved.stationCount - 1);
        stations.push(betzStation(radiusFrac, resolved));
    }
    log.debug({ tipRadiusM: resolved.tipRadiusM, bladeCount: resolved.bladeCount, lambda: resolved.designTipSpeedRatio }, 'generated a Betz-optimal blade');
    return {
        tipRadiusM: resolved.tipRadiusM,
        hubRadiusM: resolved.hubRadiusFrac * resolved.tipRadiusM,
        bladeCount: resolved.bladeCount,
        stations,
        pitchDeg: 0,
    };
}
/**
 * @description Geometrically scale a blade to a new tip radius, keeping every angle and every
 * length RATIO fixed.
 *
 * This is the instrument for the low-Reynolds experiment. Scaling changes nothing dimensionless
 * about the blade — same twist, same chord-to-radius, same solidity — so at a given tip-speed
 * ratio the inflow triangles are identical and classical (Reynolds-independent) BEMT would return
 * exactly the same Cp. Every difference the solver reports between two scales is therefore a pure
 * Reynolds effect, with nothing else to confound it.
 * @param blade - The blade to scale.
 * @param tipRadiusM - New tip radius, metres.
 * @returns A new blade; the input is not modified.
 * @throws RangeError when the new tip radius is not positive.
 */
function scaleBlade(blade, tipRadiusM) {
    if (!(tipRadiusM > 0))
        throw new RangeError(`Scaled tip radius must be positive, received ${tipRadiusM}`);
    const factor = tipRadiusM / blade.tipRadiusM;
    return {
        tipRadiusM,
        hubRadiusM: blade.hubRadiusM * factor,
        bladeCount: blade.bladeCount,
        pitchDeg: blade.pitchDeg,
        stations: blade.stations.map((station) => ({ ...station, chordM: station.chordM * factor })),
    };
}
/** @description Design tip-speed ratio of {@link referenceTidalRotor}. */
exports.REFERENCE_DESIGN_TIP_SPEED_RATIO = 5;
/**
 * @description Design lift coefficient of {@link referenceTidalRotor}. Deliberately modest: at the
 * Reynolds number a 150 mm blade actually runs at, {@link maxLiftCoefficient} is only about 0.95,
 * so a blade pitched for Cl = 1.0 — which is a perfectly ordinary utility-scale design point —
 * would be stalled at its OWN design tip-speed ratio. Carrying a utility design point down to a
 * printable size is the classic small-rotor mistake and this constant is where it gets refused.
 */
exports.REFERENCE_DESIGN_LIFT_COEFFICIENT = 0.7;
/** @description Tip radius of {@link referenceTidalRotor}, metres — 150 mm, i.e. it fits a print bed. */
exports.REFERENCE_TIP_RADIUS_M = 0.15;
/**
 * @description An ILLUSTRATIVE reference rotor: a 150 mm-radius, three-bladed, Betz-optimal tidal
 * rotor with a thick printable root, designed for λ = 5 at 1 m/s in seawater.
 *
 * It is a study article, not a recommendation. At this size the 75 %-span section runs at a
 * Reynolds number around 5×10⁴, where a 4-digit aerofoil is far outside what it was drawn for and
 * its L/D falls into the low twenties — so the rotor's peak Cp lands well below what the same
 * geometry reaches at utility scale. Demonstrating that gap is the reason this preset exists;
 * quoting its Cp as an achievable small-turbine figure would be misreading it exactly backwards.
 * @returns A fresh {@link BladeSpec} each call, so a caller can mutate it without surprising the next.
 */
function referenceTidalRotor() {
    return betzOptimalBlade({
        tipRadiusM: exports.REFERENCE_TIP_RADIUS_M,
        bladeCount: 3,
        designTipSpeedRatio: exports.REFERENCE_DESIGN_TIP_SPEED_RATIO,
        hubRadiusFrac: 0.25,
        designLiftCoefficient: exports.REFERENCE_DESIGN_LIFT_COEFFICIENT,
        stationCount: 13,
    });
}
/**
 * @description The design inflow for {@link referenceTidalRotor}: 1 m/s of seawater, with the
 * rotational speed set to the design tip-speed ratio.
 * @returns A fresh {@link FlowCondition}.
 */
function referenceTidalFlow() {
    return {
        freeStreamMs: 1,
        rotationRadS: (exports.REFERENCE_DESIGN_TIP_SPEED_RATIO * 1) / exports.REFERENCE_TIP_RADIUS_M,
        densityKgM3: exports.SEAWATER_DENSITY_KGM3,
        kinematicViscosityM2S: section_polar_1.SEAWATER_KINEMATIC_VISCOSITY_M2S,
    };
}
