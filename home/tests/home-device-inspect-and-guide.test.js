/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Verify SmartThings device capability & Samsung Family Hub refrigerator camera inspection (home-device-inspect), persistent Smart Home Operations Guide & Runbook (home-operations-guide / home-operations-guide-update), auto-discovery capability logging, and manifest declarations.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Verify weekly Samsung Family Hub refrigerator optical assessment, week-over-week shelf comparison, grocery cart recommendation & starter, weekly meal list builder, and phone-control optional dependency.
 * 3   | maintainer@emeraldcoastsystemsgroup.com | home 1.4.0: local discovery lists only what the installation's discovery file names (no made-up devices, never a TV), and a TV registered as a local device is refused by control instead of having its saved switch flipped.
 * 4   | maintainer@emeraldcoastsystemsgroup.com | home 1.5.0 (J-6): verify read-only samsungce.viewInside SmartThings capability operation (readSmartThingsViewInside, validateViewInsideDeviceInput, validateViewInsideFileId, renderViewInsideSvg), dictionary-keyed contents.value + supportedFocusAreas + lastUpdatedTime parsing, and home-view-inside manifest & route declarations.
 * 5   | maintainer@emeraldcoastsystemsgroup.com | home 1.6.2: the refrigerator cases hold the route to listing nothing until the inside was read, to keeping what a person set or added when a state saved from the fixed list is carried over, and to never carrying an item, comparison, order, meal or device id in its source again. All three fail on 1.6.1's route.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  inspectSmartThingsDevices,
  readSmartThingsViewInside,
  validateViewInsideDeviceInput,
  validateViewInsideFileId,
  renderViewInsideSvg,
} = require('../routes/home-device-inspect.js');
const {
  readOperationsGuide,
  recordDiscoveredDevices,
  updateOperationsGuideEntry,
  buildOperationsGuideSummary,
} = require('../routes/home-operations-guide.js');
const {
  discoverLocalSwarmCandidates,
  registerLocalSwarmDevice,
  controlLocalSwarmDevice,
  removeLocalSwarmDevice,
  saveSmartThingsToken,
  readSavedSmartThingsToken,
  readPersistedJson,
  writePersistedJson,
} = require('../routes/home-local-swarm.js');
const {
  formatFridgeAssessmentResponse,
  runWeeklyFridgeAssessment,
  mutateFridgeMealAndCart,
  buildMealsForFocus,
  NOTHING_READ,
} = require('../routes/fridge-weekly-assessment.js');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));

function fakeSmartThingsFetch(options = {}) {
  const asked = [];
  const devicesList = {
    items: [
      {
        deviceId: 'st-fridge-001',
        name: '[refrigerator] Samsung Family Hub',
        label: 'Kitchen Family Hub Refrigerator',
        manufacturerName: 'Samsung Electronics',
        presentationId: 'DA-REF-NORMAL-01',
        components: [
          {
            id: 'main',
            categories: [{ name: 'Refrigerator' }],
            capabilities: [
              { id: 'refrigeration' },
              { id: 'custom.fridgeMode' },
              { id: 'samsungce.viewInside' },
              { id: 'imageCapture' },
              { id: 'execute' },
              { id: 'contactSensor' },
            ],
          },
          {
            id: 'cooler',
            categories: [{ name: 'Refrigerator' }],
            capabilities: [
              { id: 'temperatureMeasurement' },
              { id: 'thermostatCoolingSetpoint' },
              { id: 'contactSensor' },
            ],
          },
          {
            id: 'freezer',
            categories: [{ name: 'Refrigerator' }],
            capabilities: [
              { id: 'temperatureMeasurement' },
              { id: 'thermostatCoolingSetpoint' },
              { id: 'contactSensor' },
            ],
          },
        ],
      },
      {
        deviceId: 'st-lamp-002',
        name: 'Living Room Lamp',
        label: 'Living Room Lamp',
        manufacturerName: 'SmartThings',
        components: [
          {
            id: 'main',
            categories: [{ name: 'Light' }],
            capabilities: [{ id: 'switch' }, { id: 'switchLevel' }],
          },
        ],
      },
    ],
  };

  const viewInsideState = options.viewInside || {
    contents: {
      value: [
        { fileId: 'file-cam-top-01', mimeType: 'image/jpeg', updatedTime: '2026-11-08T02:15:00Z' },
        { fileId: 'file-cam-bottom-02', mimeType: 'image/jpeg', updatedTime: '2026-11-08T02:15:00Z' },
      ],
    },
    supportedFocusAreas: { value: ['upper', 'lower'], timestamp: '2026-11-08T02:15:00Z' },
    lastUpdatedTime: { value: '2026-11-08T02:15:00Z', timestamp: '2026-11-08T02:15:00Z' },
  };

  const fridgeStatus = {
    components: {
      main: {
        'samsungce.viewInside': viewInsideState,
        imageCapture: {
          image: { value: 'https://api.smartthings.com/v1/devices/st-fridge-001/images/latest' },
          captureTime: { value: '2026-11-08T02:15:00Z' },
        },
        'custom.fridgeMode': {
          fridgeMode: { value: 'normal' },
        },
        refrigeration: {
          rapidCooling: { value: 'off' },
          rapidFreezing: { value: 'off' },
        },
        contactSensor: {
          contact: { value: 'closed' },
        },
      },
      cooler: {
        temperatureMeasurement: { temperature: { value: 37, unit: 'F' } },
        thermostatCoolingSetpoint: { coolingSetpoint: { value: 37, unit: 'F' } },
        contactSensor: { contact: { value: 'closed' } },
      },
      freezer: {
        temperatureMeasurement: { temperature: { value: -1, unit: 'F' } },
        thermostatCoolingSetpoint: { coolingSetpoint: { value: 0, unit: 'F' } },
        contactSensor: { contact: { value: 'closed' } },
      },
    },
  };

  const impl = async (url, init) => {
    asked.push({ url, method: (init && init.method) || 'GET', headers: (init && init.headers) || {} });
    const json = (body, status = 200) => ({
      ok: status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (url === 'https://api.smartthings.com/v1/devices') return json(devicesList);
    if (url === 'https://api.smartthings.com/v1/devices/st-fridge-001') return json(devicesList.items[0]);
    if (url === 'https://api.smartthings.com/v1/devices/st-fridge-001/status') return json(fridgeStatus);
    if (url === 'https://api.smartthings.com/v1/devices/st-fridge-001/components/main/capabilities/samsungce.viewInside/status') {
      return json(viewInsideState);
    }
    if (url === 'https://api.smartthings.com/v1/devices/st-lamp-002') return json(devicesList.items[1]);
    if (url === 'https://api.smartthings.com/v1/devices/st-lamp-002/status') {
      return json({ components: { main: { switch: { switch: { value: 'on' } } } } });
    }
    return json({}, 404);
  };
  return { impl, asked };
}

test('inspectSmartThingsDevices resolves a Samsung Family Hub refrigerator and extracts ViewInside camera + temperatures', async () => {
  const { impl, asked } = fakeSmartThingsFetch();
  const res = await inspectSmartThingsDevices(impl, {}, 'refrigerator');
  assert.equal(res.ok, true);
  assert.equal(res.matchedCount, 1);
  assert.equal(res.totalDevices, 2);
  assert.equal(res.inspected.length, 1);
  const fridge = res.inspected[0];
  assert.equal(fridge.deviceId, 'st-fridge-001');
  assert.equal(fridge.name, 'Kitchen Family Hub Refrigerator');
  assert.equal(fridge.highlights.hasInteriorCameraCapability, true);
  assert.deepEqual(fridge.highlights.cameraCapabilities, ['samsungce.viewInside', 'imageCapture']);
  assert.equal(fridge.highlights.viewInside.contents.value.length, 2);
  assert.equal(fridge.highlights.temperatures.cooler.temperature, 37);
  assert.equal(fridge.highlights.temperatures.freezer.temperature, -1);
  assert.equal(fridge.highlights.doors.cooler, 'closed');
  assert.ok(asked.some((a) => a.url === 'https://api.smartthings.com/v1/devices/st-fridge-001/status'));
});

test('readSmartThingsViewInside reads samsungce.viewInside when contents.value is a dictionary keyed by fileId, validates inputs, and renders SVG bay previews (J-6)', async () => {
  assert.equal(typeof readSmartThingsViewInside, 'function');
  assert.equal(typeof validateViewInsideDeviceInput, 'function');
  assert.equal(typeof validateViewInsideFileId, 'function');
  assert.equal(typeof renderViewInsideSvg, 'function');

  assert.equal(validateViewInsideDeviceInput('refrigerator').ok, true);
  assert.equal(validateViewInsideDeviceInput('a'.repeat(121)).ok, false);
  assert.equal(validateViewInsideDeviceInput('bad\ninput').ok, false);
  assert.equal(validateViewInsideFileId('file-cam-top-01').ok, true);
  assert.equal(validateViewInsideFileId('../escape').ok, false);

  const { impl, asked } = fakeSmartThingsFetch({
    viewInside: {
      contents: {
        value: {
          'udo-top-bay-01': {
            fileId: 'udo-top-bay-01',
            mimeType: 'image/jpeg',
            focusArea: 'upper',
            updatedTime: '2026-11-10T03:00:00Z',
            expiredTime: '2026-11-11T03:00:00Z',
          },
          'udo-middle-bay-02': {
            fileId: 'udo-middle-bay-02',
            mimeType: 'image/jpeg',
            focusArea: 'middle',
            updatedTime: '2026-11-10T03:00:00Z',
            expiredTime: '2026-11-11T03:00:00Z',
          },
          'udo-lower-bay-03': {
            fileId: 'udo-lower-bay-03',
            mimeType: 'image/jpeg',
            focusArea: 'lower',
            updatedTime: '2026-11-10T03:00:00Z',
            expiredTime: '2026-11-11T03:00:00Z',
          },
        },
        timestamp: '2026-11-10T03:00:00Z',
      },
      supportedFocusAreas: {
        value: ['upper', 'middle', 'lower'],
        timestamp: '2026-11-10T03:00:00Z',
      },
      lastUpdatedTime: {
        value: '2026-11-10T03:00:00Z',
        timestamp: '2026-11-10T03:00:00Z',
      },
    },
  });

  const view = await readSmartThingsViewInside(impl, {}, 'refrigerator');
  assert.equal(view.ok, true);
  assert.equal(view.capability, 'samsungce.viewInside');
  assert.equal(view.readOnly, true);
  assert.equal(view.deviceId, 'st-fridge-001');
  assert.equal(view.deviceName, 'Kitchen Family Hub Refrigerator');
  assert.deepEqual(view.supportedFocusAreas, ['upper', 'middle', 'lower']);
  assert.equal(view.lastUpdatedTime, '2026-11-10T03:00:00Z');
  assert.equal(view.images.length, 3);
  assert.equal(view.images[0].fileId, 'udo-top-bay-01');
  assert.equal(view.images[0].focusArea, 'upper');
  assert.equal(view.images[0].imageUrl, '/api/home/view-inside/image/udo-top-bay-01');
  assert.match(view.images[0].markdownImage, /^!\[.*\]\(\/api\/home\/view-inside\/image\/udo-top-bay-01\)$/);
  assert.equal(view.compositeImageUrl, '/api/home/fridge-image');
  assert.match(view.markdownPreview, /\/api\/home\/view-inside\/image\/udo-top-bay-01/);
  assert.ok(asked.every((a) => a.method === 'GET'), 'read-only SmartThings connector makes only GET requests');

  const svg = renderViewInsideSvg(view.images[0], view);
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /samsungce\.viewInside/);
  assert.match(svg, /udo-top-bay-01/);
});

test('Operations Guide persists auto-discovered capabilities and operator notes in OSHAL_PACKAGE_DATA_DIR', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-ops-guide-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  try {
    const initial = readOperationsGuide('owner-1');
    assert.ok(initial.playbooks.some((p) => p.id === 'samsung-family-hub-refrigerator'));

    recordDiscoveredDevices('owner-1', [
      {
        key: 'kitchen-family-hub-refrigerator',
        deviceId: 'st-fridge-001',
        name: 'Kitchen Family Hub Refrigerator',
        manufacturerName: 'Samsung Electronics',
        categories: ['Refrigerator'],
        capabilities: ['refrigeration', 'samsungce.viewInside', 'imageCapture'],
      },
    ]);

    const updated = updateOperationsGuideEntry('owner-1', {
      title: 'Fridge Shelf Camera Schedule',
      device: 'kitchen-family-hub-refrigerator',
      category: 'appliances',
      content: 'ViewInside snapshots refresh each time the refrigerator door closes.',
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.entry.title, 'Fridge Shelf Camera Schedule');

    const summary = buildOperationsGuideSummary('owner-1');
    assert.equal(summary.discoveredDeviceCount, 1);
    assert.match(summary.detail, /Kitchen Family Hub Refrigerator/);
    assert.match(summary.detail, /samsungce\.viewInside/);
    assert.match(summary.detail, /Fridge Shelf Camera Schedule/);
  } finally {
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('the manifest declares lastingStorage, home-device-inspect, home-view-inside, home-operations-guide, home-operations-guide-update, and refrigerator/camera routing words', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  assert.equal(m.lastingStorage, true);
  const inspectTool = m.tools.find((t) => t.name === 'home-device-inspect');
  assert.ok(inspectTool, 'home-device-inspect tool declared');
  assert.equal(inspectTool.executor.apiEndpoint, 'GET /api/home/device-inspect?device={input.device}');
  assert.equal(inspectTool.requiresApproval, false);

  const viewInsideTool = m.tools.find((t) => t.name === 'home-view-inside');
  assert.ok(viewInsideTool, 'home-view-inside tool declared');
  assert.equal(viewInsideTool.executor.apiEndpoint, 'GET /api/home/view-inside?device={input.device}');
  assert.equal(viewInsideTool.requiresApproval, false);
  assert.ok(viewInsideTool.inputSchema.properties.device, 'home-view-inside bounds device input');
  const routesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'home-routes.js'), 'utf8');
  assert.match(routesSrc, /router\.get\(['"]\/view-inside['"]/);
  assert.match(routesSrc, /router\.get\(['"]\/view-inside\/image\/:fileId['"]/);

  const guideReadTool = m.tools.find((t) => t.name === 'home-operations-guide');
  assert.ok(guideReadTool, 'home-operations-guide tool declared');
  assert.equal(guideReadTool.executor.apiEndpoint, 'GET /api/home/operations-guide');

  const guideWriteTool = m.tools.find((t) => t.name === 'home-operations-guide-update');
  assert.ok(guideWriteTool, 'home-operations-guide-update tool declared');
  assert.equal(guideWriteTool.executor.apiEndpoint, 'POST /api/home/operations-guide');

  for (const word of ['refrigerator', 'refriderator', 'fridge', 'family hub', 'viewinside', 'view inside', 'fridge camera', 'smartthings camera', 'appliance', 'samsung', 'operations guide', 'runbook']) {
    assert.ok(m.bots[0].routingKeywords.includes(word), `routingKeyword missing: ${word}`);
  }
  assert.ok(m.tools.find((t) => t.name === 'home-local-discover'), 'home-local-discover tool declared');
  assert.ok(m.tools.find((t) => t.name === 'home-device-register'), 'home-device-register tool declared');
});

test('Local Swarm device discovery, registration, and control work with zero cloud API cost', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-local-swarm-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  try {
    assert.deepEqual(discoverLocalSwarmCandidates('owner-1'), [], 'nothing is listed that nothing found');
    fs.mkdirSync(path.join(tmpDir, 'owner-1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'owner-1', 'host-local-discovery.json'), JSON.stringify({ candidates: [
      { id: 'fridge', name: 'Kitchen Refrigerator', protocol: 'bluetooth', address: '02:00:5E:00:00:21', category: 'Refrigerator', room: 'Kitchen', capabilities: [] },
      { id: 'tv', name: 'Den TV', protocol: 'lan-http', address: '10.20.30.40', category: 'TV', room: 'Den', capabilities: [] },
    ] }));
    const candidates = discoverLocalSwarmCandidates('owner-1');
    assert.deepEqual(candidates.map((c) => c.name), ['Kitchen Refrigerator'], 'a TV is found by the computer scan, not listed here');

    const { device, devices } = registerLocalSwarmDevice('owner-1', {
      name: 'Samsung Family Hub Refrigerator (Bluetooth)',
      category: 'Refrigerator',
      protocol: 'bluetooth',
      address: '02:00:5E:00:00:21',
      room: 'Kitchen',
    });
    assert.equal(device.key, 'samsung-family-hub-refrigerator-bluetooth');
    assert.equal(device.sources[0].hub, 'swarm-local');
    assert.equal(device.temperatureF, 37);
    assert.ok(device.capabilities.includes('samsungce.viewInside'));
    assert.equal(devices.length, 1);

    const toggled = controlLocalSwarmDevice('owner-1', device.key, 'off');
    assert.equal(toggled.ok, true);
    assert.equal(toggled.device.switch, 'off');

    const tv = registerLocalSwarmDevice('owner-1', { name: 'Den TV', category: 'TV', protocol: 'swarm-node', address: '10.20.30.40' }).device;
    const refused = controlLocalSwarmDevice('owner-1', tv.key, 'off');
    assert.equal(refused.ok, false);
    assert.equal(refused.refused, 'tv_needs_computer');
    assert.equal(refused.device.switch, 'on', 'no saved switch flips for a TV');
    removeLocalSwarmDevice('owner-1', tv.key);

    const saved = saveSmartThingsToken('owner-1', 'st-personal-token-123456789');
    assert.equal(saved.token, 'st-personal-token-123456789');
    assert.equal(readSavedSmartThingsToken('owner-1').token, 'st-personal-token-123456789');

    const removed = removeLocalSwarmDevice('owner-1', device.key);
    assert.equal(removed.removed, true);
    assert.equal(removed.devices.length, 0);
  } finally {
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('1.6.2: a refrigerator lists nothing until its inside has been read; a person\'s own list, orders and meals are theirs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-fridge-weekly-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  try {
    const initial = formatFridgeAssessmentResponse('owner-1');
    assert.equal(initial.ok, true);
    assert.equal(initial.weeklySchedule.enabled, true);
    assert.equal(initial.weeklySchedule.dayOfWeek, 'Sunday');
    assert.equal(initial.weeklySchedule.lastRunAt, null, 'no run has happened');
    assert.equal(initial.telemetry.measuredAt, null, '37 and 0 are placeholders until the hub reports a temperature (1.6.1)');
    // Nothing was read, so nothing is listed, and the words say so. Until 1.6.2 everyone was shown one fixed list.
    assert.deepEqual([initial.currentSnapshot.items, initial.previousWeekSnapshot.items, initial.orderHistory, initial.cart.items, initial.mealPlan.entries], [[], [], [], [], []]);
    assert.equal(initial.currentSnapshot.capturedAt, null);
    assert.deepEqual(initial.reading, { read: false, capturedAt: null, words: NOTHING_READ });
    assert.equal(initial.comparison.read, false);
    assert.equal(initial.comparison.summaryText, NOTHING_READ);
    assert.match(NOTHING_READ, /^Nothing has been read from this refrigerator yet/);
    assert.deepEqual([initial.comparison.depletedFromLastWeek, initial.comparison.runningLow, initial.comparison.useFirst], [[], [], []]);
    assert.deepEqual([initial.deviceId, initial.companionDependency.phoneDeviceId], ['', ''], 'no household\'s device is written into the package');
    assert.deepEqual(buildMealsForFocus('high-protein'), [], 'meal ideas come from a reading; there is none');

    // A run reads the hub's temperature and nothing inside: it claims no capture and invents no meal.
    const ran = runWeeklyFridgeAssessment('owner-1', { focus: 'use-first' });
    assert.deepEqual([ran.telemetry.measuredAt, ran.currentSnapshot.capturedAt, ran.mealPlan.entries.length, ran.reading.read], [null, null, 0, false]);
    assert.ok(!Number.isNaN(Date.parse(ran.weeklySchedule.lastRunAt)), 'the run itself is recorded');

    // The list is the person's own: starting it marks it, adding puts an item on it.
    const started = mutateFridgeMealAndCart('owner-1', { action: 'start-cart', store: 'Weekly Swarm Cart' });
    assert.deepEqual([started.cart.status, started.cart.store, started.cart.activeItemCount], ['active', 'Weekly Swarm Cart', 0]);
    const withAdded = mutateFridgeMealAndCart('owner-1', { action: 'add-cart-item', name: 'Sparkling Mineral Water', quantity: '2 cases' });
    assert.deepEqual(withAdded.cart.items.map((i) => [i.name, i.quantity, i.inCart]), [['Sparkling Mineral Water', '2 cases', true]]);
    assert.equal(withAdded.cart.activeItemCount, 1);

    const measured = runWeeklyFridgeAssessment('owner-1', { coolerTempF: 36, freezerTempF: 0, focus: 'high-protein' });
    assert.equal(measured.telemetry.coolerTempF, 36);
    assert.ok(!Number.isNaN(Date.parse(measured.telemetry.measuredAt)), 'a run handed a reported temperature says when it was read');
    assert.deepEqual([measured.mealPlan.focus, measured.mealPlan.entries], ['high-protein', []]);

    // A meal a person writes is kept when the focus changes; an order they log is kept.
    const own = mutateFridgeMealAndCart('owner-1', { action: 'build-meal-list', focus: 'quick', customMeal: { title: 'Friday pizza night', day: 'Friday' } });
    assert.deepEqual(own.mealPlan.entries.map((m) => [m.title, m.usesFromFridge]), [['Friday pizza night', []]]);
    assert.deepEqual(mutateFridgeMealAndCart('owner-1', { action: 'build-meal-list', focus: 'use-first' }).mealPlan.entries.map((m) => m.title), ['Friday pizza night']);
    assert.deepEqual(mutateFridgeMealAndCart('owner-1', { action: 'log-order', name: 'Oat milk' }).orderHistory.map((o) => o.name), ['Oat milk']);
  } finally {
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('1.6.2: a state saved from the fixed list is carried over with only what the person set or added', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-fridge-carried-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  try {
    // The shape 1.6.1 saved: the fixed shelves, comparison, orders, list and meals, with what this person did among them.
    const before = {
      version: 1, deviceId: 'a-household-device', deviceName: 'Samsung Family Hub Refrigerator',
      companionDependency: { app: 'phone-control', status: 'declared-optional', phoneDeviceId: 'a-household-phone', description: 'old' },
      weeklySchedule: { enabled: false, cadence: 'weekly', dayOfWeek: 'Tuesday', time: '07:30', cron: '0 9 * * 0', lastRunAt: '2026-11-09T15:00:00.000Z', nextRunAt: '2026-11-16T15:00:00.000Z' },
      telemetry: { coolerTempF: 35, freezerTempF: -2, measuredAt: '2026-11-09T15:00:00.000Z', doorStatus: 'closed', cameraZones: 3, imageUrl: '/api/home/fridge-image' },
      currentSnapshot: { capturedAt: '2026-11-09T15:00:00.000Z', items: [{ id: 'fixed-1', name: 'A fixed shelf item', shelf: 'Top Shelf', category: 'x', quantity: '1', status: 'stocked', daysInFridge: 3 }] },
      previousWeekSnapshot: { capturedAt: '2026-11-02T15:00:00.000Z', items: [{ name: 'A fixed staple', shelf: 'Middle Shelf', statusLastWeek: 'Full', statusNow: 'Depleted (0 left)' }] },
      orderHistory: [{ id: 'ord-fixed', name: 'A fixed order', category: 'x', lastOrderedDaysAgo: 7, typicalCadenceDays: 7, statusInFridge: 'depleted' },
        { id: 'ord-1794300000000', name: 'Oat milk', category: 'Grocery', lastOrderedDaysAgo: 0, typicalCadenceDays: 7, statusInFridge: 'stocked' }],
      cart: { status: 'active', store: 'Weekly Grocery Cart', startedAt: '2026-11-09T15:05:00.000Z', updatedAt: '2026-11-09T15:06:00.000Z', items: [
        { id: 'cart-fixed', name: 'A fixed suggestion', quantity: '1', category: 'x', reason: 'Running low on the middle shelf', priority: 'high', inCart: true },
        { id: 'cart-sparkling-mineral-water', name: 'Sparkling Mineral Water', quantity: '2 cases', category: 'Grocery', reason: 'Added for weekly meal plan', priority: 'medium', inCart: true }] },
      mealPlan: { focus: 'quick', updatedAt: '2026-11-09T15:07:00.000Z', entries: [
        { id: 'meal-custom-1794300000001', day: 'Friday', mealType: 'Dinner', title: 'Friday pizza night', usesFromFridge: [], usesFromOrdersOrCart: [], prepTimeMin: 15, notes: 'ours' },
        { id: 'meal-1', day: 'Day 1', mealType: 'Dinner', title: 'A fixed meal', usesFromFridge: ['A fixed shelf item'], usesFromOrdersOrCart: [], prepTimeMin: 5, notes: 'fixed' }] },
    };
    assert.equal(writePersistedJson('owner-2', 'fridge-weekly-state.json', before), true);
    const after = formatFridgeAssessmentResponse('owner-2');
    assert.deepEqual([after.currentSnapshot.items, after.previousWeekSnapshot.items, after.currentSnapshot.capturedAt, after.reading.read], [[], [], null, false], 'the fixed shelves and comparison are gone');
    assert.deepEqual(after.orderHistory.map((o) => o.name), ['Oat milk'], 'the order the person logged is kept');
    assert.deepEqual(after.cart.items.map((i) => i.name), ['Sparkling Mineral Water'], 'the item the person added is kept');
    assert.deepEqual([after.cart.status, after.cart.activeItemCount], ['active', 1]);
    assert.deepEqual(after.mealPlan.entries.map((m) => m.title), ['Friday pizza night'], 'the meal the person wrote is kept');
    assert.deepEqual([after.weeklySchedule.enabled, after.weeklySchedule.dayOfWeek, after.weeklySchedule.time, after.mealPlan.focus], [false, 'Tuesday', '07:30', 'quick'], 'their settings are kept');
    assert.deepEqual([after.telemetry.coolerTempF, after.telemetry.freezerTempF, after.telemetry.measuredAt], [35, -2, '2026-11-09T15:00:00.000Z'], 'a temperature the hub reported is kept');
    assert.deepEqual([after.deviceId, after.companionDependency.phoneDeviceId], ['', '']);
    assert.equal(readPersistedJson('owner-2', 'fridge-weekly-state.json').version, 2, 'and it is saved in the new shape, once');
  } finally {
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('1.6.2: no item, comparison, order, meal or device id is written into the refrigerator route again', () => {
  for (const file of ['src-routes/fridge-weekly-assessment.ts', 'routes/fridge-weekly-assessment.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /\{ id: '[^']+', name: '[^']+'/, `${file}: an item written out with its id and name`);
    assert.doesNotMatch(source, /name: '[^']+', shelf: '/, `${file}: a shelf item`);
    assert.doesNotMatch(source, /statusLastWeek: '|usesFromFridge: \['|title: '[^']+', usesFrom/, `${file}: a fixed comparison, order or meal`);
    assert.doesNotMatch(source, /['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/, `${file}: a device id`);
    assert.doesNotMatch(source, /priority: '(high|medium|low)', inCart: (true|false) \},?\s*$/m, `${file}: a fixed list entry`);
  }
});

test('the manifest declares phone-control optional dependency and weekly fridge assessment/meal/cart tools and routing words', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  assert.ok(m.dependencies.optional.apps.includes('phone-control'), 'phone-control optional dependency declared');
  assert.ok(m.tools.find((t) => t.name === 'home-fridge-assessment'), 'home-fridge-assessment tool declared');
  assert.ok(m.tools.find((t) => t.name === 'home-fridge-assessment-run'), 'home-fridge-assessment-run tool declared');
  assert.ok(m.tools.find((t) => t.name === 'home-fridge-meal-cart'), 'home-fridge-meal-cart tool declared');
  for (const word of ['meal list', 'meal plan', 'grocery cart', 'start a cart', 'what is in the fridge', 'weekly fridge', 'fridge assessment']) {
    assert.ok(m.bots[0].routingKeywords.includes(word), `routingKeyword missing: ${word}`);
  }
});
