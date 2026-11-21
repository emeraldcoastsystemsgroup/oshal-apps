"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the slicing step (STL → G-code) as a
 *                     |                             | configured command, never a vendor literal: the operator sets
 *                     |                             | SCAN_TO_PRINT_SLICER_CMD to whatever slicer CLI the box has
 *                     |                             | (PrusaSlicer, OrcaSlicer, CuraEngine …) with `{input}` and
 *                     |                             | `{output}` placeholders, and the package runs it with
 *                     |                             | execFile — argv, no shell — so a file name can never become a
 *                     |                             | command. Unconfigured is a first-class state the routes report
 *                     |                             | ("upload the STL and slice on the printer host") rather than a
 *                     |                             | silent fallback to some default program.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B16 Option C: resolve slicer backend (`command` |
 *                     |                             | `engine` | `none`) when the package's slicer engine provides
 *                     |                             | `slice_gcode`, and validate bounded generic G-code settings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCODE_SLICE_LIMITS = exports.GCODE_PROFILES = exports.SLICER_TIMEOUT_ENV = exports.SLICER_CMD_ENV = void 0;
exports.resolveSlicerConfig = resolveSlicerConfig;
exports.buildSlicerArgv = buildSlicerArgv;
exports.sliceStl = sliceStl;
exports.resolveSlicerBackend = resolveSlicerBackend;
exports.defaultGcodeProfileForKind = defaultGcodeProfileForKind;
exports.parseGcodeSliceSettings = parseGcodeSliceSettings;
/** @description Environment variable names this module reads. */
exports.SLICER_CMD_ENV = 'SCAN_TO_PRINT_SLICER_CMD';
exports.SLICER_TIMEOUT_ENV = 'SCAN_TO_PRINT_SLICER_TIMEOUT_MS';
/** @description Default slicer timeout: five minutes. */
const DEFAULT_TIMEOUT_MS = 300_000;
/**
 * @description Read the slicer configuration from the environment. Null when no command is set —
 * the caller must treat that as "slicing unavailable", never substitute a program.
 * @param env - Usually `process.env`.
 * @returns The config, or null.
 * @throws RangeError when the template lacks a placeholder or the timeout is not a positive integer.
 */
function resolveSlicerConfig(env) {
    const command = (env[exports.SLICER_CMD_ENV] ?? '').trim();
    if (!command)
        return null;
    if (!command.includes('{input}') || !command.includes('{output}')) {
        throw new RangeError(`${exports.SLICER_CMD_ENV} must contain both {input} and {output}`);
    }
    const rawTimeout = env[exports.SLICER_TIMEOUT_ENV];
    const timeoutMs = rawTimeout === undefined || rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
        throw new RangeError(`${exports.SLICER_TIMEOUT_ENV} must be a positive integer`);
    return { command, timeoutMs };
}
/**
 * @description Split a command template into argv, honouring double quotes, and substitute the
 * placeholders as WHOLE tokens (a path is never spliced into a larger argument).
 * @param command - The template.
 * @param input - STL path.
 * @param output - G-code path.
 * @returns Program and arguments.
 * @throws RangeError when the template is empty or a placeholder is embedded inside a token.
 */
function buildSlicerArgv(command, input, output) {
    const tokens = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(command)) !== null)
        tokens.push(m[1] !== undefined ? m[1] : m[2]);
    if (tokens.length === 0)
        throw new RangeError('Slicer command is empty');
    const args = tokens.slice(1).map((token) => {
        if (token === '{input}')
            return input;
        if (token === '{output}')
            return output;
        if (token.includes('{input}') || token.includes('{output}'))
            throw new RangeError(`Placeholder must be a whole argument: "${token}"`);
        return token;
    });
    return { file: tokens[0], args };
}
/**
 * @description Run the configured slicer on one STL.
 * @param config - From {@link resolveSlicerConfig}.
 * @param inputPath - STL path.
 * @param outputPath - Where the G-code must land.
 * @param execFileImpl - Process runner.
 * @param outputExists - Checks the output landed; injected with the runner for the same reason.
 * @returns The result; never throws for a slicer failure.
 */
async function sliceStl(config, inputPath, outputPath, execFileImpl, outputExists) {
    const started = Date.now();
    const { file, args } = buildSlicerArgv(config.command, inputPath, outputPath);
    try {
        const { stderr } = await execFileImpl(file, args, { timeout: config.timeoutMs });
        const ok = outputExists(outputPath);
        return { ok, durationMs: Date.now() - started, stderr: stderr.slice(-4000), error: ok ? undefined : 'slicer exited without producing the output file' };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stderr = typeof error.stderr === 'string' ? error.stderr.slice(-4000) : '';
        return { ok: false, durationMs: Date.now() - started, stderr, error: message };
    }
}
/**
 * @description Determine whether G-code slicing is configured via explicit CLI command or the package engine.
 * @param env - Environment (checked for SCAN_TO_PRINT_SLICER_CMD first).
 * @param engineConfigured - True when the package's slicer engine (`slice_gcode`) is configured.
 * @returns Backend and resolved command config (when backend is `'command'`).
 */
function resolveSlicerBackend(env, engineConfigured) {
    let command = null;
    try {
        command = resolveSlicerConfig(env);
    }
    catch {
        command = null;
    }
    if (command)
        return { configured: true, backend: 'command', command };
    if (engineConfigured)
        return { configured: true, backend: 'engine', command: null };
    return { configured: false, backend: 'none', command: null };
}
/** @description Generic G-code profiles supported by the package slicer engine (`slice_gcode`). */
exports.GCODE_PROFILES = ['marlin', 'klipper'];
const GCODE_PROFILE_ALIASES = {
    generic: 'marlin', marlin: 'marlin', octoprint: 'marlin', prusalink: 'marlin', klipper: 'klipper', moonraker: 'klipper',
};
/** @description Bounds for generic STL-to-G-code slicing settings (mirrored by engine/slicer_worker.py). */
exports.GCODE_SLICE_LIMITS = Object.freeze({
    layerHeightMm: Object.freeze({ min: 0.05, max: 0.6, default: 0.2 }),
    infillPct: Object.freeze({ min: 0, max: 100, default: 15 }),
    wallLoops: Object.freeze({ min: 1, max: 10, default: 2 }),
    nozzleTempC: Object.freeze({ min: 150, max: 320, default: 210 }),
    bedTempC: Object.freeze({ min: 0, max: 120, default: 60 }),
});
/** @description Default generic G-code profile for an HTTP printer host kind. */
function defaultGcodeProfileForKind(printerKind) {
    return printerKind === 'moonraker' ? 'klipper' : 'marlin';
}
function readBoundedGcodeNum(raw, key, integer) {
    const value = raw[key];
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new RangeError(`${key} must be a finite number`);
    const { min, max } = exports.GCODE_SLICE_LIMITS[key];
    if (integer && !Number.isInteger(value))
        throw new RangeError(`${key} must be an integer between ${min} and ${max}`);
    if (value < min || value > max)
        throw new RangeError(`${key} must be between ${min} and ${max}`);
    return value;
}
/**
 * @description Parse optional bounded generic G-code settings from a request body.
 * @param input - Plain object carrying optional slice settings.
 * @returns Only the explicitly provided, validated fields.
 * @throws RangeError when any supplied setting is outside bounds.
 */
function parseGcodeSliceSettings(input) {
    if (input === undefined || input === null)
        return {};
    if (typeof input !== 'object' || Array.isArray(input))
        throw new RangeError('sliceSettings must be an object');
    const raw = input;
    const out = {};
    const lh = readBoundedGcodeNum(raw, 'layerHeightMm', false);
    if (lh !== undefined)
        out.layerHeightMm = lh;
    const infill = readBoundedGcodeNum(raw, 'infillPct', true);
    if (infill !== undefined)
        out.infillPct = infill;
    const walls = readBoundedGcodeNum(raw, 'wallLoops', true);
    if (walls !== undefined)
        out.wallLoops = walls;
    const nozzle = readBoundedGcodeNum(raw, 'nozzleTempC', true);
    if (nozzle !== undefined)
        out.nozzleTempC = nozzle;
    const bed = readBoundedGcodeNum(raw, 'bedTempC', true);
    if (bed !== undefined)
        out.bedTempC = bed;
    if (raw.profile !== undefined && raw.profile !== null && raw.profile !== '') {
        if (typeof raw.profile !== 'string')
            throw new RangeError('profile must be a string');
        const mapped = GCODE_PROFILE_ALIASES[raw.profile.trim().toLowerCase()];
        if (!mapped)
            throw new RangeError(`unknown generic profile "${raw.profile}"`);
        out.profile = mapped;
    }
    return out;
}
//# sourceMappingURL=slicer.js.map