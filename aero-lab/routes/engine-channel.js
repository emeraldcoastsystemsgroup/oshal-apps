"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — the byte pipe
 *   |                                           | between the adapter and one engine worker, as
 *   |                                           | an interface both transports implement: the
 *   |                                           | local child process (engine-adapter.ts) and
 *   |                                           | the engine CONTAINER's TCP bridge (here). The
 *   |                                           | container channel verifies the bridge hello
 *   |                                           | (protocol + build hash) before any request
 *   |                                           | leaves, and unpacks inline export files into
 *   |                                           | the api-side workDir the download route reads.
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LineSplitter = exports.BRIDGE_PROTOCOL = void 0;
exports.unpackExport = unpackExport;
exports.openContainerChannel = openContainerChannel;
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-engine-channel' });
/** The bridge wire version this adapter speaks (PROTOCOL in aero_engine_bridge.py). */
exports.BRIDGE_PROTOCOL = 1;
const HELLO_TIMEOUT_MS = 15_000;
const EXPORT_ID_RE = /^exp-[0-9a-f]{12}$/;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);
/**
 * @description Reassemble newline-delimited protocol lines from arbitrary chunks. stdout and
 * the socket are the protocol channel; blank lines carry nothing and are dropped.
 */
class LineSplitter {
    emit;
    buf = '';
    constructor(emit) {
        this.emit = emit;
    }
    /**
     * @description Feed one chunk; emits every line it completes.
     * @param chunk - Decoded text chunk.
     */
    push(chunk) {
        this.buf += chunk;
        let nl = this.buf.indexOf('\n');
        while (nl >= 0) {
            const line = this.buf.slice(0, nl).replace(/\r$/, '').trim();
            this.buf = this.buf.slice(nl + 1);
            if (line)
                this.emit(line);
            nl = this.buf.indexOf('\n');
        }
    }
}
exports.LineSplitter = LineSplitter;
/**
 * @description TCP channel to the aero-lab engine container. Writes are held until the bridge
 * hello proves the container runs this package's engine build, so a stale container never
 * computes anything on this adapter's behalf.
 */
class ContainerChannel {
    opts;
    handlers;
    socket;
    splitter = new LineSplitter((line) => this.onLine(line));
    held = [];
    helloTimer;
    ready = false;
    ended = false;
    constructor(opts, handlers) {
        this.opts = opts;
        this.handlers = handlers;
        this.socket = net.connect({ host: opts.host, port: opts.port });
        this.socket.setEncoding('utf8');
        this.socket.setNoDelay(true);
        this.socket.on('data', (chunk) => this.splitter.push(chunk));
        this.socket.on('error', (err) => this.fail(this.classify(err)));
        this.socket.on('close', () => this.fail({ code: 'engine_error', message: 'engine container closed the connection' }));
        const timeoutMs = opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
        this.helloTimer = setTimeout(() => this.fail(this.unavailable(`aerosim engine container at ${this.where()} did not identify itself within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        this.helloTimer.unref();
    }
    get alive() {
        return !this.ended;
    }
    write(line) {
        if (this.ended)
            return false;
        if (!this.ready) {
            this.held.push(line);
            return true;
        }
        this.socket.write(line);
        return true;
    }
    end() {
        if (this.ended)
            return;
        this.ended = true;
        clearTimeout(this.helloTimer);
        this.socket.end();
    }
    kill(why) {
        if (this.ended)
            return;
        this.ended = true;
        clearTimeout(this.helloTimer);
        logger.info({ where: this.where(), why }, 'closing engine container connection — the bridge kills its worker');
        this.socket.destroy();
    }
    where() {
        return `${this.opts.host}:${this.opts.port}`;
    }
    unavailable(message) {
        return { code: 'capability_unavailable', message, reason: `${message} — install or rebuild it: ${this.opts.installHint}` };
    }
    classify(err) {
        if (err.code && UNREACHABLE.has(err.code)) {
            return this.unavailable(`aerosim engine container is not running at ${this.where()} (${err.code})`);
        }
        logger.error({ err, stack: err.stack, where: this.where() }, 'engine container connection failed');
        return { code: 'engine_error', message: `engine container connection failed: ${err.message}` };
    }
    /** End on our own and tell the adapter why (no-op once ended). */
    fail(failure) {
        if (this.ended)
            return;
        this.ended = true;
        clearTimeout(this.helloTimer);
        this.socket.destroy();
        this.handlers.onGone(failure);
    }
    onLine(line) {
        if (this.ended)
            return;
        if (!this.ready) {
            this.onHello(line);
            return;
        }
        this.handlers.onLine(line.includes('"bridgeFiles"') ? unpackExport(line, this.opts.workDir) : line);
    }
    /** Verify the bridge hello, then release the held requests. */
    onHello(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            this.fail(this.unavailable(`${this.where()} did not answer the aero-lab engine bridge protocol`));
            return;
        }
        if (msg.error) {
            const text = String(msg.error.message || 'engine container refused the connection');
            this.fail(msg.error.code === 'engine_busy' ? { code: 'engine_busy', message: text } : this.unavailable(text));
            return;
        }
        const hello = msg.bridge || {};
        const stale = this.staleReason(hello);
        if (stale) {
            this.fail(stale);
            return;
        }
        this.ready = true;
        clearTimeout(this.helloTimer);
        for (const held of this.held.splice(0))
            this.socket.write(held);
    }
    staleReason(hello) {
        if (hello.protocol !== exports.BRIDGE_PROTOCOL) {
            return this.unavailable(`aerosim engine container speaks bridge protocol ${String(hello.protocol)}, this package needs ${exports.BRIDGE_PROTOCOL}`);
        }
        if (!this.opts.expectedBuildHash) {
            return this.unavailable('this package\'s engine tree could not be read, so the engine container build cannot be verified');
        }
        if (hello.buildHash !== this.opts.expectedBuildHash) {
            return this.unavailable(`aerosim engine container is out of date: it was built from engine ${String(hello.buildHash).slice(0, 12)}, ` +
                `this package ships ${this.opts.expectedBuildHash.slice(0, 12)}`);
        }
        return null;
    }
}
/**
 * @description Write a bridged export's inline files into the api-side workDir and strip them
 * from the response, so the route's allow-listed download path works unchanged. Any violation
 * turns the response into a typed engine_error — a partial package is never reported as done.
 * @param line - The bridge's response line carrying result.bridgeFiles.
 * @param workDir - api-side workDir.
 * @returns The protocol line to hand the adapter.
 */
function unpackExport(line, workDir) {
    let msg;
    try {
        msg = JSON.parse(line);
    }
    catch {
        return line;
    }
    const result = msg.result;
    if (!msg.ok || !result || !Array.isArray(result.bridgeFiles))
        return line;
    const exportId = String(result.exportId || '');
    try {
        if (!EXPORT_ID_RE.test(exportId))
            throw new Error(`unexpected export id "${exportId}"`);
        const dir = path.join(workDir, 'exports', exportId);
        fs.mkdirSync(dir, { recursive: true });
        for (const file of result.bridgeFiles) {
            const name = String(file.name || '');
            if (!name || path.basename(name) !== name || name === '.' || name === '..')
                throw new Error(`unsafe export file name "${name}"`);
            fs.writeFileSync(path.join(dir, name), Buffer.from(String(file.b64 || ''), 'base64'));
        }
    }
    catch (err) {
        logger.error({ err, stack: err.stack, exportId }, 'export transfer from the engine container failed');
        return JSON.stringify({ id: msg.id, ok: false, error: { code: 'engine_error', message: `export transfer failed: ${err.message}` } });
    }
    delete result.bridgeFiles;
    return JSON.stringify(msg);
}
/**
 * @description Open a channel to the engine container's bridge.
 * @param opts - Address, expected build hash, workDir and install hint.
 * @param handlers - Line + gone callbacks.
 * @returns The channel (connecting; writes are held until the hello verifies).
 */
function openContainerChannel(opts, handlers) {
    return new ContainerChannel(opts, handlers);
}
