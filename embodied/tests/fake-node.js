/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The node double's front: start the worker-thread node on loopback, hand back its endpoint, the heartbeat it would send (for a fleet fed directly), and the knobs the suites turn (stop/start/force a heartbeat, read the counters, close). Not a test file: the store-ci glob is engine-*.test.js.
 */
'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

/**
 * Start a node double. `opts.apiUrl` (optional) makes it heartbeat into that api's /api/embodied/nodes/heartbeat every
 * `heartbeatMs`; `refuseClone` makes it answer clone with cannot_clone (a body, one instance); `kind`, `buildHash`,
 * `engine`, `version` shape its heartbeat.
 */
async function startFakeNode(opts) {
  const worker = new Worker(path.join(__dirname, 'fake-node-worker.js'), { workerData: { nodeId: 'fake-node', secret: 'test-secret', ...opts } });
  const listeners = new Set();
  worker.on('message', (m) => { for (const l of listeners) l(m); });
  const once = (type, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { listeners.delete(l); reject(new Error(`fake node: no ${type} within ${timeoutMs} ms`)); }, timeoutMs);
    const l = (m) => { if (m.type === type) { clearTimeout(t); listeners.delete(l); resolve(m); } };
    listeners.add(l);
  });
  const listening = once('listening');
  worker.on('error', (e) => { throw e; });
  const { port, endpointUrl } = await listening;
  const cfg = { kind: 'plant', engine: 'fake', version: '0', buildHash: 'fake-build', ...opts };
  return {
    worker, port, endpointUrl,
    /** The heartbeat body this node sends, for a fleet fed directly by a suite. */
    heartbeat: () => ({ nodeId: cfg.nodeId ?? 'fake-node', kind: cfg.kind, endpointUrl, protocol: 1, engine: cfg.engine, version: cfg.version, buildHash: cfg.buildHash, sessions: 0, telemetry: null, events: [] }),
    stopHeartbeat: () => worker.postMessage('stop-heartbeat'),
    startHeartbeat: () => worker.postMessage('start-heartbeat'),
    heartbeatNow: async () => { const p = once('heartbeat'); worker.postMessage('heartbeat-now'); return p; },
    nextHeartbeat: (timeoutMs) => once('heartbeat', timeoutMs),
    stats: async () => { const p = once('stats'); worker.postMessage('stats'); return p; },
    close: async () => { worker.postMessage('close'); await new Promise((r) => { worker.once('exit', r); setTimeout(() => { void worker.terminate(); }, 2000).unref(); }); },
  };
}

module.exports = { startFakeNode };
