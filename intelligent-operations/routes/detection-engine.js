"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSTALL_HINT = void 0;
exports.detectionEngine = detectionEngine;
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | A caller can give the exchange a shorter deadline than the relay's 55 s: the processing tick has to answer inside the kernel's 60 s (processing-tick.ts). */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A hello carrying error is the engine's own busy signal ({"error":"engine-busy"} from engine/server.py when its four slots are taken, relayed unchanged by the kernel as {hello:{error},reply:null}); it is answered as the transient 503 "The detection engine is busy; retry shortly." without installHint. Before this it fell into the "does not match this package build" refusal and told the operator to reinstall an engine that was merely busy; only a hello whose protocol, engine or buildHash disagree with identity.json gets the install hint. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A down or stale engine is refused with the install command, per BUILDING-EXTENSIONS.md section 7 and scripts/check-engine-container-pattern.mjs: INSTALL_HINT names engine/install-engine.sh, and a relay that cannot reach the engine or a hello whose identity digest differs throws a 503 carrying it as installHint and in the message the surface renders; a kernel deadline or a busy engine is reported as such without it, because the installer would not fix either. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the package engine identity and complete typed percolation replies through OSHAL's admitted relay. */
// @ts-nocheck
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const intake_1 = require("./intake");
const topology_model_1 = require("./topology-model");
/** The exact command that installs or rebuilds the engine; <listen-port> is the loopback port OSHAL_PACKAGE_ENGINES pins for intelligent-operations (default 37420). */
exports.INSTALL_HINT = 'on the kernel host run: sh intelligent-operations/engine/install-engine.sh <listen-port>';
/** Refuse a down or stale engine with the reason and the install command: a 503 whose message the surface renders verbatim and whose installHint the route answers beside the error. */
function refuse(reason) { throw Object.assign(Error(reason + ' Install or rebuild it: ' + exports.INSTALL_HINT + '.'), { status: 503, installHint: exports.INSTALL_HINT }); }
/** One request through the kernel relay; its failure says whether the engine is down (install it), slow (the deadline) or busy (retry). */
async function exchange(ctx, request, timeoutMs) {
    try {
        return await ctx.intent('engine.exchange', { request, timeoutMs });
    }
    catch (error) {
        const detail = String(error?.message || error).slice(0, 80);
        if (/deadline/i.test(detail))
            (0, topology_model_1.fail)(503, 'The detection engine did not answer within the request deadline.');
        if (/busy/i.test(detail))
            (0, topology_model_1.fail)(503, 'The detection engine is busy; retry shortly.');
        refuse('The detection engine is not reachable: ' + detail + '.');
    }
}
function detectionEngine(ctx, timeoutMs = 55000) {
    const expected = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(ctx.appPackageDir, 'engine/identity.json'), 'utf8'));
    return async (cmd, owner, args = {}) => {
        if (!(0, topology_model_1.clean)(owner))
            (0, topology_model_1.fail)(401, 'A verified caller is required.');
        if (typeof ctx.intent !== 'function')
            (0, topology_model_1.fail)(503, 'The authorized detection engine relay is unavailable.');
        const response = await exchange(ctx, { cmd, args: { ...args, scope: (0, intake_1.hash)(['detection-owner-v1', owner]) } }, timeoutMs);
        const hello = response?.hello;
        // A hello carrying error is the engine's own busy signal (its slots are taken; the kernel relays it with reply null): retry, never reinstall.
        if (hello?.error !== undefined)
            (0, topology_model_1.fail)(503, 'The detection engine is busy; retry shortly.');
        if (!hello || hello.protocol !== expected.protocol || hello.engine !== expected.engine || hello.buildHash !== expected.buildHash)
            refuse('The installed detection engine does not match this package build.');
        if (response.reply?.error)
            (0, topology_model_1.fail)(503, response.reply.error.message || 'Detection could not complete.');
        if (!response.reply?.result)
            (0, topology_model_1.fail)(503, 'Detection returned no complete result.');
        return { ...response.reply.result, engineBuild: hello.buildHash };
    };
}
