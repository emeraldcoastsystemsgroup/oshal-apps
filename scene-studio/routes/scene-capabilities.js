"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — what Scene Studio can do right now,
 *                     |                             | shared by the `/capabilities` route and the scene-capabilities
 *                     |                             | package tool through ONE per-engine-build cache: the package
 *                     |                             | contract (allowlisted upstream tools, templates, export formats,
 *                     |                             | limits) plus the engine's versions and tool schemas, or — when
 *                     |                             | the engine is down or stale — capabilities null with the honest
 *                     |                             | reason and the exact install command. The cache moved here
 *                     |                             | verbatim from scene-studio-routes.ts; the answer is unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.capabilityCache = capabilityCache;
exports.describeCapabilities = describeCapabilities;
const logger_1 = require("@/shared/logger");
const engine_client_1 = require("./engine-client");
const project_files_1 = require("./project-files");
const tool_contract_1 = require("./tool-contract");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-capabilities' });
const CAPABILITIES_TTL_MS = 10 * 60 * 1000;
/**
 * @description The engine's own capabilities (versions + tool schemas), cached per engine build so a
 * rebuilt engine is asked again and an unchanged one is not asked on every read.
 * @param engine - The package's one engine client.
 * @returns A reader that answers from the cache or asks the engine.
 */
function capabilityCache(engine) {
    let cached = null;
    return async () => {
        const build = engine.status().buildHash;
        if (cached && cached.build === build && Date.now() - cached.at < CAPABILITIES_TTL_MS)
            return cached.value;
        const value = (await engine.request('capabilities', {}, 180_000));
        cached = { at: Date.now(), build: engine.status().buildHash, value };
        return value;
    };
}
/**
 * @description The full capabilities answer. It never throws: an engine that is down or stale is an
 * answer (capabilities null, the reason and the install command), not an error, because that is
 * exactly what the person and the director need to read.
 * @param engine - The package's engine client (its status rides along).
 * @param engineCaps - The cached engine reader from capabilityCache.
 * @returns The package contract with the engine's versions and tools, or the reason they are unavailable.
 */
async function describeCapabilities(engine, engineCaps) {
    const contract = {
        app: 'scene-studio', godotTools: tool_contract_1.GODOT_TOOLS, blenderTools: tool_contract_1.BLENDER_PROJECT_TOOLS, blenderDocTools: tool_contract_1.BLENDER_DOC_TOOLS,
        templates: tool_contract_1.TEMPLATES, exports: tool_contract_1.EXPORT_FORMATS, limits: project_files_1.FILE_LIMITS,
    };
    try {
        const caps = await engineCaps();
        return { ...contract, engine: engine.status(), capabilities: { versions: caps.versions, tools: caps.tools, sandbox: caps.sandbox }, reason: caps.toolsError ?? null };
    }
    catch (error) {
        const status = engine.status();
        const reason = error instanceof engine_client_1.EngineFailure ? error.reason || error.message : error.message;
        logger.warn({ reason }, 'Scene Studio engine capabilities unavailable');
        return { ...contract, engine: status, capabilities: null, reason, installHint: status.installHint };
    }
}
//# sourceMappingURL=scene-capabilities.js.map