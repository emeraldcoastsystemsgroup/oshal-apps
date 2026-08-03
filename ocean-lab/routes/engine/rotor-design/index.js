"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rotor-design barrel. Blade geometry,
 *                     |                             | section aerodynamics and BEMT are ONE slice: BEMT cannot be
 *                     |                             | evaluated without a section polar and a section polar has no
 *                     |                             | consumer without BEMT, so splitting them would need a
 *                     |                             | same-layer cross-import, which the layering rules forbid. All
 *                     |                             | the meshing and CAD export lives in @/shared/geometry, one
 *                     |                             | layer down, where a hull or a probe can reuse it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scaleBlade = exports.referenceTidalRotor = exports.referenceTidalFlow = exports.betzOptimalBlade = exports.SEAWATER_DENSITY_KGM3 = exports.REFERENCE_TIP_RADIUS_M = exports.REFERENCE_DESIGN_TIP_SPEED_RATIO = exports.REFERENCE_DESIGN_LIFT_COEFFICIENT = exports.bladeToMesh = exports.PITCH_AXIS_CHORD_FRACTION = exports.solveBemt = exports.prandtlTipLoss = exports.prandtlHubLoss = exports.cpCurve = exports.axialInduction = exports.BETZ_LIMIT = exports.skinFrictionCoefficient = exports.sectionReynolds = exports.sectionPolar = exports.sectionLiftLine = exports.maxLiftCoefficient = exports.estimateSectionDrag = exports.SEAWATER_KINEMATIC_VISCOSITY_M2S = exports.NOMINAL_ASPECT_RATIO = exports.viternaExtend = exports.viternaDragMax = exports.panelSolveCl = exports.panelLiftLine = exports.liftLineCl = exports.sectionRingLength = exports.nacaThickness = exports.nacaSection = exports.nacaCamber = exports.cosineStations = exports.DEFAULT_SECTION_STATIONS = void 0;
var naca_section_1 = require("./services/naca-section");
Object.defineProperty(exports, "DEFAULT_SECTION_STATIONS", { enumerable: true, get: function () { return naca_section_1.DEFAULT_SECTION_STATIONS; } });
Object.defineProperty(exports, "cosineStations", { enumerable: true, get: function () { return naca_section_1.cosineStations; } });
Object.defineProperty(exports, "nacaCamber", { enumerable: true, get: function () { return naca_section_1.nacaCamber; } });
Object.defineProperty(exports, "nacaSection", { enumerable: true, get: function () { return naca_section_1.nacaSection; } });
Object.defineProperty(exports, "nacaThickness", { enumerable: true, get: function () { return naca_section_1.nacaThickness; } });
Object.defineProperty(exports, "sectionRingLength", { enumerable: true, get: function () { return naca_section_1.sectionRingLength; } });
var panel_method_1 = require("./services/panel-method");
Object.defineProperty(exports, "liftLineCl", { enumerable: true, get: function () { return panel_method_1.liftLineCl; } });
Object.defineProperty(exports, "panelLiftLine", { enumerable: true, get: function () { return panel_method_1.panelLiftLine; } });
Object.defineProperty(exports, "panelSolveCl", { enumerable: true, get: function () { return panel_method_1.panelSolveCl; } });
var viterna_1 = require("./services/viterna");
Object.defineProperty(exports, "viternaDragMax", { enumerable: true, get: function () { return viterna_1.viternaDragMax; } });
Object.defineProperty(exports, "viternaExtend", { enumerable: true, get: function () { return viterna_1.viternaExtend; } });
var section_polar_1 = require("./services/section-polar");
Object.defineProperty(exports, "NOMINAL_ASPECT_RATIO", { enumerable: true, get: function () { return section_polar_1.NOMINAL_ASPECT_RATIO; } });
Object.defineProperty(exports, "SEAWATER_KINEMATIC_VISCOSITY_M2S", { enumerable: true, get: function () { return section_polar_1.SEAWATER_KINEMATIC_VISCOSITY_M2S; } });
Object.defineProperty(exports, "estimateSectionDrag", { enumerable: true, get: function () { return section_polar_1.estimateSectionDrag; } });
Object.defineProperty(exports, "maxLiftCoefficient", { enumerable: true, get: function () { return section_polar_1.maxLiftCoefficient; } });
Object.defineProperty(exports, "sectionLiftLine", { enumerable: true, get: function () { return section_polar_1.sectionLiftLine; } });
Object.defineProperty(exports, "sectionPolar", { enumerable: true, get: function () { return section_polar_1.sectionPolar; } });
Object.defineProperty(exports, "sectionReynolds", { enumerable: true, get: function () { return section_polar_1.sectionReynolds; } });
Object.defineProperty(exports, "skinFrictionCoefficient", { enumerable: true, get: function () { return section_polar_1.skinFrictionCoefficient; } });
var bemt_solver_1 = require("./services/bemt-solver");
Object.defineProperty(exports, "BETZ_LIMIT", { enumerable: true, get: function () { return bemt_solver_1.BETZ_LIMIT; } });
Object.defineProperty(exports, "axialInduction", { enumerable: true, get: function () { return bemt_solver_1.axialInduction; } });
Object.defineProperty(exports, "cpCurve", { enumerable: true, get: function () { return bemt_solver_1.cpCurve; } });
Object.defineProperty(exports, "prandtlHubLoss", { enumerable: true, get: function () { return bemt_solver_1.prandtlHubLoss; } });
Object.defineProperty(exports, "prandtlTipLoss", { enumerable: true, get: function () { return bemt_solver_1.prandtlTipLoss; } });
Object.defineProperty(exports, "solveBemt", { enumerable: true, get: function () { return bemt_solver_1.solveBemt; } });
var blade_mesh_1 = require("./services/blade-mesh");
Object.defineProperty(exports, "PITCH_AXIS_CHORD_FRACTION", { enumerable: true, get: function () { return blade_mesh_1.PITCH_AXIS_CHORD_FRACTION; } });
Object.defineProperty(exports, "bladeToMesh", { enumerable: true, get: function () { return blade_mesh_1.bladeToMesh; } });
var rotor_presets_1 = require("./services/rotor-presets");
Object.defineProperty(exports, "REFERENCE_DESIGN_LIFT_COEFFICIENT", { enumerable: true, get: function () { return rotor_presets_1.REFERENCE_DESIGN_LIFT_COEFFICIENT; } });
Object.defineProperty(exports, "REFERENCE_DESIGN_TIP_SPEED_RATIO", { enumerable: true, get: function () { return rotor_presets_1.REFERENCE_DESIGN_TIP_SPEED_RATIO; } });
Object.defineProperty(exports, "REFERENCE_TIP_RADIUS_M", { enumerable: true, get: function () { return rotor_presets_1.REFERENCE_TIP_RADIUS_M; } });
Object.defineProperty(exports, "SEAWATER_DENSITY_KGM3", { enumerable: true, get: function () { return rotor_presets_1.SEAWATER_DENSITY_KGM3; } });
Object.defineProperty(exports, "betzOptimalBlade", { enumerable: true, get: function () { return rotor_presets_1.betzOptimalBlade; } });
Object.defineProperty(exports, "referenceTidalFlow", { enumerable: true, get: function () { return rotor_presets_1.referenceTidalFlow; } });
Object.defineProperty(exports, "referenceTidalRotor", { enumerable: true, get: function () { return rotor_presets_1.referenceTidalRotor; } });
Object.defineProperty(exports, "scaleBlade", { enumerable: true, get: function () { return rotor_presets_1.scaleBlade; } });
