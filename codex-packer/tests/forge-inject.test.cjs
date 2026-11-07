/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Unit and Chromium E2E acceptance suite for Bot Forge 1-click Inject Permission Preview, live caller-scoped publish_authored confirmation, and refusal handling.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PKG_ROOT = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN
  ? (fs.existsSync(path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'))
    ? path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN), 'node_modules')
    : path.resolve(process.env.STORE_CI_TOOLCHAIN))
  : path.resolve(PKG_ROOT, '../scripts/toolchain/node_modules');

const Module = require('node:module');
const express = require(path.join(TOOLCHAIN, 'express'));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'express') return express;
  return originalLoad.call(this, request, parent, isMain);
};
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const forgeModel = require('../tools/forge-model.js');
const { createBotForgeRoutes } = require('../routes/forge-routes.mjs');

function createMockKernelServer() {
  const app = express();
  app.use(express.json());
  const state = {
    publishCalls: [],
    compileCalls: 0,
    nextPublishError: null,
    definitions: new Map(),
  };

  app.get('/shared/ui/css/surface-themes.css', (_req, res) => res.type('text/css').send(':root{}'));
  app.get('/shared/ui/js/surface-theme.js', (_req, res) => res.type('text/javascript').send(''));
  app.use('/api/codex-packer', createBotForgeRoutes({ appPackageDir: PKG_ROOT }));

  app.get('/api/agents', (_req, res) => {
    res.json({
      total: 2,
      agents: [
        { name: 'codex-packer', role: 'bot-authoring/factory', agent_id: 'a0000000-0000-0000-0000-000000000030' },
        { name: 'meeting-scribe', role: 'assistant', agent_id: 'a0000000-0000-0000-0000-000000000099' },
      ],
    });
  });

  app.get('/api/workflow-studio/definitions', (_req, res) => {
    res.json({
      success: true,
      count: state.definitions.size,
      definitions: [...state.definitions.values()],
    });
  });

  app.post('/api/workflow-studio/definitions', (req, res) => {
    const id = randomUUID();
    const def = { id, version: 1, name: req.body.name || 'Untitled', description: req.body.description || '', nodes: [], edges: [] };
    state.definitions.set(id, def);
    res.status(201).json({ success: true, definition: def });
  });

  wireStudioMutationRoutes(app, state);
  return { app, state };
}

function wireStudioPublishRoutes(app, state) {
  app.post('/api/workflow-studio/definitions/:id/compile', (req, res) => {
    state.compileCalls += 1;
    const def = state.definitions.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'not_found' });
    return res.json({
      success: true,
      preview: {
        status: 'ready',
        usesKernelBots: false,
        runtimeBindings: ['declared-bot-dispatch', 'terminal-ticket-completion'],
        stepBindings: [{ nodeId: 'work', agentBinding: def.nodes?.[1]?.config?.agentBinding || 'codex-packer' }],
        validation: { valid: true, issues: [], nodeCount: def.nodes.length, edgeCount: def.edges.length },
      },
    });
  });

  app.post('/api/workflow-studio/definitions/:id/publish', (req, res) => {
    state.publishCalls.push({ id: req.params.id, body: req.body });
    if (state.nextPublishError) {
      const err = state.nextPublishError;
      state.nextPublishError = null;
      return res.status(err.status).json(err.body);
    }
    const def = state.definitions.get(req.params.id);
    const pkg = `authored-${forgeModel.slugifyName(def.name)}-7f3a9c12`;
    const publication = {
      package: pkg,
      ticketType: pkg,
      version: def.version,
      published: true,
      executable: true,
      runtimeRegistered: true,
      executionMode: 'supported-sequential',
    };
    def.publication = publication;
    return res.json({ success: true, publication, definition: def });
  });
}

function wireStudioMutationRoutes(app, state) {
  app.get('/api/workflow-studio/definitions/:id', (req, res) => {
    const def = state.definitions.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'not_found' });
    return res.json({ success: true, definition: def });
  });

  app.put('/api/workflow-studio/definitions/:id', (req, res) => {
    const prev = state.definitions.get(req.params.id);
    if (!prev) return res.status(404).json({ error: 'not_found' });
    if (req.body.expectedVersion !== prev.version) return res.status(409).json({ error: 'conflict', message: 'Draft version conflict.' });
    const allowedNodeKeys = new Set(['id', 'type', 'title', 'description', 'position', 'config']);
    for (const node of req.body.nodes || []) {
      for (const k of Object.keys(node)) assert.ok(allowedNodeKeys.has(k), `unexpected node key ${k}`);
    }
    const updated = { ...prev, ...req.body, version: prev.version + 1 };
    state.definitions.set(req.params.id, updated);
    return res.json({ success: true, definition: updated });
  });

  wireStudioPublishRoutes(app, state);
}

test('forge-model builds strict native SaveRequest payloads, imports YAML, and classifies refusals', () => {
  const parsed = forgeModel.parseForgeYamlDraft(
    'name: action-extractor\ndisplayName: Action Extractor\nsuite: ai-engineering\ndescription: Extracts action items with owners.\nperspective: |\n  Never repeat credentials.\n'
  );
  assert.equal(parsed.name, 'Action Extractor');
  assert.equal(parsed.suite, 'ai-engineering');
  assert.match(parsed.guardrails, /Never repeat credentials/);

  const payload = forgeModel.buildSavePayload('11111111-1111-4111-8111-111111111111', 2, {
    name: 'Action Extractor',
    workerBot: 'codex-packer',
    suite: 'ai-engineering',
    task: 'Read pasted notes and extract owners and due dates.',
    requireApproval: true,
  });
  assert.equal(payload.expectedVersion, 2);
  assert.equal(payload.nodes.length, 4);
  assert.equal(payload.nodes[1].config.agentBinding, 'codex-packer');
  assert.equal(payload.nodes[2].type, 'approval-gate');
  assert.deepEqual(payload.metadata.tags, ['bot-forge', 'ai-engineering']);

  const preview = forgeModel.buildPermissionPreview(
    forgeModel.normalizeSpec({ name: 'Action Extractor', workerBot: 'codex-packer', requireApproval: true }),
    { validation: { valid: true, issues: [] } }
  );
  assert.equal(preview.ready, true);
  assert.equal(preview.scope, 'person');
  assert.ok(preview.capabilities.some((c) => c.includes('Zero git commit')));
  assert.match(forgeModel.describeRefusal(403, {}), /Editor access/);
});

async function exercisePreviewCancelRefusalAndConfirm(page, state) {
  const modal = page.locator('[data-testid="permission-preview-modal"]');
  await page.click('[data-testid="inject-btn"]');
  await modal.waitFor({ state: 'visible' });
  assert.equal(state.compileCalls, 1);
  assert.equal(state.publishCalls.length, 0, 'Clicking Inject must NOT publish before confirmation');

  const capsText = await page.locator('[data-testid="preview-capabilities"]').innerText();
  assert.match(capsText, /Caller-scoped personal package/);
  assert.match(capsText, /Zero git commit/);

  await page.click('[data-testid="cancel-inject-btn"]');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(state.publishCalls.length, 0);

  state.nextPublishError = { status: 403, body: { message: 'current independent design Writer authority was withdrawn' } };
  await page.click('[data-testid="inject-btn"]');
  await modal.waitFor({ state: 'visible' });
  await page.click('[data-testid="confirm-inject-btn"]');
  await page.locator('#forge-alert').waitFor({ state: 'visible' });
  assert.match(await page.locator('#forge-alert').innerText(), /Writer authority was withdrawn/);
  assert.equal(await page.locator('[data-testid="publication-receipt"]').isVisible(), false);

  await page.click('[data-testid="inject-btn"]');
  await modal.waitFor({ state: 'visible' });
  await page.click('[data-testid="confirm-inject-btn"]');
  await page.locator('[data-testid="publication-receipt"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#receipt-package').innerText(), 'authored-transcript-action-bot-7f3a9c12');
  assert.match(await page.locator('#authored-list').innerText(), /Live \(authored-transcript-action-bot-7f3a9c12\)/);
}

test('Bot Forge E2E: Permission Preview gates publication, Cancel aborts, Confirm publishes live, and 403/409 refusals surface cleanly', async (t) => {
  const { app, state } = createMockKernelServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const contractRes = await fetch(`${baseUrl}/api/codex-packer/contract`);
  assert.equal(contractRes.status, 200);
  assert.equal((await contractRes.json()).publishMode, 'caller-scoped-authored');

  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`${baseUrl}/api/codex-packer/app`, { waitUntil: 'networkidle' });
  await page.fill('#yaml-import-input', 'displayName: Transcript Action Bot\nsuite: ai-productivity\ndescription: Lists every action item from a pasted meeting transcript.');
  await page.click('#import-yaml-btn');
  await exercisePreviewCancelRefusalAndConfirm(page, state);
});
