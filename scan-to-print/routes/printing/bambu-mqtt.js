"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the MQTT 3.1.1 subset a Bambu Lab printer's
 *                     |                             | LAN broker needs (CONNECT as `bblp` with the LAN access code,
 *                     |                             | SUBSCRIBE to its report topic, PUBLISH QoS 0 to its request
 *                     |                             | topic, DISCONNECT) over node:tls, so the package adds no
 *                     |                             | dependency. The broker's certificate is the printer's own
 *                     |                             | device certificate (self-signed by the vendor's device CA), so
 *                     |                             | the chain is not verified; instead the session refuses, BEFORE
 *                     |                             | the access code is written, any peer whose certificate is not
 *                     |                             | the one pinned when the printer was added (SHA-256 fingerprint)
 *                     |                             | or whose name is not the printer's serial. A name alone is not
 *                     |                             | a pin: the serial is public on the LAN.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A waiter's predicate that throws on a malformed report is treated
 *                     |                             | as no match: nothing a broker relays may throw out of the socket
 *                     |                             | 'data' handler and take the api process down.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Offer the broker TLS 1.2 at most (BAMBU_MAX_TLS, which the file
 *                     |                             | server uses too). A P2S on
 *                     |                             | firmware 01.02.00.00 was reported never to answer a ClientHello
 *                     |                             | that offers TLS 1.3 on :8883 (the handshake hangs until the
 *                     |                             | connect timeout) while answering TLS 1.2 at once (ha-bambulab
 *                     |                             | #2072). A P2S on 01.01.02.00 negotiated 1.3 by default and
 *                     |                             | served status capped at 1.2, measured 2026-10-06.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BambuMqttSession = exports.BAMBU_MAX_TLS = void 0;
exports.encodeLength = encodeLength;
exports.connectPacket = connectPacket;
exports.subscribePacket = subscribePacket;
exports.publishPacket = publishPacket;
exports.splitPackets = splitPackets;
exports.printerPinMismatch = printerPinMismatch;
const node_tls_1 = __importDefault(require("node:tls"));
/**
 * @description The highest TLS version offered to a Bambu Lab printer, on its broker (:8883) and its file
 * server (:990). A P2S on firmware 01.02.00.00 was reported to hang on a TLS 1.3 ClientHello to its broker
 * while answering TLS 1.2 at once; its file server speaks only TLS 1.2.
 */
exports.BAMBU_MAX_TLS = 'TLSv1.2';
/**
 * @description Encode an MQTT "remaining length" varint.
 * @param length - Byte count to encode.
 * @returns The 1–4 byte varint.
 */
function encodeLength(length) {
    const bytes = [];
    let value = length;
    do {
        let byte = value % 128;
        value = Math.floor(value / 128);
        if (value > 0)
            byte |= 0x80;
        bytes.push(byte);
    } while (value > 0);
    return Buffer.from(bytes);
}
/** @description A UTF-8 string with its two-byte length prefix. */
function mqttString(text) {
    const body = Buffer.from(text, 'utf8');
    const head = Buffer.alloc(2);
    head.writeUInt16BE(body.length, 0);
    return Buffer.concat([head, body]);
}
/** @description One packet: fixed header byte + remaining length + body. */
function packet(type, body) {
    return Buffer.concat([Buffer.from([type]), encodeLength(body.length), body]);
}
/**
 * @description CONNECT, protocol level 4, flags 0xc2 (username + password + clean session), 30 s keepalive.
 * @param clientId - Client identifier.
 * @param username - Broker user (`bblp`).
 * @param password - LAN access code.
 * @returns The packet bytes.
 */
function connectPacket(clientId, username, password) {
    const header = Buffer.concat([mqttString('MQTT'), Buffer.from([0x04, 0xc2, 0x00, 0x1e])]);
    return packet(0x10, Buffer.concat([header, mqttString(clientId), mqttString(username), mqttString(password)]));
}
/**
 * @description SUBSCRIBE (packet id 1) to one topic at QoS 0.
 * @param topic - Topic filter.
 * @returns The packet bytes.
 */
function subscribePacket(topic) {
    return packet(0x82, Buffer.concat([Buffer.from([0x00, 0x01]), mqttString(topic), Buffer.from([0x00])]));
}
/**
 * @description PUBLISH at QoS 0 (no packet id).
 * @param topic - Topic name.
 * @param payload - Message body (JSON text).
 * @returns The packet bytes.
 */
function publishPacket(topic, payload) {
    return packet(0x30, Buffer.concat([mqttString(topic), Buffer.from(payload, 'utf8')]));
}
/**
 * @description Split a byte stream into MQTT packets; a partial tail waits for more bytes.
 * @param buffer - Bytes received so far.
 * @returns Complete packets and the unconsumed rest.
 */
function splitPackets(buffer) {
    const packets = [];
    let offset = 0;
    while (offset + 2 <= buffer.length) {
        let length = 0;
        let multiplier = 1;
        let index = offset + 1;
        let complete = false;
        while (index < buffer.length && index < offset + 5) {
            const byte = buffer[index++];
            length += (byte & 0x7f) * multiplier;
            multiplier *= 128;
            if ((byte & 0x80) === 0) {
                complete = true;
                break;
            }
        }
        if (!complete || index + length > buffer.length)
            break;
        packets.push({ type: buffer[offset] >> 4, flags: buffer[offset] & 0x0f, body: buffer.subarray(index, index + length) });
        offset = index + length;
    }
    return { packets, rest: buffer.subarray(offset) };
}
/** @description The JSON payload of an inbound PUBLISH, or null. */
function publishPayload(p) {
    if (p.type !== 3 || p.body.length < 2)
        return null;
    const topicLength = p.body.readUInt16BE(0);
    const qos = (p.flags >> 1) & 0x03;
    const start = 2 + topicLength + (qos > 0 ? 2 : 0);
    try {
        const parsed = JSON.parse(p.body.subarray(start).toString('utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * @description Why a TLS peer is not the pinned printer, or null when it is.
 * @param socket - The connected socket.
 * @param host - The address dialled, for the message.
 * @param serial - Expected certificate CN.
 * @param certSha256 - Expected certificate fingerprint.
 * @returns A refusal reason, or null.
 */
function printerPinMismatch(socket, host, serial, certSha256) {
    const cert = socket.getPeerCertificate();
    const cn = cert && cert.subject ? cert.subject.CN : null;
    if (cn !== serial)
        return `the device at ${host} identifies as ${typeof cn === 'string' ? cn : 'nothing'}, not printer ${serial}`;
    if (!certSha256 || !cert || cert.fingerprint256 !== certSha256) {
        return `the device at ${host} is not presenting the certificate this printer had when it was added; if the printer was replaced or reset, remove it and add it again`;
    }
    return null;
}
/** @description Apply a predicate to a relayed report; a predicate that throws is no match. */
function matches(match, report) {
    try {
        return match(report) === true;
    }
    catch {
        return false;
    }
}
/**
 * @description One broker session: connect, subscribe to the report topic, then publish requests
 * and wait for matching reports. Always `close()` it.
 */
class BambuMqttSession {
    endpoint;
    options;
    socket = null;
    connected = false;
    buffer = Buffer.alloc(0);
    waiters = [];
    reports = [];
    constructor(endpoint, options = {}) {
        this.endpoint = endpoint;
        this.options = options;
    }
    /**
     * @description Connect, refuse anything but the pinned printer, authenticate and subscribe.
     * @returns Resolves when subscribed; rejects with a reason a person can act on.
     */
    open() {
        const { host, serial, certSha256, accessCode } = this.endpoint;
        const connect = this.options.connect ?? node_tls_1.default.connect;
        const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error) => { if (settled)
                return; settled = true; clearTimeout(timer); this.close(); reject(error); };
            const timer = setTimeout(() => fail(new Error(`printer broker at ${host} did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
            const socket = connect({ host, port: this.options.port ?? 8883, rejectUnauthorized: false, maxVersion: exports.BAMBU_MAX_TLS });
            this.socket = socket;
            socket.on('error', (error) => fail(new Error(`printer broker connection failed: ${error.message}`)));
            socket.on('close', () => fail(new Error('the printer closed the connection')));
            socket.once('secureConnect', () => {
                const mismatch = printerPinMismatch(socket, host, serial, certSha256);
                if (mismatch) {
                    fail(new Error(mismatch));
                    return;
                }
                socket.write(connectPacket(`oshal-${process.pid}-${Math.floor(Math.random() * 1e9)}`, 'bblp', accessCode));
            });
            socket.on('data', (chunk) => this.onData(chunk, (ok, why) => {
                if (!ok) {
                    fail(new Error(why));
                    return;
                }
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve();
            }));
        });
    }
    onData(chunk, ready) {
        const { packets, rest } = splitPackets(Buffer.concat([this.buffer, chunk]));
        this.buffer = rest;
        for (const p of packets) {
            if (p.type === 2) {
                const code = p.body[1];
                if (code !== 0) {
                    ready(false, code === 4 || code === 5 ? 'the printer refused the LAN access code' : `the printer refused the connection (code ${code})`);
                    return;
                }
                this.socket?.write(subscribePacket(`device/${this.endpoint.serial}/report`));
            }
            else if (p.type === 9 && !this.connected) {
                this.connected = true;
                ready(true, '');
            }
            else {
                const report = publishPayload(p);
                if (report)
                    this.deliver(report);
            }
        }
    }
    deliver(report) {
        this.reports.push(report);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
            if (matches(this.waiters[i].match, report))
                this.waiters.splice(i, 1)[0].resolve(report);
        }
    }
    /**
     * @description Publish one request JSON on the printer's request topic.
     * @param payload - Request JSON (published on `device/<serial>/request`).
     * @throws Error when the session is not open.
     */
    publish(payload) {
        if (!this.socket || !this.connected)
            throw new Error('printer broker session is not open');
        this.socket.write(publishPacket(`device/${this.endpoint.serial}/request`, JSON.stringify(payload)));
    }
    /**
     * @description Wait for the first report (already received or still to come) that matches.
     * @param match - Predicate over a report.
     * @param timeoutMs - Give up after this long.
     * @returns The report, or null on timeout.
     */
    waitFor(match, timeoutMs) {
        const seen = this.reports.find((r) => matches(match, r));
        if (seen)
            return Promise.resolve(seen);
        return new Promise((resolve) => {
            const waiter = { match, resolve: (r) => { clearTimeout(timer); resolve(r); } };
            const timer = setTimeout(() => { const i = this.waiters.indexOf(waiter); if (i >= 0)
                this.waiters.splice(i, 1); resolve(null); }, timeoutMs);
            this.waiters.push(waiter);
        });
    }
    /** @description Drop the reports seen so far (before publishing a request whose answer must be fresh). */
    clearReports() { this.reports.length = 0; }
    /** @description Send DISCONNECT and close the socket. */
    close() {
        const socket = this.socket;
        this.socket = null;
        if (!socket)
            return;
        try {
            if (this.connected)
                socket.write(Buffer.from([0xe0, 0x00]));
        }
        catch { /* closing anyway */ }
        socket.destroy();
    }
}
exports.BambuMqttSession = BambuMqttSession;
//# sourceMappingURL=bambu-mqtt.js.map