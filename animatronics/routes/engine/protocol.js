"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the controller line protocol the browser
 *                     |                             | speaks to the ESP32 / Arduino over Web Serial (or a Wi-Fi
 *                     |                             | socket) and the firmware parses: one ASCII line per message,
 *                     |                             | an NMEA-style XOR checksum, frames as `F <seq> ch=us,…`,
 *                     |                             | controller-side clamps `L`, hello `H`, e-stop `E` (outputs
 *                     |                             | off and latched) and release `R`. Frames are DELTA-encoded
 *                     |                             | (changed outputs only, a full keyframe every 25 frames, an
 *                     |                             | empty frame as the heartbeat) so 32 channels at 50 Hz fit in
 *                     |                             | 115 200 baud. The same parser reads both directions, so the
 *                     |                             | tests can stand a controller up in Node against the encoder.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeEstopped = exports.encodeErr = exports.encodeOk = exports.encodeRelease = exports.encodeEstop = exports.encodeHello = exports.WATCHDOG_MS = exports.KEYFRAME_EVERY = exports.PROTOCOL_VERSION = exports.PROTOCOL_NAME = void 0;
exports.checksum = checksum;
exports.withChecksum = withChecksum;
exports.encodeLimits = encodeLimits;
exports.encodeFrame = encodeFrame;
exports.encodeHelloReply = encodeHelloReply;
exports.parseLine = parseLine;
exports.frameLines = frameLines;
exports.splitLines = splitLines;
exports.describeProtocol = describeProtocol;
/** @description Protocol name and version the hello reply carries. */
exports.PROTOCOL_NAME = 'oshal-animatronics';
exports.PROTOCOL_VERSION = 1;
/** @description A full (non-delta) frame is sent every this many frames. */
exports.KEYFRAME_EVERY = 25;
/** @description The controller holds the last frame for this long without traffic before it releases to neutral. */
exports.WATCHDOG_MS = 3000;
/** @description Two-hex-digit XOR of every character of the body. */
function checksum(body) {
    let x = 0;
    for (let i = 0; i < body.length; i += 1)
        x ^= body.charCodeAt(i) & 0xff;
    return x.toString(16).toUpperCase().padStart(2, '0');
}
/** @description Terminate a body with its checksum and newline. */
function withChecksum(body) { return `${body}*${checksum(body)}\n`; }
const encodeHello = () => withChecksum('H');
exports.encodeHello = encodeHello;
const encodeEstop = () => withChecksum('E');
exports.encodeEstop = encodeEstop;
const encodeRelease = () => withChecksum('R');
exports.encodeRelease = encodeRelease;
/** @description Controller-side hard clamps for one output. */
function encodeLimits(channel, minUs, maxUs) { return withChecksum(`L ${channel} ${minUs} ${maxUs}`); }
/** @description One frame: sequence number and the outputs it sets (may be empty = heartbeat). */
function encodeFrame(seq, pairs) {
    return withChecksum(pairs.length ? `F ${seq} ${pairs.map(([c, us]) => `${c}=${us}`).join(',')}` : `F ${seq}`);
}
/** @description Controller replies. */
const encodeOk = (ref) => withChecksum(`OK ${ref}`);
exports.encodeOk = encodeOk;
const encodeErr = (ref, reason) => withChecksum(`ERR ${ref} ${reason.replace(/[*\r\n]/g, ' ')}`);
exports.encodeErr = encodeErr;
function encodeHelloReply(board, channels) { return withChecksum(`HELLO ${exports.PROTOCOL_NAME}/${exports.PROTOCOL_VERSION} board=${board} channels=${channels}`); }
const encodeEstopped = () => withChecksum('ESTOP');
exports.encodeEstopped = encodeEstopped;
const INT = /^\d{1,6}$/;
const int = (s) => (s !== undefined && INT.test(s) ? Number(s) : null);
/**
 * @description Parse one line (with or without its trailing newline). Never throws.
 * @param raw - The line.
 * @returns The typed message, or `invalid` with the reason.
 */
function parseLine(raw) {
    const line = raw.replace(/\r?\n$/, '');
    const star = line.lastIndexOf('*');
    if (star < 0 || line.length - star !== 3)
        return { kind: 'invalid', reason: 'missing checksum', line };
    const body = line.slice(0, star);
    if (checksum(body) !== line.slice(star + 1).toUpperCase())
        return { kind: 'invalid', reason: 'bad checksum', line };
    const parts = body.split(' ');
    switch (parts[0]) {
        case 'H': return parts.length === 1 ? { kind: 'hello' } : { kind: 'invalid', reason: 'hello takes no arguments', line };
        case 'E': return { kind: 'estop' };
        case 'R': return { kind: 'release' };
        case 'ESTOP': return { kind: 'estopped' };
        case 'L': {
            const c = int(parts[1]);
            const lo = int(parts[2]);
            const hi = int(parts[3]);
            return c !== null && lo !== null && hi !== null && lo < hi && parts.length === 4 ? { kind: 'limits', channel: c, minUs: lo, maxUs: hi } : { kind: 'invalid', reason: 'limits need channel min max', line };
        }
        case 'F': return parseFrame(parts, line);
        case 'OK': return parts.length >= 2 ? { kind: 'ok', ref: parts.slice(1).join(' ') } : { kind: 'invalid', reason: 'ok needs a reference', line };
        case 'ERR': return parts.length >= 3 ? { kind: 'err', ref: parts[1], reason: parts.slice(2).join(' ') } : { kind: 'invalid', reason: 'err needs a reference and a reason', line };
        case 'HELLO': return parseHello(parts, line);
        default: return { kind: 'invalid', reason: `unknown message ${parts[0]}`, line };
    }
}
function parseFrame(parts, line) {
    const seq = int(parts[1]);
    if (seq === null || parts.length > 3)
        return { kind: 'invalid', reason: 'frame needs a sequence number', line };
    const pairs = [];
    if (parts.length === 3) {
        for (const item of parts[2].split(',')) {
            const m = /^(\d{1,3})=(\d{3,4})$/.exec(item);
            if (!m)
                return { kind: 'invalid', reason: `bad output ${item}`, line };
            pairs.push([Number(m[1]), Number(m[2])]);
        }
    }
    return { kind: 'frame', seq, pairs };
}
function parseHello(parts, line) {
    const m = /^([a-z-]+)\/(\d+)$/.exec(parts[1] ?? '');
    const board = /^board=([a-z0-9-]+)$/.exec(parts[2] ?? '');
    const channels = /^channels=(\d{1,3})$/.exec(parts[3] ?? '');
    if (!m || !board || !channels)
        return { kind: 'invalid', reason: 'hello reply needs name/version board= channels=', line };
    return { kind: 'hello-reply', name: m[1], version: Number(m[2]), board: board[1], channels: Number(channels[1]) };
}
/**
 * @description The lines that stream a compiled pulse table: delta frames with periodic keyframes.
 * @param outputs - Output number per column.
 * @param pulses - Pulse microseconds per frame, per column.
 * @param startSeq - First sequence number.
 * @returns One encoded line per frame.
 */
function frameLines(outputs, pulses, startSeq = 1) {
    const lines = [];
    let previous = null;
    pulses.forEach((row, f) => {
        const full = previous === null || f % exports.KEYFRAME_EVERY === 0;
        const pairs = [];
        row.forEach((us, i) => { if (full || us !== previous[i])
            pairs.push([outputs[i], us]); });
        lines.push(encodeFrame(startSeq + f, pairs));
        previous = row;
    });
    return lines;
}
/** @description Split a byte stream into complete lines, keeping the remainder. */
function splitLines(buffer) {
    const parts = buffer.split('\n');
    const rest = parts.pop() ?? '';
    return { lines: parts.filter((l) => l.trim().length > 0), rest };
}
/** @description The protocol as the capabilities route publishes it. */
function describeProtocol() {
    return {
        name: exports.PROTOCOL_NAME, version: exports.PROTOCOL_VERSION, framing: 'ASCII line, `*XX` XOR checksum of the body, LF', baud: 115200, keyframeEvery: exports.KEYFRAME_EVERY, watchdogMs: exports.WATCHDOG_MS,
        host: { H: 'hello', 'L ch min max': 'controller-side pulse clamps', 'F seq ch=us,…': 'frame (delta; empty = heartbeat)', E: 'e-stop: outputs off, latched', R: 'release e-stop' },
        controller: { 'HELLO name/ver board= channels=': 'hello reply', 'OK ref': 'acknowledged', 'ERR ref reason': 'refused', ESTOP: 'outputs are off' },
        example: { frame: encodeFrame(7, [[0, 1500], [1, 1720]]).trim(), hello: (0, exports.encodeHello)().trim() },
    };
}
