"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the typed door to the breadboard model the
 *                     |                             | surface and the routes SHARE (tools/circuit-lab-board-model.js,
 *                     |                             | plain JS so one copy serves the browser and node): the board
 *                     |                             | shape, and the functions the routes call to lay a board out,
 *                     |                             | validate an edited one, derive wires from it and keep it in
 *                     |                             | step with every schematic change.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A placement may carry `rot` (a turned footprint, BACKLOG B2).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.boardModel = void 0;
exports.boardFailure = boardFailure;
const node_path_1 = __importDefault(require("node:path"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
exports.boardModel = require(node_path_1.default.join(__dirname, '..', 'tools', 'circuit-lab-board-model.js'));
/** @description A board validation failure carries the field it names. */
function boardFailure(error) {
    const e = error;
    return e && typeof e.field === 'string' ? { field: e.field, message: String(e.message) } : null;
}
