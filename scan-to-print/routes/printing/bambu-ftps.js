"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — upload one file to a Bambu Lab printer's
 *                     |                             | storage over IMPLICIT FTPS (TLS from the first byte, port 990,
 *                     |                             | user `bblp` + the LAN access code) with node:tls only. The
 *                     |                             | control connection refuses, before USER/PASS, any peer that is
 *                     |                             | not the printer pinned at registration (certificate fingerprint
 *                     |                             | and serial). The transfer follows the server's own order: the
 *                     |                             | passive data socket is opened (plain TCP), STOR is sent, and
 *                     |                             | only after the server's 150 is TLS started on that socket,
 *                     |                             | resuming the control session (the printer's vsftpd requires it)
 *                     |                             | and checked against the pin before a byte is sent. A refused
 *                     |                             | STOR (553 = no USB stick / SD card) closes the data socket at
 *                     |                             | once, so nothing waits on a connection the server never accepts;
 *                     |                             | every step has a timeout. The PASV address the server names is
 *                     |                             | ignored in favour of the host already dialled.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The control and data connections offer TLS 1.2 at most, like the
 *                     |                             | broker (BAMBU_MAX_TLS), so every connection to the printer offers
 *                     |                             | only the version all of its servers answer. Nothing changes on the
 *                     |                             | wire: the file server speaks only TLS 1.2 (measured on a P2S at
 *                     |                             | 01.01.02.00; P2S units on 01.02.00.00 were reported to refuse a
 *                     |                             | TLS 1.3 hello at once and settle on 1.2).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pasvPort = pasvPort;
exports.ftpsUpload = ftpsUpload;
const node_net_1 = __importDefault(require("node:net"));
const node_tls_1 = __importDefault(require("node:tls"));
const bambu_mqtt_1 = require("./bambu-mqtt");
/** @description Reads complete (possibly multi-line) FTP replies off a socket. */
class ReplyReader {
    buffer = '';
    queue = [];
    waiter = null;
    failure = null;
    constructor(socket) {
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => this.push(chunk));
        socket.on('error', (error) => this.fail(error));
        socket.on('close', () => this.fail(new Error('the printer file server closed the connection')));
    }
    fail(error) {
        if (!this.failure)
            this.failure = error;
        if (this.waiter) {
            const w = this.waiter;
            this.waiter = null;
            w.reject(this.failure);
        }
    }
    push(chunk) {
        this.buffer += chunk;
        for (;;) {
            const m = /^(\d{3})(?: [^\n]*\r?\n|-[\s\S]*?\r?\n\1 [^\n]*\r?\n)/.exec(this.buffer);
            if (!m)
                return;
            this.buffer = this.buffer.slice(m[0].length);
            const reply = { code: Number(m[1]), text: m[0].trim() };
            if (this.waiter) {
                const w = this.waiter;
                this.waiter = null;
                w.resolve(reply);
            }
            else
                this.queue.push(reply);
        }
    }
    /** @description The next reply, or a rejection after `timeoutMs` or when the connection fails. */
    next(timeoutMs) {
        const queued = this.queue.shift();
        if (queued)
            return Promise.resolve(queued);
        if (this.failure)
            return Promise.reject(this.failure);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.waiter = null; reject(new Error(`printer file server did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
            this.waiter = { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } };
        });
    }
}
/** @description A thrown reply the caller turns into a person-readable message. */
class ReplyError extends Error {
    reply;
    step;
    constructor(reply, step) {
        super(`${step}: ${reply.text}`);
        this.reply = reply;
        this.step = step;
    }
}
/** @description Open the TLS control connection and refuse anything but the pinned printer. */
function openControl(target, timeoutMs) {
    const connect = target.connect ?? node_tls_1.default.connect;
    return new Promise((resolve, reject) => {
        const socket = connect({ host: target.host, port: target.port ?? 990, rejectUnauthorized: false, maxVersion: bambu_mqtt_1.BAMBU_MAX_TLS });
        let latest;
        const timer = setTimeout(() => { socket.destroy(); reject(new Error(`the printer file server at ${target.host} did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        socket.on('session', (s) => { latest = s; });
        socket.on('error', (error) => { clearTimeout(timer); socket.destroy(); reject(new Error(`printer file server connection failed: ${error.message}`)); });
        socket.once('secureConnect', () => {
            clearTimeout(timer);
            const mismatch = (0, bambu_mqtt_1.printerPinMismatch)(socket, target.host, target.serial, target.certSha256);
            if (mismatch) {
                socket.destroy();
                reject(new Error(mismatch));
                return;
            }
            resolve({ socket, reader: new ReplyReader(socket), session: () => latest ?? socket.getSession() });
        });
    });
}
/** @description Send one command and require a reply code. */
async function command(socket, reader, line, expect, step, timeoutMs) {
    socket.write(line + '\r\n');
    const reply = await reader.next(timeoutMs);
    if (!expect.includes(reply.code))
        throw new ReplyError(reply, step);
    return reply;
}
/**
 * @description The data port from a 227 reply.
 * @param text - The PASV reply.
 * @returns The port.
 * @throws Error when the reply carries no address tuple.
 */
function pasvPort(text) {
    const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(text);
    if (!m)
        throw new Error(`unreadable passive-mode reply: ${text}`);
    return Number(m[5]) * 256 + Number(m[6]);
}
/** @description Open the plain TCP data socket; resolves once connected. */
function openTcp(target, port, timeoutMs) {
    const connect = target.connectTcp ?? ((host, p) => node_net_1.default.connect({ host, port: p }));
    return new Promise((resolve, reject) => {
        const socket = connect(target.host, port);
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('the printer did not accept the data connection')); }, timeoutMs);
        socket.on('error', (error) => { clearTimeout(timer); socket.destroy(); reject(new Error(`printer data connection failed: ${error.message}`)); });
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    });
}
/** @description Start TLS on the accepted data socket (resuming the control session), verify, send, finish. */
function sendOverTls(target, tcp, session, bytes, timeoutMs) {
    const connect = target.connect ?? node_tls_1.default.connect;
    return new Promise((resolve, reject) => {
        // `host` must be the one the control connection used: without it Node names the TLS server
        // 'localhost', the session no longer matches, and the printer refuses the non-resumed channel.
        const data = connect({ socket: tcp, host: target.host, rejectUnauthorized: false, session, maxVersion: bambu_mqtt_1.BAMBU_MAX_TLS });
        const timer = setTimeout(() => { data.destroy(); reject(new Error(`the upload did not finish within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        const fail = (error) => { clearTimeout(timer); data.destroy(); reject(error); };
        data.on('error', (error) => fail(new Error(`printer data connection failed: ${error.message}`)));
        data.once('secureConnect', () => {
            if (!data.isSessionReused() && (0, bambu_mqtt_1.printerPinMismatch)(data, target.host, target.serial, target.certSha256)) {
                fail(new Error('the data connection did not reach the printer this upload started with'));
                return;
            }
            data.end(Buffer.from(bytes), () => { clearTimeout(timer); resolve(); });
        });
    });
}
/** @description Map a refused step to what the person should do. */
function explain(error) {
    if (error instanceof ReplyError) {
        if (error.reply.code === 530)
            return 'the printer refused the LAN access code';
        if (error.reply.code === 553 || error.reply.code === 452)
            return 'the printer has nowhere to store the file — insert a USB stick (or SD card) in the printer, or free space on it';
        return `the printer file server refused ${error.step} (${error.reply.text})`;
    }
    return error instanceof Error ? error.message : String(error);
}
/** @description Log in and switch the control channel to private binary transfers; returns the data port. */
async function prepare(socket, reader, target, wait) {
    if ((await reader.next(wait)).code !== 220)
        throw new Error('printer file server sent no greeting');
    await command(socket, reader, 'USER bblp', [331, 230], 'USER', wait);
    await command(socket, reader, `PASS ${target.accessCode}`, [230], 'PASS', wait);
    await command(socket, reader, 'PBSZ 0', [200], 'PBSZ', wait);
    await command(socket, reader, 'PROT P', [200], 'PROT', wait);
    await command(socket, reader, 'TYPE I', [200], 'TYPE', wait);
    return pasvPort((await command(socket, reader, 'PASV', [227], 'PASV', wait)).text);
}
/** @description STOR over an opened data socket, then confirm with 226 and SIZE. */
async function transfer(control, target, port, fileName, bytes, wait) {
    const { socket, reader } = control;
    const transferMs = target.transferTimeoutMs ?? Math.max(120_000, Math.ceil(bytes.byteLength / 50_000) * 1000);
    const tcp = await openTcp(target, port, wait);
    try {
        socket.write(`STOR ${fileName}\r\n`);
        const opened = await reader.next(wait);
        if (![125, 150].includes(opened.code))
            throw new ReplyError(opened, 'STOR');
        await sendOverTls(target, tcp, control.session(), bytes, transferMs);
        // The data socket stays open until the server confirms it read everything (226): closing it
        // earlier, with the server's close_notify unread, could reset the connection and lose the tail.
        const done = await reader.next(transferMs);
        if (done.code !== 226)
            throw new ReplyError(done, 'STOR');
    }
    finally {
        tcp.destroy();
    }
    const size = await command(socket, reader, `SIZE ${fileName}`, [213], 'SIZE', wait);
    return Number(size.text.split(/\s+/)[1]);
}
/**
 * @description Upload one file to the root of the printer's storage and confirm its stored size.
 * @param target - Printer host, serial, pinned certificate and access code.
 * @param fileName - Name to store (a bare file name; no path).
 * @param bytes - File contents.
 * @returns The outcome; never throws.
 */
async function ftpsUpload(target, fileName, bytes) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(fileName))
        return { ok: false, storedBytes: null, message: `refusing to store an unsafe file name: ${fileName}` };
    const wait = target.replyTimeoutMs ?? 15_000;
    let control = null;
    try {
        control = await openControl(target, wait);
        const port = await prepare(control.socket, control.reader, target, wait);
        const storedBytes = await transfer(control, target, port, fileName, bytes, wait);
        control.socket.write('QUIT\r\n');
        const ok = storedBytes === bytes.byteLength;
        return { ok, storedBytes, message: ok ? 'stored on the printer' : `the printer stored ${storedBytes} of ${bytes.byteLength} bytes` };
    }
    catch (error) {
        return { ok: false, storedBytes: null, message: explain(error) };
    }
    finally {
        control?.socket.destroy();
    }
}
//# sourceMappingURL=bambu-ftps.js.map