/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the controller link: Web Serial from the
 *                     |                             | page to the ESP32 / Arduino (the ServoEye / Phil split: the
 *                     |                             | PC thinks, the microcontroller drives). Every browser object
 *                     |                             | is a parameter (serial, timers, clock, text codecs) so the
 *                     |                             | same module runs under plain node against a fake port. It
 *                     |                             | sends the exact lines the server hands back — never composes
 *                     |                             | a pulse — paces a stream at the frame period, reads the
 *                     |                             | controller's replies through the shared protocol parser, and
 *                     |                             | E-STOP aborts any stream and goes out ahead of everything.
 *                     |                             | UMD: window.AnimatronicsSerial + module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimatronicsSerial = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @description Create a controller link.
   * @param {object} deps - { serial, protocol, onMessage, onState, now, setTimeout, clearTimeout, TextEncoder, TextDecoder, baud }
   * @returns {object} The link: connect, disconnect, send, sendLines, stream, estop, release, state, hello, counters.
   */
  function createControllerLink(deps) {
    const serial = deps.serial;
    const protocol = deps.protocol;
    const onMessage = deps.onMessage || function () {};
    const onState = deps.onState || function () {};
    const now = deps.now || (() => Date.now());
    const wait = (ms) => new Promise((resolve) => (deps.setTimeout || setTimeout)(resolve, ms));
    const Enc = deps.TextEncoder || TextEncoder; const Dec = deps.TextDecoder || TextDecoder;
    const encoder = new Enc();
    const link = { state: 'disconnected', hello: null, counters: { sent: 0, ok: 0, err: 0, invalid: 0 }, lastError: null };
    let port = null; let writer = null; let reader = null; let streaming = null; let readLoop = null;

    function setState(next) { link.state = next; onState(next, link); }

    async function readForever() {
      const decoder = new Dec();
      let rest = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const split = protocol.splitLines(rest + decoder.decode(value, { stream: true }));
          rest = split.rest;
          for (const line of split.lines) handle(protocol.parseLine(line));
        }
      } catch (error) {
        if (link.state !== 'disconnected') { link.lastError = String(error && error.message || error); setState('disconnected'); }
      }
    }

    function handle(msg) {
      if (msg.kind === 'ok') link.counters.ok += 1;
      else if (msg.kind === 'err') { link.counters.err += 1; link.lastError = msg.reason; }
      else if (msg.kind === 'invalid') link.counters.invalid += 1;
      else if (msg.kind === 'hello-reply') link.hello = msg;
      else if (msg.kind === 'estopped') setState('estopped');
      onMessage(msg, link);
    }

    /** @description Ask the person for a port and open it. */
    async function connect() {
      if (!serial || typeof serial.requestPort !== 'function') throw new Error('Web Serial is not available here — use a Chromium desktop browser over HTTPS or localhost');
      setState('connecting');
      try {
        port = await serial.requestPort();
        await port.open({ baudRate: deps.baud || 115200 });
        writer = port.writable.getWriter();
        reader = port.readable.getReader();
        readLoop = readForever();
        setState('connected');
      } catch (error) { link.lastError = String(error && error.message || error); setState('disconnected'); throw error; }
    }

    /** @description Stop any stream, release the port. */
    async function disconnect() {
      if (streaming) streaming.abort = true;
      setState('disconnected');
      try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (_) { /* closing */ }
      try { if (writer) { writer.releaseLock(); } } catch (_) { /* closing */ }
      try { if (port) await port.close(); } catch (_) { /* closing */ }
      if (readLoop) { try { await readLoop; } catch (_) { /* closed */ } }
      port = null; writer = null; reader = null; readLoop = null; link.hello = null;
    }

    /** @description Write one protocol line (already checksummed by the server). */
    async function send(line) {
      if (!writer) throw new Error('controller is not connected');
      await writer.write(encoder.encode(line.endsWith('\n') ? line : line + '\n'));
      link.counters.sent += 1;
    }
    async function sendLines(lines) { for (const line of lines) await send(line); }

    /**
     * @description Stream frame lines at the frame period. Resolves {sent, aborted}.
     * @param {string[]} lines - One line per frame.
     * @param {number} frameMs - Period.
     * @param {object} [opts] - { onProgress(i) }
     */
    async function stream(lines, frameMs, opts) {
      if (!writer) throw new Error('controller is not connected');
      if (streaming) streaming.abort = true;
      const me = { abort: false }; streaming = me;
      setState('streaming');
      const start = now();
      let sent = 0;
      for (let i = 0; i < lines.length; i += 1) {
        if (me.abort) break;
        const due = start + i * frameMs;
        const delay = due - now();
        if (delay > 0) await wait(delay);
        if (me.abort) break;
        await send(lines[i]);
        sent += 1;
        if (opts && opts.onProgress) opts.onProgress(i, lines.length);
      }
      if (streaming === me) { streaming = null; if (link.state === 'streaming') setState('connected'); }
      return { sent, aborted: me.abort };
    }

    /** @description E-STOP: abort any stream and send the stop line ahead of everything. */
    async function estop(line) {
      if (streaming) streaming.abort = true;
      setState('estopped');
      if (writer) await send(line);
    }
    /** @description Release the controller's e-stop latch (the rig still has to be armed again). */
    async function release(line) { await send(line); setState('connected'); }

    return Object.assign(link, { connect, disconnect, send, sendLines, stream, estop, release, isConnected: () => Boolean(writer) });
  }

  /** @description Is Web Serial available in this browser? */
  function supported(nav) { const n = nav || (typeof navigator !== 'undefined' ? navigator : null); return Boolean(n && n.serial && typeof n.serial.requestPort === 'function'); }

  return { createControllerLink, supported };
}));
