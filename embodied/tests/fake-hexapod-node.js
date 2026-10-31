/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-202 (lane L4): the front of the spider-18 node double — start the worker (role node: the hexapod rail over a kinematic stand-in; role api: a fake controller api for a real Python node), hand back its endpoint, the heartbeat it would send (for a fleet fed directly), the command-key knob, the counters and close. Not a test file: the store-ci glob is engine-*.test.js.
 */
'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

/** Start the worker in a role and wait for its endpoint; `once(type)` awaits one message of that type. */
async function startWorker(role, opts) {
  const worker = new Worker(path.join(__dirname, 'fake-hexapod-node-worker.js'), { workerData: { role, ...opts } });
  const listeners = new Set();
  worker.on('message', (m) => { for (const l of listeners) l(m); });
  const once = (type, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { listeners.delete(l); reject(new Error(`fake hexapod ${role}: no ${type} within ${timeoutMs} ms`)); }, timeoutMs);
    const l = (m) => { if (m.type === type) { clearTimeout(t); listeners.delete(l); resolve(m); } };
    listeners.add(l);
  });
  const listening = once('listening');
  worker.on('error', (e) => { throw e; });
  const { port, endpointUrl } = await listening;
  const close = async () => { worker.postMessage('close'); await new Promise((r) => { worker.once('exit', r); setTimeout(() => { void worker.terminate(); }, 2000).unref(); }); };
  return { worker, port, endpointUrl, once, close };
}

/**
 * Start a hexapod node double. `opts`: nodeId, kind (what its hello claims; `hexapod` by default), hasSpring, tickHz,
 * buildHash, commandKey (a key it accepts from the start; a suite normally hands one in with `acceptCommandKey`).
 */
async function startFakeHexapodNode(opts = {}) {
  const w = await startWorker('node', { nodeId: 'fake-hexapod', ...opts });
  const cfg = { kind: 'hexapod', buildHash: 'fake-hexapod-build', nodeId: 'fake-hexapod', ...opts };
  return {
    ...w,
    /** The heartbeat body this node would send, for a fleet fed directly by a suite. */
    heartbeat: () => ({ nodeId: cfg.nodeId, kind: cfg.kind, endpointUrl: w.endpointUrl, protocol: 1, engine: 'hexapod-fake', version: '0.1.0', buildHash: cfg.buildHash, sessions: 1, telemetry: null, events: [] }),
    /** Give the node the command key a fleet minted for it. */
    acceptCommandKey: async (key) => { const p = w.once('command-key-set'); w.worker.postMessage({ type: 'command-key', key }); return p; },
    stats: async () => { const p = w.once('stats'); w.worker.postMessage('stats'); return p; },
  };
}

/**
 * Start a fake controller api: it answers a node's heartbeat (Authorization: Bearer `credential`) with `commandKey`
 * and reports every heartbeat body it received through `nextHeartbeat`.
 */
async function startFakeNodeApi({ credential, commandKey }) {
  const w = await startWorker('api', { credential, commandKey });
  return { ...w, url: w.endpointUrl, nextHeartbeat: (timeoutMs) => w.once('heartbeat', timeoutMs) };
}

module.exports = { startFakeHexapodNode, startFakeNodeApi };
