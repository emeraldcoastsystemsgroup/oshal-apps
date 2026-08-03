"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the barrel. This slice sits in shared/ rather
 *                     |                             | than inside a design feature precisely so that a rotor slice and
 *                     |                             | a future hull or probe slice can both build on it without a
 *                     |                             | same-layer cross-import, which the layering rules forbid and
 *                     |                             | which is how two copies of a loft end up disagreeing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDxfR12 = exports.toDxfLayerName = exports.DXF_R12_VERSION = exports.toScadIdentifier = exports.toOpenScad = exports.formatScadValue = exports.toObj = exports.toStlBinary = exports.toStlAscii = exports.stlBinaryByteLength = exports.sanitizeSolidName = exports.STL_HEADER_BYTES = exports.STL_FACET_BYTES = exports.recomputeNormals = exports.meshVolume = exports.meshSurfaceArea = exports.meshDiagonal = exports.meshBounds = exports.flipWinding = exports.validateMesh = exports.triangulateRing = exports.ringNormal = exports.placeSection = exports.loftSections = exports.DEFAULT_WELD_EPSILON = exports.formatFloat = exports.formatFixed = exports.assertFinite = exports.DEFAULT_SIGNIFICANT_DIGITS = exports.DEFAULT_DECIMALS = exports.vecLength = exports.vec3 = exports.triangleNormal = exports.triangleCross = exports.triangleArea = exports.subVec = exports.scaleVec = exports.resolveTriangle = exports.normalizeVec = exports.dotVec = exports.crossVec = exports.addVec = exports.ZERO_VEC3 = void 0;
var vector_math_1 = require("./vector-math");
Object.defineProperty(exports, "ZERO_VEC3", { enumerable: true, get: function () { return vector_math_1.ZERO_VEC3; } });
Object.defineProperty(exports, "addVec", { enumerable: true, get: function () { return vector_math_1.addVec; } });
Object.defineProperty(exports, "crossVec", { enumerable: true, get: function () { return vector_math_1.crossVec; } });
Object.defineProperty(exports, "dotVec", { enumerable: true, get: function () { return vector_math_1.dotVec; } });
Object.defineProperty(exports, "normalizeVec", { enumerable: true, get: function () { return vector_math_1.normalizeVec; } });
Object.defineProperty(exports, "resolveTriangle", { enumerable: true, get: function () { return vector_math_1.resolveTriangle; } });
Object.defineProperty(exports, "scaleVec", { enumerable: true, get: function () { return vector_math_1.scaleVec; } });
Object.defineProperty(exports, "subVec", { enumerable: true, get: function () { return vector_math_1.subVec; } });
Object.defineProperty(exports, "triangleArea", { enumerable: true, get: function () { return vector_math_1.triangleArea; } });
Object.defineProperty(exports, "triangleCross", { enumerable: true, get: function () { return vector_math_1.triangleCross; } });
Object.defineProperty(exports, "triangleNormal", { enumerable: true, get: function () { return vector_math_1.triangleNormal; } });
Object.defineProperty(exports, "vec3", { enumerable: true, get: function () { return vector_math_1.vec3; } });
Object.defineProperty(exports, "vecLength", { enumerable: true, get: function () { return vector_math_1.vecLength; } });
var format_number_1 = require("./format-number");
Object.defineProperty(exports, "DEFAULT_DECIMALS", { enumerable: true, get: function () { return format_number_1.DEFAULT_DECIMALS; } });
Object.defineProperty(exports, "DEFAULT_SIGNIFICANT_DIGITS", { enumerable: true, get: function () { return format_number_1.DEFAULT_SIGNIFICANT_DIGITS; } });
Object.defineProperty(exports, "assertFinite", { enumerable: true, get: function () { return format_number_1.assertFinite; } });
Object.defineProperty(exports, "formatFixed", { enumerable: true, get: function () { return format_number_1.formatFixed; } });
Object.defineProperty(exports, "formatFloat", { enumerable: true, get: function () { return format_number_1.formatFloat; } });
var mesh_loft_1 = require("./mesh-loft");
Object.defineProperty(exports, "DEFAULT_WELD_EPSILON", { enumerable: true, get: function () { return mesh_loft_1.DEFAULT_WELD_EPSILON; } });
Object.defineProperty(exports, "loftSections", { enumerable: true, get: function () { return mesh_loft_1.loftSections; } });
Object.defineProperty(exports, "placeSection", { enumerable: true, get: function () { return mesh_loft_1.placeSection; } });
var polygon_triangulate_1 = require("./polygon-triangulate");
Object.defineProperty(exports, "ringNormal", { enumerable: true, get: function () { return polygon_triangulate_1.ringNormal; } });
Object.defineProperty(exports, "triangulateRing", { enumerable: true, get: function () { return polygon_triangulate_1.triangulateRing; } });
var mesh_validate_1 = require("./mesh-validate");
Object.defineProperty(exports, "validateMesh", { enumerable: true, get: function () { return mesh_validate_1.validateMesh; } });
var mesh_metrics_1 = require("./mesh-metrics");
Object.defineProperty(exports, "flipWinding", { enumerable: true, get: function () { return mesh_metrics_1.flipWinding; } });
Object.defineProperty(exports, "meshBounds", { enumerable: true, get: function () { return mesh_metrics_1.meshBounds; } });
Object.defineProperty(exports, "meshDiagonal", { enumerable: true, get: function () { return mesh_metrics_1.meshDiagonal; } });
Object.defineProperty(exports, "meshSurfaceArea", { enumerable: true, get: function () { return mesh_metrics_1.meshSurfaceArea; } });
Object.defineProperty(exports, "meshVolume", { enumerable: true, get: function () { return mesh_metrics_1.meshVolume; } });
Object.defineProperty(exports, "recomputeNormals", { enumerable: true, get: function () { return mesh_metrics_1.recomputeNormals; } });
var export_stl_1 = require("./export-stl");
Object.defineProperty(exports, "STL_FACET_BYTES", { enumerable: true, get: function () { return export_stl_1.STL_FACET_BYTES; } });
Object.defineProperty(exports, "STL_HEADER_BYTES", { enumerable: true, get: function () { return export_stl_1.STL_HEADER_BYTES; } });
Object.defineProperty(exports, "sanitizeSolidName", { enumerable: true, get: function () { return export_stl_1.sanitizeSolidName; } });
Object.defineProperty(exports, "stlBinaryByteLength", { enumerable: true, get: function () { return export_stl_1.stlBinaryByteLength; } });
Object.defineProperty(exports, "toStlAscii", { enumerable: true, get: function () { return export_stl_1.toStlAscii; } });
Object.defineProperty(exports, "toStlBinary", { enumerable: true, get: function () { return export_stl_1.toStlBinary; } });
var export_obj_1 = require("./export-obj");
Object.defineProperty(exports, "toObj", { enumerable: true, get: function () { return export_obj_1.toObj; } });
var export_openscad_1 = require("./export-openscad");
Object.defineProperty(exports, "formatScadValue", { enumerable: true, get: function () { return export_openscad_1.formatScadValue; } });
Object.defineProperty(exports, "toOpenScad", { enumerable: true, get: function () { return export_openscad_1.toOpenScad; } });
Object.defineProperty(exports, "toScadIdentifier", { enumerable: true, get: function () { return export_openscad_1.toScadIdentifier; } });
var export_dxf_1 = require("./export-dxf");
Object.defineProperty(exports, "DXF_R12_VERSION", { enumerable: true, get: function () { return export_dxf_1.DXF_R12_VERSION; } });
Object.defineProperty(exports, "toDxfLayerName", { enumerable: true, get: function () { return export_dxf_1.toDxfLayerName; } });
Object.defineProperty(exports, "toDxfR12", { enumerable: true, get: function () { return export_dxf_1.toDxfR12; } });
