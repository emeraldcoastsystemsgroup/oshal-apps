"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the client for the package's slicer engine
 *                     |                             | container (BUILDING-EXTENSIONS §7): one TCP connection per
 *                     |                             | request, JSON lines, the bridge's hello verified first. A
 *                     |                             | container built from a different engine tree is REFUSED with the
 *                     |                             | exact install command (installHint), never asked to slice — the
 *                     |                             | build hash is computed here over the same files, the same way, as
 *                     |                             | slicer_engine_bridge.py does, and a spec keeps the two in step.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: a busy engine (no free worker slot) is `busy`, not
 *                     |                             | `unavailable` with reinstall advice; an engine that closes the
 *                     |                             | connection without answering fails the request at once instead
 *                     |                             | of after the timeout; a malformed address is carried as an
 *                     |                             | error the request reports, never thrown while routes mount; and
 *                     |                             | a multi-megabyte answer line is assembled once (linear) rather
 *                     |                             | than rescanned on every chunk on the api's event loop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Second review: nothing the endpoint sends can throw out of the
 *                     |                             | socket handler — a non-object or oddly-typed line is a typed
 *                     |                             | failure, and the line handler itself is guarded; an out-of-range
 *                     |                             | port is an address error, and a socket that cannot even be
 *                     |                             | created is `unavailable`, not a caller error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Third review: an answer line is capped (MAX_ANSWER_CHARS, far above
 *                     |                             | any real archive and far below V8's string limit) and the whole
 *                     |                             | assembler is guarded, so an oversized or hostile line fails the
 *                     |                             | request instead of throwing out of the socket handler; a slice
 *                     |                             | result of the wrong shape is a typed engine error.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BAMBU_NOZZLES = exports.BAMBU_PLATES = exports.SlicerEngineError = exports.SLICER_RUNTIME_FILES = exports.SLICER_ENGINE_ADDR_ENV = exports.DEFAULT_SLICER_ENGINE_ADDR = exports.SLICER_BRIDGE_PROTOCOL = exports.MAX_ANSWER_CHARS = void 0;
exports.slicerEngineBuildHash = slicerEngineBuildHash;
exports.slicerInstallHint = slicerInstallHint;
exports.parseSlicerAddr = parseSlicerAddr;
exports.lineAssembler = lineAssembler;
exports.slicerRequest = slicerRequest;
exports.sliceToArchive = sliceToArchive;
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
/** @description Longest answer line accepted: a 64 MiB STL's archive, base64-encoded, fits many times over. */
exports.MAX_ANSWER_CHARS = 256 * 1024 * 1024;
/** @description The bridge wire version (PROTOCOL in the bridge and worker). */
exports.SLICER_BRIDGE_PROTOCOL = 1;
/** @description Where the api finds the engine on the stack network. */
exports.DEFAULT_SLICER_ENGINE_ADDR = 'scan-to-print-engine:7414';
/** @description Environment override for that address. */
exports.SLICER_ENGINE_ADDR_ENV = 'SCAN_TO_PRINT_ENGINE_ADDR';
/** @description The files the image bakes that change its answers (mirror of RUNTIME_FILES in the bridge). */
exports.SLICER_RUNTIME_FILES = ['slicer_worker.py', 'container/slicer_engine_bridge.py', 'container/Dockerfile', 'orcaslicer-lock.txt'];
/**
 * @description sha256 over the runtime files, each prefixed by its relative name and NUL-framed,
 * CRLF folded to LF (a Windows checkout and the deployed copy of one commit must agree).
 * @param engineDir - The package's `engine/` directory.
 * @returns Hex digest, or null when the directory is absent.
 */
function slicerEngineBuildHash(engineDir) {
    if (!engineDir || !node_fs_1.default.existsSync(engineDir))
        return null;
    const digest = (0, node_crypto_1.createHash)('sha256');
    for (const rel of exports.SLICER_RUNTIME_FILES) {
        digest.update(Buffer.from(rel + '\0', 'utf8'));
        const file = node_path_1.default.join(engineDir, rel);
        if (node_fs_1.default.existsSync(file))
            digest.update(Buffer.from(node_fs_1.default.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
        digest.update(Buffer.from('\0', 'utf8'));
    }
    return digest.digest('hex');
}
/**
 * @description The command that (re)installs the engine on THIS box — built, never hardcoded in a surface.
 * @param engineDir - The package's `engine/` directory.
 * @returns A copy-paste command.
 */
function slicerInstallHint(engineDir) {
    const script = `${engineDir.replace(/\\/g, '/')}/install-engine.sh`;
    return node_fs_1.default.existsSync('/.dockerenv') ? `docker exec ${node_os_1.default.hostname()} sh ${script}` : `sh ${script}`;
}
/** @description A typed failure: `unavailable` carries the install command in its reason. */
class SlicerEngineError extends Error {
    code;
    reason;
    constructor(code, message, reason) {
        super(message);
        this.code = code;
        this.reason = reason;
        this.name = 'SlicerEngineError';
    }
}
exports.SlicerEngineError = SlicerEngineError;
/**
 * @description Parse `host:port`.
 * @param value - Configured address, or undefined for the default.
 * @returns Host and port.
 */
function parseSlicerAddr(value) {
    const text = (value || exports.DEFAULT_SLICER_ENGINE_ADDR).trim();
    const m = /^(.+):(\d{1,5})$/.exec(text);
    const port = m ? Number(m[2]) : 0;
    if (!m || port < 1 || port > 65535)
        throw new RangeError(`invalid slicer engine address "${text}" (expected host:port, port 1-65535)`);
    return { host: m[1], port };
}
/** @description A field as text only when it is a string or number (anything else reads as absent). */
function field(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}
/** @description A parsed line as a plain object, or null for anything else (null, arrays, scalars). */
function objectOf(line) {
    try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
/** @description Check the hello line; null when the engine is the one this package ships. */
function verifyHello(line, opts) {
    const unavailable = (message) => new SlicerEngineError('unavailable', message, `${message} — install or rebuild it: ${opts.installHint}`);
    const msg = objectOf(line);
    if (!msg)
        return unavailable(`${opts.host}:${opts.port} does not speak the slicer bridge protocol`);
    if (msg.error !== undefined) {
        const error = (msg.error && typeof msg.error === 'object' ? msg.error : {});
        if (field(error.code) === 'engine_busy')
            return new SlicerEngineError('busy', field(error.message) ?? 'the slicer engine has no free worker slot', 'the slicer is busy with other slices; try again in a minute');
        return unavailable(field(error.message) ?? 'the slicer engine refused the connection');
    }
    const hello = (msg.bridge && typeof msg.bridge === 'object' ? msg.bridge : {});
    if (hello.protocol !== exports.SLICER_BRIDGE_PROTOCOL)
        return unavailable(`the slicer engine speaks bridge protocol ${field(hello.protocol) ?? 'unknown'}, this package needs ${exports.SLICER_BRIDGE_PROTOCOL}`);
    if (!opts.expectedBuildHash)
        return unavailable("this package's engine tree could not be read, so the slicer engine build cannot be verified");
    if (hello.buildHash !== opts.expectedBuildHash) {
        return unavailable(`the slicer engine container is out of date: it was built from engine ${(field(hello.buildHash) ?? 'unknown').slice(0, 12)}, this package ships ${opts.expectedBuildHash.slice(0, 12)}`);
    }
    return null;
}
/**
 * @description A chunk consumer that calls `onLine` for every complete line. Only the arriving chunk
 * is searched and an unfinished line's pieces are joined once, so a multi-megabyte line costs linear
 * time on the api's event loop (re-scanning one growing string per chunk is quadratic).
 * @param onLine - Called with each non-blank line; return false to stop consuming.
 * @param onFailure - Called once when a line exceeds `maxChars` or consuming throws; nothing is consumed after.
 * @param maxChars - Longest line accepted.
 * @returns The chunk consumer; it never throws.
 */
function lineAssembler(onLine, onFailure = () => undefined, maxChars = exports.MAX_ANSWER_CHARS) {
    let pending = [];
    let pendingChars = 0;
    let open = true;
    const fail = (error) => { open = false; pending = []; pendingChars = 0; onFailure(error); };
    return (chunk) => {
        if (!open)
            return;
        try {
            let rest = chunk;
            let newline;
            while (open && (newline = rest.indexOf('\n')) >= 0) {
                if (pendingChars + newline > maxChars) {
                    fail(new Error(`an answer line exceeded ${maxChars} characters`));
                    return;
                }
                pending.push(rest.slice(0, newline));
                const line = pending.join('');
                pending = [];
                pendingChars = 0;
                rest = rest.slice(newline + 1);
                if (line.trim())
                    open = onLine(line);
            }
            if (open && rest) {
                pendingChars += rest.length;
                if (pendingChars > maxChars) {
                    fail(new Error(`an answer line exceeded ${maxChars} characters`));
                    return;
                }
                pending.push(rest);
            }
        }
        catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    };
}
/** @description Why a connection closed before an answer: unavailable before the hello, an engine error after. */
function closedEarly(helloSeen, opts) {
    if (helloSeen)
        return new SlicerEngineError('engine_error', 'the slicer engine closed the connection before answering');
    const message = `the slicer engine at ${opts.host}:${opts.port} closed the connection before identifying itself`;
    return new SlicerEngineError('unavailable', message, `${message} — install or rebuild it: ${opts.installHint}`);
}
/** @description The engine's answer line as a result or a typed failure. */
function answerOf(line) {
    const msg = objectOf(line);
    if (!msg)
        return { ok: false, error: new SlicerEngineError('engine_error', 'the slicer engine sent an unreadable answer') };
    if (msg.ok === true)
        return { ok: true, value: msg.result };
    const error = (msg.error && typeof msg.error === 'object' ? msg.error : {});
    return { ok: false, error: new SlicerEngineError(field(error.code) === 'refused' ? 'refused' : 'engine_error', field(error.message) ?? 'slicer engine error') };
}
/**
 * @description Send one command to the engine on a fresh connection and return its result.
 * @param opts - Address, expected build hash, install hint.
 * @param cmd - `profiles` | `slice` | `hello`.
 * @param args - Command arguments.
 * @returns The engine's `result`.
 * @throws SlicerEngineError.
 */
function slicerRequest(opts, cmd, args) {
    if (opts.addrError) {
        const message = `${exports.SLICER_ENGINE_ADDR_ENV} is invalid: ${opts.addrError}`;
        return Promise.reject(new SlicerEngineError('unavailable', message, `${message} — set it to host:port, or unset it for ${exports.DEFAULT_SLICER_ENGINE_ADDR}`));
    }
    const connect = opts.connect ?? ((host, port) => node_net_1.default.connect({ host, port }));
    return new Promise((resolve, reject) => {
        let socket;
        try {
            socket = connect(opts.host, opts.port);
        }
        catch (error) {
            const message = `the slicer engine at ${opts.host}:${opts.port} cannot be dialled (${error instanceof Error ? error.message : String(error)})`;
            reject(new SlicerEngineError('unavailable', message, `${message} — check ${exports.SLICER_ENGINE_ADDR_ENV} or install it: ${opts.installHint}`));
            return;
        }
        let helloSeen = false;
        let settled = false;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            if (error)
                reject(error);
            else
                resolve(value);
        };
        const timeoutMs = opts.timeoutMs ?? 600_000;
        const timer = setTimeout(() => finish(new SlicerEngineError('timeout', `the slicer engine did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        socket.setEncoding('utf8');
        socket.on('error', (error) => {
            const message = `the slicer engine is not running at ${opts.host}:${opts.port} (${error.code ?? error.message})`;
            finish(new SlicerEngineError('unavailable', message, `${message} — install it: ${opts.installHint}`));
        });
        socket.on('close', () => finish(closedEarly(helloSeen, opts)));
        socket.on('data', lineAssembler((line) => {
            try {
                if (!helloSeen) {
                    helloSeen = true;
                    const stale = verifyHello(line, opts);
                    if (stale) {
                        finish(stale);
                        return false;
                    }
                    socket.write(JSON.stringify({ id: 1, cmd, args }) + '\n');
                    return true;
                }
                const answer = answerOf(line);
                if (answer.ok)
                    finish(null, answer.value);
                else
                    finish(answer.error);
            }
            catch (error) {
                finish(new SlicerEngineError('engine_error', `the slicer engine's answer could not be read (${error instanceof Error ? error.message : String(error)})`));
            }
            return false;
        }, (error) => finish(new SlicerEngineError('engine_error', `the slicer engine's answer could not be read (${error.message})`))));
    });
}
/** @description Build plates the engine slices for (the vendor profiles' curr_bed_type values). */
exports.BAMBU_PLATES = ['Cool Plate', 'Engineering Plate', 'High Temp Plate', 'Textured PEI Plate', 'Textured Cool Plate', 'Supertack Plate'];
/** @description Nozzle diameters the engine slices for. */
exports.BAMBU_NOZZLES = ['0.2', '0.4', '0.6', '0.8'];
/**
 * @description Slice an STL into a printer-ready `.gcode.3mf`.
 * @param opts - Engine options.
 * @param stl - STL bytes.
 * @param name - Base name for the archive.
 * @param profile - Printer model, nozzle, filament, plate.
 * @returns The archive.
 * @throws SlicerEngineError.
 */
async function sliceToArchive(opts, stl, name, profile) {
    const result = await slicerRequest(opts, 'slice', {
        stl: Buffer.from(stl).toString('base64'), name, modelId: profile.modelId, nozzle: profile.nozzle, filament: profile.filament,
        ...(profile.plate ? { plate: profile.plate } : {}),
    });
    const estimate = (result && typeof result.estimate === 'object' && result.estimate !== null ? result.estimate : null);
    if (!result || typeof result.archive !== 'string' || !result.archive || typeof result.fileName !== 'string' || !result.profile || typeof result.profile !== 'object'
        || !estimate || typeof estimate.printSeconds !== 'number' || typeof estimate.firstLayerSeconds !== 'number') {
        throw new SlicerEngineError('engine_error', 'the slicer engine sent an unreadable slice result');
    }
    const profileOut = Object.fromEntries(Object.entries(result.profile).filter(([, v]) => typeof v === 'string'));
    return { fileName: result.fileName, bytes: new Uint8Array(Buffer.from(result.archive, 'base64')),
        estimate: { printSeconds: estimate.printSeconds, firstLayerSeconds: estimate.firstLayerSeconds, filamentGrams: typeof estimate.filamentGrams === 'number' ? estimate.filamentGrams : null },
        profile: profileOut };
}
//# sourceMappingURL=slicer-engine.js.map