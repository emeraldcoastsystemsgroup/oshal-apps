/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.2: what a person reads or hears in Smart Home names the product
 *   Open Swarm (Roger, 2026-11-13: the UI says "Open Swarm"; technical identifiers keep oshal; component names such as
 *   oshal TV app and oshal Node stay for the owner's decision). Drives compiled TV action labels, refusals and card
 *   buttons, inspects the manifest and persona, and scans routes/, src-routes/ and tools/ outside comments.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(__dirname, '../../scripts/toolchain')] }));

const ROOT = path.resolve(__dirname, '..');

/** Files that intentionally name the oshal TV app or oshal Node components (left unchanged per Batch 1 scope). */
const TV_APP_FILES = new Set([
  'oshal-app.yaml',
  'personas/home-bot.yaml',
  'routes/home-lan-devices.js',
  'src-routes/home-lan-devices.ts',
  'tools/home-tvs.js',
]);
const NODE_FILES = new Set(['tools/home-tvs.js']);

/** Technical identifier forms that legitimately retain oshal in code, paths, env vars, package IDs and User-Agent. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/\S+/gi,
  /\$?OSHAL_[A-Z0-9_]+\b/g,
  /--oshal-[a-z0-9-]+/gi,
  /\bcom\.oshal\.[a-z0-9_.]+\b/g,
  /\/app\/scripts\/oshal-[\w.-]+/g,
  /\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py/g,
  /\boshal-app\.yaml\b/g,
  /\boshal-home-(?:weather|package-data)\b/g,
  /\boshal_[a-z0-9_]+\b/g,
];

function stripAllowed(value, relFile = '') {
  let out = String(value || '');
  if (TV_APP_FILES.has(relFile)) out = out.replace(/\boshal TV app\b/g, '<COMPONENT>');
  if (NODE_FILES.has(relFile)) out = out.replace(/\boshal Node\b/g, '<COMPONENT>');
  for (const pattern of ALLOWED_IDENTIFIERS) out = out.replace(pattern, '<ID>');
  return out;
}

function findProductName(value, where, relFile = '') {
  const cleaned = stripAllowed(value, relFile);
  return [...cleaned.matchAll(/\boshal\b/gi)].map(
    (m) => `${where}: "${m[0]}" in ${JSON.stringify(String(value).trim().slice(0, 160))}`,
  );
}

function stripCodeComments(source, ext) {
  if (ext === '.html') return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

function listDirFiles(subDir, exts) {
  const dir = path.join(ROOT, subDir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && exts.includes(path.extname(e.name)))
    .map((e) => path.posix.join(subDir, e.name))
    .sort();
}

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers and component names', () => {
  assert.equal(findProductName('Open oshal on this TV', 'button').length, 1);
  assert.equal(findProductName("in OSHAL's Smart Home app", 'persona').length, 1);
  assert.equal(findProductName('Show Open Swarm on this TV', 'button').length, 0);
  assert.equal(findProductName('OSHAL_PACKAGE_DATA_DIR com.oshal.remote oshal-home-weather', 'id').length, 0);
  assert.equal(
    findProductName('Open the oshal TV app or install oshal Node on a Linux computer.', 'tv', 'tools/home-tvs.js').length,
    0,
  );
  assert.equal(
    findProductName('so the oshal TV app cannot run on it. Use Open oshal instead.', 'tv', 'routes/home-lan-devices.js').length,
    1,
  );
});

test('TV action words, Samsung refusal and TV card buttons name Open Swarm while preserving oshal TV app', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-product-name-'));
  const prev = process.env.OSHAL_HOME_DATA_DIR;
  process.env.OSHAL_HOME_DATA_DIR = tmp;
  try {
    const lanPath = require.resolve('../routes/home-lan-devices.js');
    delete require.cache[lanPath];
    const lan = require(lanPath);
    assert.equal(lan.ACTION_WORDS.launch_url, 'Show Open Swarm');
    assert.equal(lan.ACTION_WORDS.open_app, 'Open the oshal TV app');
    lan.writeLan('alice', {
      tvs: [{ id: 'tv-sam', name: 'Den TV', kind: 'samsung-tizen', address: '10.0.0.8', controllable: true }],
    });
    const refused = lan.planControl('alice', { device: 'tv-sam', action: 'open_app' });
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /the oshal TV app cannot run on it\. Use Show Open Swarm instead\./);
    assert.deepEqual(findProductName(refused.body.message, 'planControl open_app refusal', 'routes/home-lan-devices.js'), []);

    const tvsUi = await import(pathToFileURL(path.join(ROOT, 'tools', 'home-tvs.js')).href);
    const samBtns = tvsUi.tvButtons({ kind: 'samsung-tizen', controllable: true, samsung: { paired: true } });
    assert.deepEqual(samBtns.extra, [{ action: 'launch_url', label: 'Show Open Swarm on this TV', aria: 'Show Open Swarm on this TV' }]);
    const androidBtns = tvsUi.tvButtons({ kind: 'android-tv', controllable: true, adb: { state: 'device', appInstalled: true } });
    assert.equal(androidBtns.extra[0].label, 'Show Open Swarm on this TV');
  } finally {
    if (prev === undefined) delete process.env.OSHAL_HOME_DATA_DIR;
    else process.env.OSHAL_HOME_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the manifest and home-bot persona name Open Swarm in person-facing and model-facing copy', () => {
  const problems = [];
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  assert.match(manifest.description, /opening Open Swarm on the TV/);
  for (const field of ['displayName', 'description']) {
    problems.push(...findProductName(manifest[field], `oshal-app.yaml ${field}`, 'oshal-app.yaml'));
  }
  for (const tool of manifest.tools || []) {
    if (tool.name === 'home-lan-control') {
      assert.match(tool.description, /open Open Swarm on the TV, open the oshal TV app \(Android\)/);
    }
    for (const field of ['displayName', 'cardText', 'description', 'usageInstructions']) {
      problems.push(...findProductName(tool[field], `tool ${tool.name}.${field}`, 'oshal-app.yaml'));
    }
  }
  for (const bot of manifest.bots || []) {
    assert.ok(bot.routingKeywords.includes('open open swarm on'));
    for (const kw of bot.routingKeywords || []) {
      problems.push(...findProductName(kw, `bot ${bot.name}.routingKeywords`, 'oshal-app.yaml'));
    }
    problems.push(...findProductName(bot.selectorDescriptor, `bot ${bot.name}.selectorDescriptor`, 'oshal-app.yaml'));
  }
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'home-bot.yaml'), 'utf8'));
  assert.match(persona.perspective, /in Open Swarm's Smart Home app/);
  assert.match(persona.perspective, /open Open Swarm on the TV/);
  assert.match(persona.perspective, /the oshal TV app on an Android TV/);
  assert.ok(persona.routingKeywords.includes('open open swarm on'));
  for (const field of ['role', 'perspective', 'selectorDescriptor']) {
    problems.push(...findProductName(persona[field], `personas/home-bot.yaml ${field}`, 'personas/home-bot.yaml'));
  }
  for (const kw of persona.routingKeywords || []) {
    problems.push(...findProductName(kw, 'personas/home-bot.yaml routingKeywords', 'personas/home-bot.yaml'));
  }
  assert.deepEqual(problems, []);
});

test('shipped routes, TypeScript route sources and tools files name Open Swarm outside comments', () => {
  const files = [
    ...listDirFiles('routes', ['.js']),
    ...listDirFiles('src-routes', ['.ts']),
    ...listDirFiles('tools', ['.html', '.js', '.css']),
  ];
  const problems = [];
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const stripped = stripCodeComments(raw, path.extname(rel));
    stripped.split('\n').forEach((line, idx) => {
      problems.push(...findProductName(line, `${rel}:${idx + 1}`, rel));
    });
  }
  assert.deepEqual(problems, []);
});
