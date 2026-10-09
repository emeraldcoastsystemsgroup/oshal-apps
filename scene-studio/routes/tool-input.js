"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — the closed input of each of the 22
 *                     |                             | in-process package tools, in manifest order: the keys a tool
 *                     |                             | accepts, which are required, each key's type, and the godot-mcp or
 *                     |                             | Blender Lab MCP tool it drives. Anything else is refused before a
 *                     |                             | query or an engine request — including identity (userSub,
 *                     |                             | tenantId) and the arguments the engine sets itself (projectPath,
 *                     |                             | blend_file). Values are read with the same readers the routes use
 *                     |                             | (requireUuid, requireRevision, intOption, optionalString).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCENE_TOOL_SPECS = void 0;
exports.readToolInput = readToolInput;
const data_dir_1 = require("./data-dir");
const project_service_1 = require("./project-service");
const project_view_1 = require("./project-view");
const tool_result_1 = require("./tool-result");
const UUID = { type: 'uuid' };
const TEXT = { type: 'string' };
const FLAG = { type: 'boolean' };
const NAMES = { type: 'strings' };
const PROPERTIES = { type: 'object' };
const REVISION = { type: 'revision' };
const INSTANCE = { type: 'object', keys: ['scenePath', 'nodeName', 'parentNodePath'] };
const int = (min, max) => ({ type: 'integer', min, max });
const godot = (tool) => ({ server: 'godot', tool });
const blender = (tool) => ({ server: 'blender', tool });
function spec(name, fields, required = [], target) {
    return Object.freeze({
        name, keys: Object.freeze(Object.keys(fields)), required: Object.freeze([...required]), fields: Object.freeze({ ...fields }),
        ...(target ? { target: Object.freeze({ ...target }) } : {}),
    });
}
/** @description The 22 tools in manifest order (oshal-app.yaml `tools:`; contract-tools.test.js keeps them equal). */
exports.SCENE_TOOL_SPECS = Object.freeze([
    spec('scene-capabilities', {}),
    spec('scene-list-projects', {}),
    spec('scene-get-project', { projectId: UUID }, ['projectId']),
    spec('scene-create-project', { title: TEXT, kind: TEXT, template: TEXT }, ['title', 'kind']),
    spec('scene-read-file', { projectId: UUID, path: TEXT }, ['projectId', 'path']),
    spec('scene-write-file', { projectId: UUID, path: TEXT, text: TEXT }, ['projectId', 'path', 'text']),
    spec('scene-delete-file', { projectId: UUID, path: TEXT }, ['projectId', 'path']),
    spec('godot-create-scene', { projectId: UUID, scenePath: TEXT, rootNodeType: TEXT }, ['projectId', 'scenePath'], godot('create_scene')),
    spec('godot-add-node', { projectId: UUID, scenePath: TEXT, parentNodePath: TEXT, nodeType: TEXT, nodeName: TEXT, properties: PROPERTIES }, ['projectId', 'scenePath', 'nodeType', 'nodeName'], godot('add_node')),
    spec('godot-save-scene', { projectId: UUID, scenePath: TEXT, newPath: TEXT }, ['projectId', 'scenePath'], godot('save_scene')),
    spec('godot-load-sprite', { projectId: UUID, scenePath: TEXT, nodePath: TEXT, texturePath: TEXT }, ['projectId', 'scenePath', 'nodePath', 'texturePath'], godot('load_sprite')),
    spec('godot-export-mesh-library', { projectId: UUID, scenePath: TEXT, outputPath: TEXT, meshItemNames: NAMES }, ['projectId', 'scenePath', 'outputPath'], godot('export_mesh_library')),
    spec('godot-get-uid', { projectId: UUID, filePath: TEXT }, ['projectId', 'filePath'], godot('get_uid')),
    spec('godot-project-info', { projectId: UUID }, ['projectId'], godot('get_project_info')),
    spec('godot-run-project', { projectId: UUID, seconds: int(1, 30), scene: TEXT }, ['projectId']),
    spec('blender-run-python', { projectId: UUID, code: TEXT, save: FLAG, file: TEXT }, ['projectId', 'code'], blender('execute_blender_code_for_cli')),
    spec('blender-file-summary', { projectId: UUID, file: TEXT }, ['projectId'], blender('get_blendfile_summary_datablocks_for_cli')),
    spec('blender-docs', { tool: TEXT, query: TEXT, identifier: TEXT, max_results: int(1, 100) }, ['tool']),
    spec('scene-render-preview', { projectId: UUID, scene: TEXT, width: int(64, 1920), height: int(64, 1080), samples: int(1, 256) }, ['projectId']),
    spec('scene-export', { projectId: UUID, format: TEXT }, ['projectId']),
    spec('scene-import-model', { projectId: UUID, fromProjectId: UUID, name: TEXT, instance: INSTANCE }, ['projectId', 'fromProjectId', 'name']),
    spec('scene-restore-revision', { projectId: UUID, revision: REVISION }, ['projectId', 'revision']),
]);
function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function invalid(spec, detail) {
    return new tool_result_1.ToolFailure('invalid_tool_input', 400, `invalid_tool_input: ${spec.name} ${detail}`);
}
function readObject(spec, key, keys, value) {
    if (!isPlainObject(value))
        throw new project_service_1.RequestError(`${key} must be an object`, key);
    if (!keys)
        return { ...value };
    const extra = Object.keys(value).filter((name) => !keys.includes(name));
    if (extra.length)
        throw invalid(spec, `${key} accepts only ${keys.join(', ')}; got ${extra.join(', ')}`);
    const out = {};
    for (const name of keys) {
        const text = (0, project_view_1.optionalString)(value[name], `${key}.${name}`);
        if (text !== undefined)
            out[name] = text;
    }
    return out;
}
function readString(key, value, required) {
    if (!required)
        return (0, project_view_1.optionalString)(value, key);
    if (typeof value !== 'string')
        throw new project_service_1.RequestError(`${key} must be a string`, key);
    return value;
}
function readField(spec, key, value) {
    if (value === undefined || value === null)
        return undefined;
    const field = spec.fields[key];
    switch (field.type) {
        case 'uuid': return (0, data_dir_1.requireUuid)(value);
        case 'revision': return (0, data_dir_1.requireRevision)(value);
        case 'integer': return (0, project_view_1.intOption)(value, key, field.min, field.max);
        case 'string': return readString(key, value, spec.required.includes(key));
        case 'boolean':
            if (typeof value !== 'boolean')
                throw new project_service_1.RequestError(`${key} must be true or false`, key);
            return value;
        case 'strings':
            if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
                throw new project_service_1.RequestError(`${key} must be a list of strings`, key);
            return [...value];
        case 'object': return readObject(spec, key, field.keys, value);
    }
}
/**
 * @description Read one tool call's input against its closed spec. The input must be a plain object
 * (absent means `{}`); an unknown key — identity, an engine-owned argument or a typo — and a missing
 * required key are refused as invalid_tool_input, and each value is read with the route's own reader
 * (a bad UUID is invalid_id, a wrong type invalid_request with its field).
 * @param spec - The tool's spec from SCENE_TOOL_SPECS.
 * @param input - The tool input as the kernel hands it over.
 * @returns Only the keys that were given, typed. @throws ToolFailure | RequestError | RangeError
 */
function readToolInput(spec, input) {
    const given = input ?? {};
    if (!isPlainObject(given))
        throw invalid(spec, 'takes a JSON object');
    const extra = Object.keys(given).filter((key) => !spec.keys.includes(key));
    if (extra.length)
        throw invalid(spec, `${spec.keys.length ? `accepts only ${spec.keys.join(', ')}` : 'accepts no input'}; got ${extra.join(', ')}`);
    const missing = spec.required.filter((key) => given[key] === undefined || given[key] === null);
    if (missing.length)
        throw invalid(spec, `requires ${spec.required.join(', ')}; missing ${missing.join(', ')}`);
    const out = {};
    for (const key of spec.keys) {
        const value = readField(spec, key, given[key]);
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
//# sourceMappingURL=tool-input.js.map