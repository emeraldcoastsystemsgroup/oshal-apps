/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.2: what a person reads or hears in Intelligent Operations names the
 *   product Open Swarm (Roger, 2026-11-13: the UI says "Open Swarm"; technical identifiers keep oshal; component names
 *   such as OSHAL Node stay for the owner's decision). Drives intake and topology-store refusals, inspects the manifest
 *   and all three personas, and scans every shipped file in experience/, routes/, src-routes/ and ui/ outside comments.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(__dirname, '../../scripts/toolchain')] }));

const ROOT = path.resolve(__dirname, '..');

/** Files that intentionally name the OSHAL Node component (left unchanged per Batch 1 scope). */
const NODE_COMPONENT_FILES = new Set([
  'personas/ops-rca-specialist.yaml',
  'experience/command-helper.js',
  'experience/computers.js',
  'experience/experience.js',
  'experience/index.html',
  'routes/commands.js',
  'src-routes/commands.ts',
]);

/** Technical identifier forms that legitimately retain oshal in code, paths, headers, env vars and schemas. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/\S+/gi,
  /urn:oshal:[\w:.-]+/gi,
  /\bOSHAL_[A-Z0-9_]+\b/g,
  /\bx-oshal-[a-z0-9-]+\b/gi,
  /--oshal-[a-z0-9-]+/gi,
  /~\/\.local\/state\/oshal-[\w./-]+/g,
  /\boshal-app\.yaml\b/g,
  /\boshal-(?:node(?:-desktop)?|peer(?:-deliver-delegation)?|saas(?:-[a-z0-9-]+)?|k8s(?:-[a-z0-9-]+)?|intelligent-operations-[a-z0-9-]+|native(?:-[a-z0-9-]+)?)\b/g,
  /\boshal_[a-z0-9_]+\b/g,
];

function stripAllowed(value, relFile = '') {
  let out = String(value || '');
  if (NODE_COMPONENT_FILES.has(relFile)) {
    out = out.replace(/\bMy OSHAL Node\b/g, '<COMPONENT>').replace(/\bOSHAL Node\b/g, '<COMPONENT>');
  }
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

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers and OSHAL Node where listed', () => {
  assert.equal(findProductName('Sign in through OSHAL to continue.', 'status').length, 1);
  assert.equal(findProductName('Your current OSHAL role does not permit this operation.', 'status').length, 1);
  assert.equal(findProductName('Sign in through Open Swarm to continue.', 'status').length, 0);
  assert.equal(findProductName('OSHAL_SSH_SERVICE x-oshal-confirm urn:oshal:operations:alert:1 --oshal-glass-bg', 'id').length, 0);
  assert.equal(
    findProductName('Run it in your own terminal or OSHAL Node under your signed-in profile.', 'cmd', 'experience/command-helper.js').length,
    0,
  );
  assert.equal(
    findProductName('Secrets go in OSHAL\'s connection flow. Running OSHAL Node.', 'html', 'experience/index.html').length,
    1,
  );
});

test('intake and topology-store caller refusals name the product Open Swarm, while commands keeps OSHAL Node', async () => {
  const { admit, intakeRecords } = require('../routes/intake.js');
  const { readGraph } = require('../routes/topology-store.js');
  const { commandRecords } = require('../routes/commands.js');
  const problems = [];

  await assert.rejects(
    async () => admit({}, '', {}, {}),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Open Swarm/);
      problems.push(...findProductName(err.message, 'intake.admit 401'));
      return true;
    },
  );
  await assert.rejects(
    async () => intakeRecords({}, ''),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Open Swarm/);
      problems.push(...findProductName(err.message, 'intake.intakeRecords 401'));
      return true;
    },
  );
  await assert.rejects(
    async () => readGraph({ query: async () => ({ rows: [] }) }, ''),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Open Swarm/);
      problems.push(...findProductName(err.message, 'topologyStore.readGraph 401'));
      return true;
    },
  );
  const listed = await commandRecords({ query: async () => ({ rows: [] }) }, 'alice');
  assert.match(listed.executionRails.kubectl, /OSHAL Node/);
  problems.push(...findProductName(JSON.stringify(listed), 'commands.commandRecords', 'routes/commands.js'));
  assert.deepEqual(problems, []);
});

test('the manifest and all three personas name Open Swarm in person-facing and model-facing copy', () => {
  const problems = [];
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  for (const field of ['displayName', 'description']) {
    problems.push(...findProductName(manifest[field], `oshal-app.yaml ${field}`));
  }
  for (const tool of manifest.tools || []) {
    for (const field of ['displayName', 'cardText', 'description', 'usageInstructions']) {
      problems.push(...findProductName(tool[field], `tool ${tool.name}.${field}`));
    }
  }
  for (const bot of manifest.bots || []) {
    problems.push(...findProductName(bot.selectorDescriptor, `bot ${bot.name}.selectorDescriptor`));
  }
  for (const sched of manifest.schedules || []) {
    for (const field of ['description', 'offer']) {
      problems.push(...findProductName(sched[field], `schedule ${sched.id}.${field}`));
    }
  }
  for (const rel of listDirFiles('personas', ['.yaml'])) {
    const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (rel === 'personas/ops-concierge.yaml') assert.match(persona.perspective, /inside Open Swarm/);
    if (rel === 'personas/ops-rca-specialist.yaml') assert.match(persona.perspective, /OSHAL Node/);
    for (const field of ['role', 'perspective', 'selector_descriptor']) {
      problems.push(...findProductName(persona[field], `${rel} ${field}`, rel));
    }
  }
  assert.deepEqual(problems, []);
});

test('shipped experience, routes, TypeScript route sources and ui files name Open Swarm outside comments', () => {
  const files = [
    ...listDirFiles('experience', ['.html', '.js', '.css']),
    ...listDirFiles('routes', ['.js']),
    ...listDirFiles('src-routes', ['.ts']),
    ...listDirFiles('ui', ['.html', '.js', '.css']),
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
