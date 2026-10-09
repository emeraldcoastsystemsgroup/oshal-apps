"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the vehicle record's public surface: the explorer
 *                     |                             | kind with its limit rows and design vector, the committed seed,
 *                     |                             | the stage function and the run fingerprints.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3: the parts model and its CAD Studio part programs,
 *                     |                             | the mass properties, the D8 portable-object shape, the
 *                     |                             | displacement budget with the explorer's parts gate, and the
 *                     |                             | generated design document.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashEngineTree = exports.displayabilityProblems = exports.VERSION = exports.SHA256_HEX = exports.RUN_RESULT_SCHEMA = exports.explorerDesignMarkdown = exports.describeProgram = exports.explorerPartsGate = exports.displacementBudget = exports.radiusAt = exports.explorerBoughtCatalog = exports.buildExplorerParts = exports.EXPLORER_PARTS_ENGINE = exports.CAD_STUDIO_MAX_DIMENSION_MM = exports.portableObjectProblems = exports.PROVENANCE_SOURCES = exports.PORTABLE_OBJECT_SCHEMA = exports.PORTABLE_OBJECT_KEYS = exports.CAD_STUDIO_WORLD_FRAME = exports.revolveVolumeMm3 = exports.revolveShellMassProperties = exports.polygonMoments = exports.loftVolumeAboveMm3 = exports.loftMassProperties = exports.cylinderMassProperties = exports.wingStations = exports.wingProgram = exports.tetherProgram = exports.subProfile = exports.subBodyProgram = exports.spindleBladeProgram = exports.rudderProgram = exports.foilSection = exports.floatProgram = exports.floatProfile = exports.SECTION_STATIONS = exports.EXPLORER_DRAWINGS = exports.stageOf = exports.designVectorFingerprint = exports.STAGES = exports.FABRICABLE_SENTENCE = exports.EVALUATION_PLANT = exports.validateExplorerVector = exports.nacaSpec = exports.evaluateExplorer = exports.deriveWaveVehicle = exports.assertKindDeclared = exports.NOT_MODELLED = exports.MODELLED_STOP_FLOOR_DEG = exports.EXPLORER_KIND = void 0;
exports.routesEngineBuildHash = exports.readPackageVersion = void 0;
exports.explorerSeed = explorerSeed;
const explorer_seed_json_1 = __importDefault(require("./explorer-seed.json"));
var explorer_kind_1 = require("./explorer-kind");
Object.defineProperty(exports, "EXPLORER_KIND", { enumerable: true, get: function () { return explorer_kind_1.EXPLORER_KIND; } });
Object.defineProperty(exports, "MODELLED_STOP_FLOOR_DEG", { enumerable: true, get: function () { return explorer_kind_1.MODELLED_STOP_FLOOR_DEG; } });
Object.defineProperty(exports, "NOT_MODELLED", { enumerable: true, get: function () { return explorer_kind_1.NOT_MODELLED; } });
Object.defineProperty(exports, "assertKindDeclared", { enumerable: true, get: function () { return explorer_kind_1.assertKindDeclared; } });
Object.defineProperty(exports, "deriveWaveVehicle", { enumerable: true, get: function () { return explorer_kind_1.deriveWaveVehicle; } });
Object.defineProperty(exports, "evaluateExplorer", { enumerable: true, get: function () { return explorer_kind_1.evaluateExplorer; } });
Object.defineProperty(exports, "nacaSpec", { enumerable: true, get: function () { return explorer_kind_1.nacaSpec; } });
Object.defineProperty(exports, "validateExplorerVector", { enumerable: true, get: function () { return explorer_kind_1.validateExplorerVector; } });
var stage_1 = require("./stage");
Object.defineProperty(exports, "EVALUATION_PLANT", { enumerable: true, get: function () { return stage_1.EVALUATION_PLANT; } });
Object.defineProperty(exports, "FABRICABLE_SENTENCE", { enumerable: true, get: function () { return stage_1.FABRICABLE_SENTENCE; } });
Object.defineProperty(exports, "STAGES", { enumerable: true, get: function () { return stage_1.STAGES; } });
Object.defineProperty(exports, "designVectorFingerprint", { enumerable: true, get: function () { return stage_1.designVectorFingerprint; } });
Object.defineProperty(exports, "stageOf", { enumerable: true, get: function () { return stage_1.stageOf; } });
var explorer_part_programs_1 = require("./explorer-part-programs");
Object.defineProperty(exports, "EXPLORER_DRAWINGS", { enumerable: true, get: function () { return explorer_part_programs_1.EXPLORER_DRAWINGS; } });
Object.defineProperty(exports, "SECTION_STATIONS", { enumerable: true, get: function () { return explorer_part_programs_1.SECTION_STATIONS; } });
Object.defineProperty(exports, "floatProfile", { enumerable: true, get: function () { return explorer_part_programs_1.floatProfile; } });
Object.defineProperty(exports, "floatProgram", { enumerable: true, get: function () { return explorer_part_programs_1.floatProgram; } });
Object.defineProperty(exports, "foilSection", { enumerable: true, get: function () { return explorer_part_programs_1.foilSection; } });
Object.defineProperty(exports, "rudderProgram", { enumerable: true, get: function () { return explorer_part_programs_1.rudderProgram; } });
Object.defineProperty(exports, "spindleBladeProgram", { enumerable: true, get: function () { return explorer_part_programs_1.spindleBladeProgram; } });
Object.defineProperty(exports, "subBodyProgram", { enumerable: true, get: function () { return explorer_part_programs_1.subBodyProgram; } });
Object.defineProperty(exports, "subProfile", { enumerable: true, get: function () { return explorer_part_programs_1.subProfile; } });
Object.defineProperty(exports, "tetherProgram", { enumerable: true, get: function () { return explorer_part_programs_1.tetherProgram; } });
Object.defineProperty(exports, "wingProgram", { enumerable: true, get: function () { return explorer_part_programs_1.wingProgram; } });
Object.defineProperty(exports, "wingStations", { enumerable: true, get: function () { return explorer_part_programs_1.wingStations; } });
var mass_properties_1 = require("./mass-properties");
Object.defineProperty(exports, "cylinderMassProperties", { enumerable: true, get: function () { return mass_properties_1.cylinderMassProperties; } });
Object.defineProperty(exports, "loftMassProperties", { enumerable: true, get: function () { return mass_properties_1.loftMassProperties; } });
Object.defineProperty(exports, "loftVolumeAboveMm3", { enumerable: true, get: function () { return mass_properties_1.loftVolumeAboveMm3; } });
Object.defineProperty(exports, "polygonMoments", { enumerable: true, get: function () { return mass_properties_1.polygonMoments; } });
Object.defineProperty(exports, "revolveShellMassProperties", { enumerable: true, get: function () { return mass_properties_1.revolveShellMassProperties; } });
Object.defineProperty(exports, "revolveVolumeMm3", { enumerable: true, get: function () { return mass_properties_1.revolveVolumeMm3; } });
var portable_object_1 = require("./portable-object");
Object.defineProperty(exports, "CAD_STUDIO_WORLD_FRAME", { enumerable: true, get: function () { return portable_object_1.CAD_STUDIO_WORLD_FRAME; } });
Object.defineProperty(exports, "PORTABLE_OBJECT_KEYS", { enumerable: true, get: function () { return portable_object_1.PORTABLE_OBJECT_KEYS; } });
Object.defineProperty(exports, "PORTABLE_OBJECT_SCHEMA", { enumerable: true, get: function () { return portable_object_1.PORTABLE_OBJECT_SCHEMA; } });
Object.defineProperty(exports, "PROVENANCE_SOURCES", { enumerable: true, get: function () { return portable_object_1.PROVENANCE_SOURCES; } });
Object.defineProperty(exports, "portableObjectProblems", { enumerable: true, get: function () { return portable_object_1.portableObjectProblems; } });
var explorer_parts_1 = require("./explorer-parts");
Object.defineProperty(exports, "CAD_STUDIO_MAX_DIMENSION_MM", { enumerable: true, get: function () { return explorer_parts_1.CAD_STUDIO_MAX_DIMENSION_MM; } });
Object.defineProperty(exports, "EXPLORER_PARTS_ENGINE", { enumerable: true, get: function () { return explorer_parts_1.EXPLORER_PARTS_ENGINE; } });
Object.defineProperty(exports, "buildExplorerParts", { enumerable: true, get: function () { return explorer_parts_1.buildExplorerParts; } });
Object.defineProperty(exports, "explorerBoughtCatalog", { enumerable: true, get: function () { return explorer_parts_1.explorerBoughtCatalog; } });
Object.defineProperty(exports, "radiusAt", { enumerable: true, get: function () { return explorer_parts_1.radiusAt; } });
var displacement_budget_1 = require("./displacement-budget");
Object.defineProperty(exports, "displacementBudget", { enumerable: true, get: function () { return displacement_budget_1.displacementBudget; } });
Object.defineProperty(exports, "explorerPartsGate", { enumerable: true, get: function () { return displacement_budget_1.explorerPartsGate; } });
var explorer_design_markdown_1 = require("./explorer-design-markdown");
Object.defineProperty(exports, "describeProgram", { enumerable: true, get: function () { return explorer_design_markdown_1.describeProgram; } });
Object.defineProperty(exports, "explorerDesignMarkdown", { enumerable: true, get: function () { return explorer_design_markdown_1.explorerDesignMarkdown; } });
var run_fingerprint_1 = require("./run-fingerprint");
Object.defineProperty(exports, "RUN_RESULT_SCHEMA", { enumerable: true, get: function () { return run_fingerprint_1.RUN_RESULT_SCHEMA; } });
Object.defineProperty(exports, "SHA256_HEX", { enumerable: true, get: function () { return run_fingerprint_1.SHA256_HEX; } });
Object.defineProperty(exports, "VERSION", { enumerable: true, get: function () { return run_fingerprint_1.VERSION; } });
Object.defineProperty(exports, "displayabilityProblems", { enumerable: true, get: function () { return run_fingerprint_1.displayabilityProblems; } });
Object.defineProperty(exports, "hashEngineTree", { enumerable: true, get: function () { return run_fingerprint_1.hashEngineTree; } });
Object.defineProperty(exports, "readPackageVersion", { enumerable: true, get: function () { return run_fingerprint_1.readPackageVersion; } });
Object.defineProperty(exports, "routesEngineBuildHash", { enumerable: true, get: function () { return run_fingerprint_1.routesEngineBuildHash; } });
/** @description The seed, exactly as committed. Callers get a deep copy so no request can mutate the fixture. @returns The seed. */
function explorerSeed() {
    return JSON.parse(JSON.stringify(explorer_seed_json_1.default));
}
