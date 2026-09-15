"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the engine barrel. Everything under engine/
 *                     |                             | is pure TypeScript with no framework import, so the compiled
 *                     |                             | `routes/engine/index.js` loads under plain `node --test` and
 *                     |                             | under the running controller alike; the specs assert that.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Export the 0.5.0 modules: print checks (B13), perspective
 *                     |                             | re-projection (B2), range-image decoding (B1), frame
 *                     |                             | suggestion (B12) and the orientation-cube face markers (B9).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./geometry/geometry-types"), exports);
__exportStar(require("./geometry/vector-math"), exports);
__exportStar(require("./geometry/format-number"), exports);
__exportStar(require("./geometry/mesh-metrics"), exports);
__exportStar(require("./geometry/mesh-validate"), exports);
__exportStar(require("./geometry/export-stl"), exports);
__exportStar(require("./geometry/export-obj"), exports);
__exportStar(require("./raster/raster-types"), exports);
__exportStar(require("./raster/silhouette"), exports);
__exportStar(require("./raster/face-marker"), exports);
__exportStar(require("./grid/views"), exports);
__exportStar(require("./grid/occupancy-grid"), exports);
__exportStar(require("./grid/silhouette-carver"), exports);
__exportStar(require("./grid/depth-carver"), exports);
__exportStar(require("./grid/depth-reproject"), exports);
__exportStar(require("./grid/depth-decode"), exports);
__exportStar(require("./grid/frame-suggest"), exports);
__exportStar(require("./grid/point-cloud"), exports);
__exportStar(require("./grid/print-checks"), exports);
__exportStar(require("./mesh/surface-nets"), exports);
__exportStar(require("./drawing/contours"), exports);
__exportStar(require("./drawing/engineering-drawing"), exports);
__exportStar(require("./drawing/simplify"), exports);
__exportStar(require("./drawing/contour-export"), exports);
__exportStar(require("./print/printer-adapters"), exports);
__exportStar(require("./print/slicer"), exports);
__exportStar(require("./pipeline"), exports);
//# sourceMappingURL=index.js.map