/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Headless Test Lab case at the Jarvis package-tool seam (success): with this package mounted on the real core seam, a super-admin turns dev mode on through the same-origin package route, Jarvis discovers dev_workspace_search in the catalog, and asks naming an ADR number, a backlog entry title, a runbook and tonight's handover each return the cited doc_id of the built index; a consumed proposal never replays its result.
 *
 * FRAMEWORK-COUPLED: needs a core checkout. Run locally:
 *   OSHAL_CORE_DIR=<framework checkout with node_modules> node --test tests/jarvis.core.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { ACTORS, FIXTURE_CHECKOUT, startHarness } = require('./core.fixture.js');
const { buildIndex, writeIndex } = require('../tools/workspace-index');

const TOOL = 'dev_workspace_search';
let harness; let index; let tmp;
const docId = (relative) => index.documents.find((doc) => doc.path === relative).doc_id;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workspace-seam-'));
  index = buildIndex({ root: FIXTURE_CHECKOUT });
  harness = await startHarness({ indexFile: writeIndex(index, path.join(tmp, 'index.json')) });
  await harness.grant(ACTORS.alice);
});
after(async () => {
  if (harness) await harness.stop();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('a super-admin turns dev mode on through the same-origin package route and reads the index status', async () => {
  const before = await harness.call('/api/dev-workspace-index/dev-mode');
  assert.equal(before.status, 200);
  assert.deepEqual([before.json.superAdmin, before.json.devConsoleEnabled, before.json.packageEnabled, before.json.devMode.enabled], [true, true, true, false]);
  const on = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST' });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.devMode.enabled, true);
  const status = await harness.call('/api/dev-workspace-index/status');
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.counts.documents, 5);
  assert.equal(status.json.collection, 'dev-workspace-local');
});

test('Jarvis discovers the tool and an ADR-number ask returns the cited doc_id from this corpus', async () => {
  const { catalog, preview, execute } = await harness.jarvis('alice', TOOL, { query: 'ADR-077' });
  assert.equal(catalog.status, 200, catalog.text);
  const tool = catalog.json.tools.find((entry) => entry.name === TOOL);
  assert.equal(tool.app, 'dev-workspace-index');
  assert.equal(tool.mode, 'auto', 'a read-only binding lets Jarvis propose without a confirmation panel');
  assert.match(tool.usage, /doc_id/);
  assert.equal(preview.status, 200, preview.text);
  assert.equal(execute.status, 200, execute.text);
  assert.equal(execute.json.result.results[0].doc_id, docId('docs/adr/077-self-developing-platform.md'));
  assert.equal(execute.json.result.results[0].path, 'docs/adr/077-self-developing-platform.md');
  assert.match(execute.json.result.citation, /doc_id/);
});

test('a backlog entry title ask returns the cited BACKLOG doc_id', async () => {
  const { execute } = await harness.jarvis('alice', TOOL, { query: 'Jarvis in dev mode should see what this workspace sees', limit: 3 });
  assert.equal(execute.status, 200, execute.text);
  assert.equal(execute.json.result.results[0].doc_id, docId('docs/BACKLOG.md'));
});

test('a runbook ask returns the cited runbook doc_id', async () => {
  const { execute } = await harness.jarvis('alice', TOOL, { query: 'deploy parity runbook' });
  assert.equal(execute.status, 200, execute.text);
  assert.equal(execute.json.result.results[0].doc_id, docId('docs/runbooks/deploy-parity.md'));
});

test('tonight\'s handover resolves to the handover note with its doc_id', async () => {
  const { execute } = await harness.jarvis('alice', TOOL, { query: 'tonight handover' });
  assert.equal(execute.status, 200, execute.text);
  assert.equal(execute.json.result.results[0].path, 'docs/backlog/session-handover-2026-09-26.md');
  assert.equal(execute.json.result.results[0].doc_id, docId('docs/backlog/session-handover-2026-09-26.md'));
});

test('a consumed proposal is never replayed and the HTTP query route cites the same doc_id', async () => {
  const { preview, execute } = await harness.jarvis('alice', TOOL, { query: 'ADR-077' });
  assert.equal(execute.status, 200, execute.text);
  const replay = await harness.call('/api/jarvis/package-tools/result', { body: { proposalId: preview.json.id } });
  assert.equal(replay.status, 410);
  assert.ok(!replay.text.includes('doc_id'));
  const http = await harness.call('/api/dev-workspace-index/query?q=ADR-077');
  assert.equal(http.status, 200, http.text);
  assert.equal(http.json.results[0].doc_id, docId('docs/adr/077-self-developing-platform.md'));
});
