"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.objectOperation = objectOperation;
exports.objectRequest = objectRequest;
exports.objectBody = objectBody;
exports.lowerObjectRequest = lowerObjectRequest;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Closed object requests and trusted engine lowering; no caller Python or metadata.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const project_files_1 = require("./project-files");
const invalid = (message) => { throw new project_files_1.FileError(message, 'body', 400); };
const closed = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
        return invalid('Unknown object operation fields');
    return value;
};
function objectOperation(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 8192)
        return invalid('operationJson must contain one bounded JSON operation');
    let operation;
    try {
        operation = JSON.parse(value);
    }
    catch {
        return invalid('operationJson must be valid JSON');
    }
    if (operation?.kind === 'keyframe') {
        closed(operation, ['kind', 'channel']);
        if (!['location', 'rotation', 'scale'].includes(String(operation.channel)))
            return invalid('Unsupported keyframe channel');
        return operation;
    }
    closed(operation, ['kind', 'property', 'value']);
    if (operation.kind !== 'set-property' || typeof operation.property !== 'string' || !Object.hasOwn(operation, 'value'))
        return invalid('Use set-property with property and value');
    const key = operation.property, v = operation.value;
    if (/^(location|rotation|scale):[012]$/.test(key) || ['lightEnergy', 'lens', 'orthoScale'].includes(key)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9 || (key === 'lightEnergy' && v < 0) || (key === 'lens' && v < 1) || (key === 'orthoScale' && v < .001))
            return invalid('Invalid native numeric property');
    }
    else if (key === 'visible') {
        if (typeof v !== 'boolean')
            return invalid('Visibility must be boolean');
    }
    else if (key === 'text') {
        if (typeof v !== 'string' || Buffer.byteLength(v) >= 2000 || v.includes('\0'))
            return invalid('Text must contain fewer than 2000 UTF-8 bytes and no NUL');
    }
    else if (key === 'color') {
        if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))
            return invalid('Color must be #rrggbb');
    }
    else
        return invalid('Unsupported native object property');
    return operation;
}
function objectRequest(op, input) {
    const b = closed(input, op === 'object_patch' ? ['files', 'objectName', 'frame', 'operationJson'] : ['files', 'objectName', 'offset', 'frame']);
    const patch = op === 'object_patch';
    if (!patch && op !== 'object_inspect')
        return invalid('Unsupported typed object operation');
    if (patch || b.objectName !== undefined)
        if (typeof b.objectName !== 'string' || !b.objectName || Buffer.byteLength(b.objectName) > 200 || b.objectName.includes('\0'))
            return invalid('objectName must identify one bounded native object');
    if ((patch || b.frame !== undefined) && (!Number.isInteger(b.frame) || Number(b.frame) < 1 || Number(b.frame) > 1000000))
        return invalid('frame must be between 1 and 1000000');
    if (b.offset !== undefined && (!Number.isInteger(b.offset) || Number(b.offset) < 0 || Number(b.offset) > 1000000))
        return invalid('Invalid object page');
    if (patch)
        objectOperation(b.operationJson);
    return b;
}
function objectBody(patch, input) {
    const b = closed(input, patch ? ['expectedRevision', 'objectName', 'frame', 'operationJson'] : ['expectedRevision', 'objectName', 'offset', 'frame']);
    if (!Number.isSafeInteger(b.expectedRevision) || Number(b.expectedRevision) < 1)
        return invalid('expectedRevision must be a positive integer');
    const { expectedRevision, ...fields } = b;
    objectRequest(patch ? 'object_patch' : 'object_inspect', fields);
    return { expectedRevision: Number(expectedRevision), fields };
}
function lowerObjectRequest(op, input) {
    const b = objectRequest(op, input), patch = op === 'object_patch';
    const args = { mode: patch ? 'patch' : 'inspect', objectName: b.objectName ?? null, offset: b.offset ?? 0, frame: b.frame ?? null, ...(patch ? { operation: objectOperation(b.operationJson) } : {}) };
    const source = node_fs_1.default.readFileSync(node_path_1.default.join(__dirname, '../tools/blender-object-operations.py'), 'utf8');
    const code = source + '\nresult = _oshal_object_operation(json.loads(' + JSON.stringify(JSON.stringify(args)) + '))\n';
    return { op: 'mcp_call', fields: { server: 'blender', tool: 'execute_blender_code_for_cli', arguments: { code }, files: b.files, save: patch, timeoutSec: 30 } };
}
//# sourceMappingURL=object-operations.js.map