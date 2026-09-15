/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The relay role over real loopback HTTP (backlog B11 on B1's shape): four node doubles — a controller double at the base, two relay doubles and a tip double — each a node:http server running the package's RelayRole behind one envelope endpoint, with every link a switch the test throws and every clock the test's. A command walks base → r1 → r2 → tip and the tip's reply comes back the reverse route; with the r2–tip link cut the controller's status query is answered by r2 as proxy (r2's key, the tip's last heartbeat carried untouched and still verifiable with the tip's key, its age stamped); a command waits at r2 and is delivered — on its original MAC, inside the tip's replay window — the moment the tip is heard again, and its reply reaches the base; a command held past the window is dropped at r2 naming why and the tip never runs it.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install): node:http on
 * 127.0.0.1 only, no framework, no timers — every timestamp comes from the test's own clock.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const WINDOW_MS = 30_000;
/** Each node's key shared with the base from enrolment (the base holds them all). */
const KEYS = { r1: 'k-r1', r2: 'k-r2', tip: 'k-tip' };
const clock = { now: 1_700_000_000_000 };
const cut = new Set();
const linkKey = (a, b) => [a, b].sort().join('|');
const peers = {};
const nodes = {};

/** POST one envelope to a peer's endpoint; the answer is that node's own action summary. */
async function send(to, env) {
  const res = await fetch(`${peers[to]}/relay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
  assert.equal(res.status, 200, `${to} answered ${res.status}`);
  return res.json();
}

/**
 * A node double: one envelope endpoint, the package's RelayRole deciding, the test's switches as
 * its link view. `onDeliver` is the node's own handler — the base records, the tip runs commands.
 */
function nodeDouble(id, onDeliver) {
  const role = new e.RelayRole({ self: id, pairKey: KEYS[id] || 'k-base', replayWindowMs: WINDOW_MS });
  const link = { up: (other) => !cut.has(linkKey(id, other)) };
  const node = { id, role, log: [], delivered: [], link };
  node.server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const env = JSON.parse(body);
    const actions = role.receive(env, clock.now, link);
    for (const a of actions) {
      node.log.push({ action: a.action, id: a.id || (a.env && a.env.id), to: a.to, reason: a.reason });
      if (a.action === 'forward' || a.action === 'proxy-reply') await send(a.to, a.env);
      else if (a.action === 'deliver') { node.delivered.push(a.env); await onDeliver(a.env, node); }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ node: id, actions: actions.map((a) => a.action) }));
  });
  return node;
}

/** The source side of every node: build, sign with its pair key, hand to route[1] as it will receive it. */
async function originate(kind, route, payload, id, key) {
  assert.ok(!cut.has(linkKey(route[0], route[1])), `${route[0]} cannot send over a cut link`);
  const env = e.signEnvelope(e.buildEnvelope({ kind, route, payload, ts: clock.now, id }), key);
  await send(route[1], e.advance(env));
  return env;
}

const tipReplay = new e.ReplayWindow(WINDOW_MS);
const tipRan = [];

/** The tip runs a command only if it verifies on its own key inside its replay window; it answers inward. */
async function tipHandler(env) {
  if (!e.verifyEnvelope(env, KEYS.tip) || !tipReplay.accept(env, clock.now)) return;
  if (env.kind === 'command') tipRan.push(env.payload.command);
  const back = env.route.slice().reverse();
  await originate('reply', back, { for: env.id, ok: true, status: { battery: 64 } }, `re-${env.id}`, KEYS.tip);
}

const baseInbox = [];
const heartbeat = (id) => originate('heartbeat', ['tip', 'r2', 'r1', 'base'], { battery: 64, s: 1000 }, id, KEYS.tip);
const toTip = ['base', 'r1', 'r2', 'tip'];

test.before(async () => {
  nodes.base = nodeDouble('base', async (env) => { baseInbox.push(env); });
  nodes.r1 = nodeDouble('r1', async () => {});
  nodes.r2 = nodeDouble('r2', async () => {});
  nodes.tip = nodeDouble('tip', tipHandler);
  for (const n of Object.values(nodes)) {
    await new Promise((resolve) => n.server.listen(0, '127.0.0.1', resolve));
    peers[n.id] = `http://127.0.0.1:${n.server.address().port}`;
  }
});

test.after(async () => {
  for (const n of Object.values(nodes)) { n.server.closeAllConnections(); await new Promise((r) => n.server.close(r)); }
});

test('a command walks base → r1 → r2 → tip over loopback HTTP and the reply comes back the reverse route', async () => {
  await heartbeat('hb-1');
  assert.equal(baseInbox.at(-1).kind, 'heartbeat');
  assert.equal(e.verifyEnvelope(baseInbox.at(-1), KEYS.tip), true);
  await originate('command', toTip, { id: 'c0', command: 'hold', args: {} }, 'c0', KEYS.tip);
  assert.deepEqual(tipRan, ['hold']);
  const reply = baseInbox.at(-1);
  assert.deepEqual([reply.kind, reply.src, reply.route], ['reply', 'tip', ['tip', 'r2', 'r1', 'base']]);
  assert.equal(e.verifyEnvelope(reply, KEYS.tip), true);
  assert.deepEqual(nodes.r1.log.filter((l) => l.id === 'c0').map((l) => [l.action, l.to]), [['forward', 'r2']]);
});

test('with the tip out of reach, r2 answers the controller\'s status query by proxy', async () => {
  cut.add(linkKey('r2', 'tip'));
  clock.now += 12_000;
  const before = baseInbox.length;
  await originate('query', toTip, {}, 'q1', KEYS.tip);
  assert.equal(baseInbox.length, before + 1);
  const answer = baseInbox.at(-1);
  assert.deepEqual([answer.kind, answer.src, answer.route, answer.id], ['reply', 'r2', ['r2', 'r1', 'base'], 'proxy-q1']);
  assert.deepEqual(answer.proxy, { for: 'tip', ageS: 12 }, 'the tip was last heard twelve seconds ago');
  assert.equal(e.verifyEnvelope(answer, KEYS.r2), true, 'the controller checks it with r2\'s key');
  assert.equal(e.verifyEnvelope(answer, KEYS.tip), false, 'it is not the tip speaking');
  assert.equal(e.verifyEnvelope(answer.payload, KEYS.tip), true, 'the tip\'s own heartbeat, carried untouched');
  assert.equal(answer.payload.id, 'hb-1');
  assert.deepEqual(nodes.r2.log.filter((l) => l.id === 'proxy-q1').map((l) => [l.action, l.to]), [['proxy-reply', 'r1']]);
});

test('a command queued at r2 is delivered after the link returns, and the tip\'s reply reaches the base', async () => {
  await originate('command', toTip, { id: 'c1', command: 'gotoPoint', args: { s: 950 } }, 'c1', KEYS.tip);
  assert.deepEqual(nodes.r2.log.filter((l) => l.id === 'c1').map((l) => l.action), ['queued']);
  assert.deepEqual(nodes.r2.role.pending().map((p) => p.id), ['c1']);
  assert.deepEqual(tipRan, ['hold'], 'nothing reached the tip while the link was down');
  clock.now += 5_000;
  cut.delete(linkKey('r2', 'tip'));
  await heartbeat('hb-2');
  assert.deepEqual(tipRan, ['hold', 'gotoPoint'], 'released the moment r2 heard the tip, on its original MAC and timestamp');
  assert.deepEqual(nodes.r2.log.filter((l) => l.id === 'c1').map((l) => [l.action, l.to || null]), [['queued', null], ['forward', 'tip']]);
  const reply = baseInbox.find((env) => env.id === 're-c1');
  assert.ok(reply, 'the tip\'s reply to the released command reached the base');
  assert.equal(e.verifyEnvelope(reply, KEYS.tip), true);
  assert.equal(baseInbox.at(-1).id, 'hb-2', 'the heartbeat that brought the link back went on inward');
});

test('a command held past the replay window is dropped at r2 naming why, and the tip never runs it', async () => {
  cut.add(linkKey('r2', 'tip'));
  await originate('command', toTip, { id: 'c2', command: 'land', args: {} }, 'c2', KEYS.tip);
  clock.now += 31_000;
  cut.delete(linkKey('r2', 'tip'));
  await heartbeat('hb-3');
  const drop = nodes.r2.log.find((l) => l.id === 'c2' && l.action === 'drop');
  assert.equal(drop.reason, 'held 31000 ms since it was signed, past the 30000 ms the destination\'s replay window allows: it would be refused as stale');
  assert.equal(tipRan.includes('land'), false);
  assert.equal(baseInbox.some((env) => env.id === 're-c2'), false);
  assert.deepEqual(nodes.r2.role.pending(), []);
});
