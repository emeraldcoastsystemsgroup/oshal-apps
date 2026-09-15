"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The engine barrel: transports and the link budget, the
 *                     |                             | corridor, the chain planner, the on-board policy, the relay
 *                     |                             | envelope, the simulation and the design write-up. Pure Node
 *                     |                             | (no framework import) so the store CI runs every engine
 *                     |                             | suite against the compiled modules with no install.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The proxy queue and the relay role (B11): what a relay
 *                     |                             | holds for a node it cannot reach, and the role that
 *                     |                             | forwards, answers by proxy and releases on the route alone.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Trees (B5): the tree's elastic rule and its simulation.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The formation as a Drone Ops fleet-mission draft (B6, B4).
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Lattices (B9): the area's tiling, the assignment rule, the run.
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
__exportStar(require("./spec-error"), exports);
__exportStar(require("./transports"), exports);
__exportStar(require("./path"), exports);
__exportStar(require("./chain"), exports);
__exportStar(require("./node-policy"), exports);
__exportStar(require("./envelope"), exports);
__exportStar(require("./relay-sim"), exports);
__exportStar(require("./design-doc"), exports);
__exportStar(require("./proxy-queue"), exports);
__exportStar(require("./relay-role"), exports);
__exportStar(require("./tree-rules"), exports);
__exportStar(require("./tree-sim"), exports);
__exportStar(require("./fleet-draft"), exports);
__exportStar(require("./lattice"), exports);
__exportStar(require("./lattice-sim"), exports);
//# sourceMappingURL=index.js.map