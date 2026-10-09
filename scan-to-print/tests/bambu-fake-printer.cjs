/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com | `tls13Hangs` plays the broker behaviour reported for P2S firmware 01.02.00.00 (ha-bambulab #2072), and the same on the file server and its data channel so the upload cap is proven too: each reads the client's whole first TLS record and never answers one that offers TLS 1.3 (the client's handshake hangs), while one capped at TLS 1.2 is served at once; `tls13HellosIgnored` counts the hellos sat on.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Second review: `stateDelayMs` delays the busy state push after an accepted start (a printer that answers before its state moves), and `malformedAck` answers a start with a report whose fields are objects, not primitives.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review fixes: expose the fake's own certificate fingerprint (tests pin it, or pin another one to play an impostor) and record every credential it receives (so a refused impostor is proven to have received none); accept the client's real transfer order (plain TCP data socket, STOR, then TLS on that socket after 150) and survive a data socket that is dropped without TLS; optionally broadcast another client's successful project_file answer before answering ours.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A fake Bambu Lab printer on real local TLS sockets, so the LAN client is proven across the protocol boundary it claims (CLAUDE.md integration-boundary corollary) rather than against a mocked socket: an MQTT 3.1.1 broker (CONNECT with bblp + access code, SUBSCRIBE, PUBLISH pushall / project_file) and an implicit-FTPS server (USER/PASS/PBSZ/PROT/TYPE/PASV/STOR/SIZE) whose data channel REFUSES a TLS session that does not resume the control session, exactly like the printer's vsftpd. The certificates are minted per run with the openssl CLI the way the vendor's are shaped (leaf CN = serial, issuer "BBL Device CA <model>-V2"); nothing private is committed. A missing openssl fails loudly rather than skipping.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const net = require('node:net');

/** Mint a vendor-shaped CA + leaf with openssl. */
function mintCertificates(serial, model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bambu-'));
  const run = (args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  try {
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', `/CN=BBL Device CA ${model}-V2`, '-days', '2']);
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/CN=${serial}`]);
    run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.crt', '-days', '2']);
  } catch (error) {
    throw new Error(`the fake printer needs the openssl CLI to mint its certificates: ${error.message}`);
  }
  const out = { key: fs.readFileSync(path.join(dir, 'leaf.key')), cert: fs.readFileSync(path.join(dir, 'leaf.crt')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function encodeLength(n) { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n > 0) x |= 0x80; b.push(x); } while (n > 0); return Buffer.from(b); }
function str(t) { const body = Buffer.from(t, 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(body.length); return Buffer.concat([h, body]); }
function publish(topic, payload) { const body = Buffer.concat([str(topic), Buffer.from(JSON.stringify(payload), 'utf8')]); return Buffer.concat([Buffer.from([0x30]), encodeLength(body.length), body]); }

/** Split client bytes into MQTT packets. */
function packets(state, chunk) {
  state.buf = Buffer.concat([state.buf, chunk]);
  const out = [];
  for (;;) {
    if (state.buf.length < 2) break;
    let len = 0, mul = 1, i = 1, done = false;
    while (i < state.buf.length && i < 5) { const b = state.buf[i++]; len += (b & 0x7f) * mul; mul *= 128; if (!(b & 0x80)) { done = true; break; } }
    if (!done || i + len > state.buf.length) break;
    out.push({ type: state.buf[0] >> 4, body: state.buf.subarray(i, i + len) });
    state.buf = state.buf.subarray(i + len);
  }
  return out;
}

/** The CONNECT packet's username and password. */
function credentials(body) {
  let at = 2 + body.readUInt16BE(0) + 4;
  const read = () => { const n = body.readUInt16BE(at); const v = body.subarray(at + 2, at + 2 + n).toString('utf8'); at += 2 + n; return v; };
  read(); // client id
  return { user: read(), pass: read() };
}

function reportFor(printer) {
  return { print: { command: 'push_status', msg: 0, sequence_id: '1', ...printer.status } };
}

/** Does a complete ClientHello record offer TLS 1.3 (0x0304 in its supported_versions extension)? An odd one offers nothing. */
function offersTls13(hello) {
  try {
    if (hello[0] !== 0x16 || hello[5] !== 0x01) return false;
    let i = 5 + 4 + 2 + 32;                 // record header, handshake header, client_version, random
    i += 1 + hello[i];                       // session id
    i += 2 + hello.readUInt16BE(i);          // cipher suites
    i += 1 + hello[i];                       // compression methods
    const end = i + 2 + hello.readUInt16BE(i);
    for (i += 2; i + 4 <= end; i += 4 + hello.readUInt16BE(i + 2)) {
      if (hello.readUInt16BE(i) !== 0x002b) continue;
      for (let j = i + 5; j + 1 < i + 4 + hello.readUInt16BE(i + 2); j += 2) if (hello.readUInt16BE(j) === 0x0304) return true;
    }
  } catch (_) { /* fall through */ }
  return false;
}

/** Bytes the first TLS handshake record needs (header + body); 0 while unknown or when it is not one. */
function handshakeRecordLength(buf) { return buf.length >= 5 && buf[0] === 0x16 ? 5 + buf.readUInt16BE(3) : 0; }

/**
 * Front a TLS server with the reported 01.02.00.00 broker behaviour: read the client's whole first record (a
 * hello may arrive in pieces), never answer one that offers TLS 1.3, and hand anything else to the server untouched.
 */
function tls13HangingGate(printer, server) {
  const held = new Set();
  const gate = net.createServer((socket) => {
    socket.on('error', () => {});
    let buf = Buffer.alloc(0);
    const pass = () => { socket.off('data', onData); socket.pause(); socket.unshift(buf); server.emit('connection', socket); };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const need = handshakeRecordLength(buf);
      if (buf.length >= 5 && need === 0) { pass(); return; }   // not a TLS handshake: the server answers it as it would
      if (need === 0 || buf.length < need) return;              // the rest of the hello is still on its way
      if (!offersTls13(buf)) { pass(); return; }
      socket.off('data', onData); printer.tls13HellosIgnored += 1; held.add(socket); socket.on('close', () => held.delete(socket));
    };
    socket.on('data', onData);
  });
  gate.releaseHeld = () => { for (const s of held) s.destroy(); };
  return gate;
}

/** The MQTT side. */
function mqttServer(printer, creds) {
  return tls.createServer(creds, (socket) => {
    const state = { buf: Buffer.alloc(0) };
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      for (const p of packets(state, chunk)) {
        if (p.type === 1) {
          const c = credentials(p.body);
          printer.credentialsSeen.push({ via: 'mqtt', user: c.user, pass: c.pass });
          const ok = c.user === 'bblp' && c.pass === printer.accessCode;
          socket.write(Buffer.from([0x20, 0x02, 0x00, ok ? 0x00 : 0x05]));
          if (!ok) socket.end();
        } else if (p.type === 8) {
          socket.write(Buffer.from([0x90, 0x03, p.body[0], p.body[1], 0x00]));
        } else if (p.type === 3) {
          const topicLen = p.body.readUInt16BE(0);
          const topic = p.body.subarray(2, 2 + topicLen).toString('utf8');
          const msg = JSON.parse(p.body.subarray(2 + topicLen).toString('utf8'));
          printer.requests.push({ topic, msg });
          const report = `device/${printer.serial}/report`;
          if (msg.pushing && msg.pushing.command === 'pushall') socket.write(publish(report, reportFor(printer)));
          if (msg.print && msg.print.command === 'project_file') {
            const accepted = printer.acceptStart;
            if (printer.malformedAck) {
              socket.write(publish(report, { print: { command: 'project_file', sequence_id: { toString: 0 }, result: { toString: 0 } } }));
              socket.write(publish(report, { print: { command: 'push_status', gcode_state: { toString: 0 }, subtask_name: msg.print.subtask_name } }));
              continue;
            }
            if (printer.foreignAck) socket.write(publish(report, { print: { command: 'project_file', sequence_id: 'someone-else-1', result: 'success', reason: '' } }));
            socket.write(publish(report, { print: { command: 'project_file', sequence_id: msg.print.sequence_id, result: accepted ? 'success' : 'fail', reason: accepted ? '' : 'refused by fake printer' } }));
            if (accepted) {
              const moveState = () => { printer.status = { ...printer.status, gcode_state: 'PREPARE', subtask_name: msg.print.subtask_name }; if (!socket.destroyed) socket.write(publish(report, reportFor(printer))); };
              if (printer.stateDelayMs) setTimeout(moveState, printer.stateDelayMs); else moveState();
            }
          }
        } else if (p.type === 14) {
          socket.end();
        }
      }
    });
  });
}

/** The implicit-FTPS side, with a data channel that requires TLS session reuse. */
function ftpsServer(printer, creds) {
  // The data channel reports one result per transfer; STOR waits for it whichever arrives first.
  const deliver = (result) => { if (printer._onData) { const f = printer._onData; printer._onData = null; f(result); } else printer._dataResult = result; };
  const data = tls.createServer(creds, (socket) => {
    socket.on('error', () => {});
    printer.dataConnections += 1;
    if (!socket.isSessionReused()) { printer.unreusedDataConnections += 1; socket.destroy(); deliver({ ok: false }); return; }
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => deliver({ ok: true, bytes: Buffer.concat(chunks) }));
  });
  const control = tls.createServer(creds, (socket) => {
    socket.on('error', () => {});
    socket.write('220 (vsFTPd 3.0.5)\r\n');
    let buf = '';
    let user = null, authed = false;
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const [cmd, ...rest] = line.split(' '); const arg = rest.join(' ');
        const say = (t) => socket.write(t + '\r\n');
        if (cmd === 'USER') { user = arg; say('331 Please specify the password.'); }
        else if (cmd === 'PASS') { printer.credentialsSeen.push({ via: 'ftps', user, pass: arg }); authed = user === 'bblp' && arg === printer.accessCode; say(authed ? '230 Login successful.' : '530 Login incorrect.'); }
        else if (!authed) say('530 Please login with USER and PASS.');
        else if (cmd === 'PBSZ') say('200 PBSZ set to 0.');
        else if (cmd === 'PROT') say('200 PROT now Private.');
        else if (cmd === 'TYPE') say('200 Switching to Binary mode.');
        else if (cmd === 'PASV') { const port = printer._dataPort || data.address().port; say(`227 Entering Passive Mode (10,0,0,9,${port >> 8},${port & 255}).`); }
        else if (cmd === 'STOR') {
          if (!printer.storage) { say('553 Could not create file.'); continue; }
          say('150 Ok to send data.');
          const finish = (result) => { if (result.ok) { printer.files.set(arg, result.bytes); say('226 Transfer complete.'); } else say('522 SSL connection failed: session reuse required'); };
          if (printer._dataResult) { const r = printer._dataResult; printer._dataResult = null; finish(r); } else printer._onData = finish;
        }
        else if (cmd === 'SIZE') { const f = printer.files.get(arg); say(f ? `213 ${f.length}` : '550 Could not get file size.'); }
        else if (cmd === 'QUIT') { say('221 Goodbye.'); socket.end(); }
        else say('502 Command not implemented.');
      }
    });
  });
  data.on('tlsClientError', () => {});   // a data socket dropped before TLS (a refused STOR) is not an error here
  return { control, data };
}

/**
 * Start a fake printer. Returns its state (mutable: status, storage, acceptStart), the requests it
 * received, the files it stored, and a `connect` seam that maps the client's (host, 8883/990/PASV
 * port) onto the local servers.
 */
async function startFakePrinter(opts = {}) {
  const serial = opts.serial || '01S00FAKE000001';
  const model = opts.model || 'N7';
  const creds = { ...mintCertificates(serial, model), ticketKeys: crypto.randomBytes(48) };
  const certSha256 = new crypto.X509Certificate(creds.cert).fingerprint256;
  const printer = {
    serial, model, certSha256, accessCode: opts.accessCode || 'fake1234', storage: opts.storage !== false, acceptStart: opts.acceptStart !== false,
    foreignAck: opts.foreignAck === true, malformedAck: opts.malformedAck === true, stateDelayMs: opts.stateDelayMs || 0, credentialsSeen: [], dataConnections: 0, tls13HellosIgnored: 0,
    requests: [], files: new Map(), unreusedDataConnections: 0, _dataResult: null, _onData: null,
    status: { gcode_state: 'IDLE', mc_percent: 0, mc_remaining_time: 0, layer_num: 0, total_layer_num: 0, subtask_name: '', sdcard: true,
      fun: opts.signatureRequired === false ? '64029FD183FF9CB3' : '64029FD1A3FF9CB3', print_error: 0, hms: [], nozzle_diameter: '0.4',
      ams: { tray_exist_bits: '8', ams: [{ id: '0', tray: [{ id: '0' }, { id: '1' }, { id: '2' }, { id: '3', tray_type: 'PLA' }] }] }, ...(opts.status || {}) },
  };
  const mqtt = mqttServer(printer, creds);
  const ftps = ftpsServer(printer, creds);
  const gates = opts.tls13Hangs ? { mqtt: tls13HangingGate(printer, mqtt), control: tls13HangingGate(printer, ftps.control), data: tls13HangingGate(printer, ftps.data) } : null;
  const front = (name, server) => (gates ? gates[name] : server);
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await Promise.all([listen(mqtt), listen(ftps.control), listen(ftps.data), ...(gates ? Object.values(gates).map(listen) : [])]);
  printer._dataPort = front('data', ftps.data).address().port;
  const ports = { 8883: front('mqtt', mqtt).address().port, 990: front('control', ftps.control).address().port };
  const connect = (options) => {
    // TLS on an open data socket: the same host mapping as the control connection, because a TLS
    // session resumes only for the host it was made with (as on the real network).
    if (options.socket) return tls.connect({ ...options, host: '127.0.0.1', servername: undefined });
    const port = ports[options.port] ?? options.port;
    return tls.connect({ ...options, host: '127.0.0.1', port, servername: undefined });
  };
  const connectTcp = (_host, port) => net.connect({ host: '127.0.0.1', port });
  const close = () => {
    const extra = gates ? Object.values(gates) : [];
    extra.forEach((g) => g.releaseHeld());
    return Promise.all([mqtt, ftps.control, ftps.data, ...extra].map((s) => new Promise((r) => { s.close(() => r()); setImmediate(r); })));
  };
  return { printer, connect, connectTcp, close, host: '192.168.1.250' };
}

module.exports = { startFakePrinter };
