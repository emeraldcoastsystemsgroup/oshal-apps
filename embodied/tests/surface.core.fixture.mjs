/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Serve the shipped tile (tools/embodied.html + embodied.js) over the REAL compiled routes on loopback with the framework's shared theme asset, a signed-in identity injected, the world clock driven forward two simulated seconds per state poll, a CAD Studio double that records what the tile posts, and a cockpit stub the hand-off lands on. No database, no engine container, no external traffic: the fixture proves the surface a person clicks against the routes the box mounts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B20: a node double on the rail (a worker thread speaking exactly the Python front's rail) heartbeats into the fixture's real /api/embodied/nodes mount under a fixture secret, so the tile lists it and can reset a world onto it.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const harness = require('./routes.harness.js');
export const coreRoot = harness.CORE;
harness.coreRequire('tsx/cjs');
export const { launchIsolatedBrowser } = harness.coreRequire(path.join(coreRoot, 'tests/fixtures/isolated-browser.ts'));

/** @description Start one ephemeral loopback fixture: the real routes, the real tile, doubles only for what lives outside this package. */
export async function startFixture({ sub = 'roger-browser' } = {}) {
  const { express, createEmbodiedRoutes, createEmbodiedNodeRoutes, restore } = harness.loadRoutes();
  const engine = require(path.join(harness.PKG, 'routes', 'engine', 'index.js'));
  const { startFakeNode } = require('./fake-node.js');
  const fleet = new engine.DroneNodeFleet();
  const pool = harness.fakePool();
  let wall = 1_000_000;
  const cadPosts = []; const cockpitVisits = [];
  const app = express();
  app.use('/shared/ui', express.static(path.join(coreRoot, 'src/shared/ui')));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.oidc = { user: { sub }, isAuthenticated: () => true }; next(); });
  // The routes advance the owner's world by wall-clock (≤ 2 s per read); every state poll is two simulated seconds here.
  app.use('/api/embodied', (req, _res, next) => { if (req.path === '/state') wall += 2000; next(); });
  const reports = { dir: '/tmp/embodied-reports', policies: ['hover-leg-ppo-residual-seed0.zip'], reports: [{ file: 'hover-leg-residual-seed0.json', report: { task: 'hover-leg', mode: 'residual', seed: 0, timesteps: 200000, policyFile: 'hover-leg-ppo-residual-seed0.zip', policyBeatsBaseline: true, baseline: { holdEndErrM: 0.01, legEndErrM: 0.015, trajectory: [[0.6, 0.6, 2.075]] }, policy: { holdEndErrM: 0.008, legEndErrM: 0.012, trajectory: [[0.6, 0.6, 2.075], [0.7, 0.6, 2.075]] } } }] };
  app.use('/api/embodied/nodes', harness.trustedSubMirror(), createEmbodiedNodeRoutes({ pool, appPackageDir: harness.PKG }, { now: () => wall, fleet }));
  app.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: harness.PKG }, { now: () => wall, noTimer: true, engineAddr: '127.0.0.1:1', reportReader: () => reports, armChecker: async (input) => armCheckDouble(input), fleet, serviceSecret: () => 'fixture-secret' }));
  // The arm's physics check without a container: the shape the engine answers, with the design's own numbers echoed
  // back as the measurement so the page can be driven without MuJoCo.
  const armChecks = [];
  const armCheckDouble = (input) => {
    armChecks.push(input);
    return {
      task: 'arm-grasp', baseline: 'taught pick-and-place', payloadKg: input.payloadKg, seeds: input.seeds,
      holds: input.designNm.map((nm, i) => ({ joint: `j${i + 1}`, designNm: nm, measuredNm: nm, usableNm: input.usableNm[i], poseBlocked: false, agreesWithDesign: true, withinContinuous: nm <= input.usableNm[i] })),
      run: { successRate: 1, meanSeconds: 0.9, peakTorqueNm: input.designNm, meanTorqueNm: input.designNm.map((v) => v / 3), episodes: [] },
      dutyOfContinuous: input.designNm.map((v, i) => v / 3 / input.usableNm[i]),
      verdict: { holdsItsPayload: true, physicsAgreesWithDesign: true, taskSucceeds: true, withinDutyCycle: true }, wallSeconds: 2.1,
    };
  };
  app.post('/api/cad-studio/models', (req, res) => {
    cadPosts.push(req.body);
    res.status(201).json({ model: { model_id: 'cad-double-1', title: req.body?.title, revision: 1, state: 'built' }, build: { ok: true, ms: 1 } });
  });
  app.get('/cockpit/', (req, res) => { cockpitVisits.push(req.originalUrl); res.type('html').send(`<title>cockpit stub</title><p id="cockpit-stub">${req.originalUrl}</p>`); });
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // A node on the rail: the double heartbeats into the fixture's own routes (this package's engine tree hash, as the container does) until the fixture closes.
  const node = await startFakeNode({ nodeId: 'tile-plant', secret: 'fixture-secret', apiUrl: origin, heartbeatMs: 200, buildHash: engine.engineBuildHash(path.join(harness.PKG, 'engine')), ownerSub: sub });
  await node.heartbeatNow();
  return {
    origin, pool, cadPosts, armChecks, cockpitVisits, node,
    wallClock: () => wall,
    /** The exact body the tile must post for a part — read from the same routes the tile reads. */
    async partBody(fit, partId) { const res = await fetch(`${origin}/api/embodied/build/drone/parts/${partId}?fit=${fit}`); return (await res.json()).cadStudio; },
    async design(fit) { const res = await fetch(`${origin}/api/embodied/build/drone?fit=${fit}`); return res.json(); },
    async armDesign(fit) { const res = await fetch(`${origin}/api/embodied/build/arm?fit=${fit}`); return res.json(); },
    close: async () => { await node.close(); await new Promise((resolve) => server.close(resolve)); restore(); },
  };
}

/** @description Run the tile's polling loops fast: the surface polls state every 600 ms; the fixture makes every poll two simulated seconds, so a shorter period is a faster world, not a different one. */
export function fastPolling() {
  const original = window.setInterval;
  const map = { 600: 60, 2000: 400, 2500: 500, 3000: 400 };
  window.setInterval = (callback, delay, ...args) => original(callback, map[delay] ?? delay, ...args);
}
