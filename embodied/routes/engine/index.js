"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the engine barrel. Everything the routes and
 *                     |                             | the tests need, and nothing that imports a framework module:
 *                     |                             | the engine is plain TypeScript so it runs under bare node.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Export the sensing and world layers: sense/raycast, world/voxel-map, world/discover, world/world-model, world/explore.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Export sense/register (scan-to-map registration).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Export drone/sensor-set.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Export the design module (propulsion sizing, airframe programs, parts model, design markdown).
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | The designer lives in engine/design: a directory named build/ is ignored by the store repository and never reached the box.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B20: the node rail — the fleet and the rail node.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | B4: export the scenario registry.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm (ADR-152 D5 task 3): the servo catalogue and drive sizing, the arm's parts, its design and document, and its MuJoCo model.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1: the medium record and its three implementations, and the explorer hull as one solid.
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
__exportStar(require("./math/vec"), exports);
__exportStar(require("./math/transform"), exports);
__exportStar(require("./arm/arm-model"), exports);
__exportStar(require("./arm/inverse-kinematics"), exports);
__exportStar(require("./base/diff-drive"), exports);
__exportStar(require("./base/stability"), exports);
__exportStar(require("./drone/quad-model"), exports);
__exportStar(require("./drone/camera-model"), exports);
__exportStar(require("./drone/sensor-set"), exports);
__exportStar(require("./design/propulsion"), exports);
__exportStar(require("./design/airframe"), exports);
__exportStar(require("./design/parts-model"), exports);
__exportStar(require("./design/design-markdown"), exports);
__exportStar(require("./design/servos"), exports);
__exportStar(require("./design/arm-parts"), exports);
__exportStar(require("./design/arm-design"), exports);
__exportStar(require("./design/arm-markdown"), exports);
__exportStar(require("./medium/medium"), exports);
__exportStar(require("./physics/mjcf"), exports);
__exportStar(require("./physics/hull-mjcf"), exports);
__exportStar(require("./physics/arm-mjcf"), exports);
__exportStar(require("./physics/arm-room-mjcf"), exports);
__exportStar(require("./physics/arm-plant"), exports);
__exportStar(require("./physics/bridge-client"), exports);
__exportStar(require("./physics/plant"), exports);
__exportStar(require("./physics/build-hash"), exports);
__exportStar(require("./physics/certify"), exports);
__exportStar(require("./node/node-fleet"), exports);
__exportStar(require("./node/rail-node"), exports);
__exportStar(require("./world/scene"), exports);
__exportStar(require("./world/scenes"), exports);
__exportStar(require("./world/imported-scenes"), exports);
__exportStar(require("./world/occupancy-grid"), exports);
__exportStar(require("./sense/raycast"), exports);
__exportStar(require("./sense/register"), exports);
__exportStar(require("./world/voxel-map"), exports);
__exportStar(require("./world/discover"), exports);
__exportStar(require("./world/world-model"), exports);
__exportStar(require("./world/explore"), exports);
__exportStar(require("./nodes/capability-manifest"), exports);
__exportStar(require("./sim/world-sim"), exports);
__exportStar(require("./plan/skill-planner"), exports);
__exportStar(require("./plan/plan-executor"), exports);
__exportStar(require("./plan/plan-validator"), exports);
__exportStar(require("./control/control-authority"), exports);
//# sourceMappingURL=index.js.map