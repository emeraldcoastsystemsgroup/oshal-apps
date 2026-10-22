"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectionEngine = detectionEngine;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the package engine identity and complete typed percolation replies through OSHAL's admitted relay. */
// @ts-nocheck
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const intake_1 = require("./intake");
const topology_model_1 = require("./topology-model");
function detectionEngine(ctx) {
    const expected = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(ctx.appPackageDir, 'engine/identity.json'), 'utf8'));
    return async (cmd, owner, args = {}) => {
        if (!(0, topology_model_1.clean)(owner))
            (0, topology_model_1.fail)(401, 'A verified caller is required.');
        if (typeof ctx.intent !== 'function')
            (0, topology_model_1.fail)(503, 'The authorized detection engine relay is unavailable.');
        const response = await ctx.intent('engine.exchange', { request: { cmd, args: { ...args, scope: (0, intake_1.hash)(['detection-owner-v1', owner]) } }, timeoutMs: 55000 });
        const hello = response?.hello;
        if (!hello || hello.protocol !== expected.protocol || hello.engine !== expected.engine || hello.buildHash !== expected.buildHash)
            (0, topology_model_1.fail)(503, 'The installed detection engine does not match this package build.');
        if (response.reply?.error)
            (0, topology_model_1.fail)(503, response.reply.error.message || 'Detection could not complete.');
        if (!response.reply?.result)
            (0, topology_model_1.fail)(503, 'Detection returned no complete result.');
        return { ...response.reply.result, engineBuild: hello.buildHash };
    };
}
