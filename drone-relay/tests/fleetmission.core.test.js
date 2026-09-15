/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The formation draft against the REAL fleet-mission gate the drone package runs (backlog B6, first half; B4's slots as latitude / longitude): the framework's own `src/features/drone/services/fleet-mission.ts` (and the mission-draft, mission-validator and drone-fleet modules it pulls in) is transpiled on require with the framework's locked TypeScript and called as is. The default chain's draft, a named one and a tree's all normalise with no error and pass the pairwise separation check (altitude bands 10 m apart or 20 m horizontally); the drafted slots sit the plan's 200 m apart by the gate's own distance function; the package's eight-drone cap is the gate's own; and a draft with two relays on one slot is refused by the gate — so the check is live, not vacuous.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 *
 * FRAMEWORK-COUPLED: needs a core checkout (its TypeScript compiler and drone feature source).
 * Hyphen-free name on purpose, so the store-CI wildcard `tests/*-*.test.js` never sweeps it into the
 * bare-checkout job. Run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/fleetmission.core.test.js
 * The one double: `@/shared/middleware/authz` (reached through drone-fleet → remote-drone-provider,
 * whose service-secret headers the gate never calls) is a stub; every module of the gate is real.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const CORE_ENV = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE_ENV) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const CORE = path.resolve(CORE_ENV);
const DRONE = path.join(CORE, 'src', 'features', 'drone');
const GATE = path.join(DRONE, 'services', 'fleet-mission.ts');
assert.ok(fs.existsSync(GATE), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with the drone feature (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const ts = coreRequire('typescript');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const HOME = { lat: 30.4, lon: -86.6 };

const STUBS = { '@/shared/middleware/authz': { serviceSecretHeaders: () => ({}) } };
const originalLoad = Module._load;
const originalTs = require.extensions['.ts'];
let gate;

test.before(() => {
  require.extensions['.ts'] = function transpile(module, filename) {
    if (!path.resolve(filename).startsWith(DRONE)) throw new Error(`only the drone feature is transpiled here: ${filename}`);
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
    module._compile(out.outputText, filename);
  };
  Module._load = function patched(request, parent, isMain) {
    if (STUBS[request]) return STUBS[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    return originalLoad.call(this, request, parent, isMain);
  };
  gate = require(GATE);
});

test.after(() => {
  Module._load = originalLoad;
  if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
});

function accepted(draft) {
  const { plan, errors } = gate.normalizeFleetMissionDraft(draft);
  assert.deepEqual(errors, [], 'the gate normalises the draft');
  assert.ok(gate.isFleetMissionShape(draft));
  assert.deepEqual(gate.validateFleetSeparation(plan.assignments), [], 'altitude bands 10 m apart or 20 m horizontally, pair by pair');
  return plan;
}

function draftOf(input, drones) {
  const spec = e.validateSpec(input);
  return e.formationDraft(spec, e.planChain(spec), HOME, drones).draft;
}

test('the default chain\'s draft passes the drone package\'s own fleet-mission gate', () => {
  const plan = accepted(draftOf({ fleetSize: 6 }));
  assert.deepEqual(plan.assignments.map((a) => a.droneId), ['r1', 'r2', 'r3', 'r4', 'tip']);
  assert.deepEqual(plan.assignments.map((a) => a.plan.waypoints[0].holdSeconds), [223, 189, 156, 123, 89], 'the holds survive normalisation');
  assert.ok(plan.assignments.every((a) => a.plan.rtlAfterMission === true && a.plan.speedMps === 6));
  const [r1, r2] = plan.assignments;
  const apart = gate.minPolylineDistanceM(r1.plan.waypoints, r2.plan.waypoints);
  assert.ok(Math.abs(apart - 200) < 0.05, `the gate measures the drafted slots the plan's 200 m apart (${apart})`);
});

test('a named formation and a tree pass the gate too', () => {
  accepted(draftOf({ fleetSize: 6 }, { r1: 'alpha', r2: 'bravo', tip: 'tip-cam' }));
  const tree = accepted(draftOf({ path: [{ x: 0, y: 0 }, { x: 400, y: 0 }], branches: [[{ x: 400, y: 300 }], [{ x: 400, y: -300 }]], fleetSize: 6, enduranceS: 1800 }));
  assert.deepEqual(tree.assignments.map((a) => a.droneId), ['r1', 'r2', 'r3', 'r4', 'tip1', 'tip2']);
});

test('the package\'s eight-drone cap is the gate\'s own, and the gate is live', () => {
  assert.equal(gate.MAX_FLEET_ASSIGNMENTS, e.FLEET_MISSION_MAX_DRONES);
  const draft = draftOf({ fleetSize: 6 });
  const nine = { name: 'nine', assignments: Array.from({ length: 9 }, (_, i) => ({ ...draft.assignments[0], droneId: `d${i}` })) };
  assert.match(gate.normalizeFleetMissionDraft(nine).errors[0], /the limit is 8/, 'nine drones is one too many for the gate as for the package');
  const stacked = { ...draft, assignments: [draft.assignments[0], { ...draft.assignments[1], plan: { ...draft.assignments[1].plan, waypoints: draft.assignments[0].plan.waypoints } }] };
  const { plan } = gate.normalizeFleetMissionDraft(stacked);
  assert.equal(gate.validateFleetSeparation(plan.assignments).length, 1, 'two relays on one slot are refused by the gate');
});
