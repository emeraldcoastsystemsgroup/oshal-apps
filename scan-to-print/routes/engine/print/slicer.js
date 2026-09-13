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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLICER_TIMEOUT_ENV = exports.SLICER_CMD_ENV = void 0;
exports.resolveSlicerConfig = resolveSlicerConfig;
exports.buildSlicerArgv = buildSlicerArgv;
exports.sliceStl = sliceStl;
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
//# sourceMappingURL=slicer.js.map