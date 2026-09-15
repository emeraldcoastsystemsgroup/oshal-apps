/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify role-specific permissions and exact HTTP/asset admission through the real core mounter without business persistence.
 */
import { beforeEach, afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAuthorizationBoundaryFixture, PACKAGE, RECORD } from './authorization-boundary.fixture';
let fixture: Awaited<ReturnType<typeof createAuthorizationBoundaryFixture>>;
beforeEach(async () => { fixture = await createAuthorizationBoundaryFixture(); });
afterEach(async () => { await fixture?.close(); });

const ROLES: Record<string, string[]> = {
  viewer: ['view'], reader: ['view', 'read'], creator: ['view', 'read', 'create'],
  editor: ['view', 'read', 'change'], exporter: ['view', 'read', 'export'],
  admin: ['view', 'read', 'create', 'change', 'delete', 'export'],
};

for (const [role, actions] of Object.entries(ROLES)) it(`reports only the ${role} role's real effective operations`, async () => {
  await fixture.change(role);
  const permissions = await fixture.call('/permissions'); expect(permissions.status).toBe(200);
  expect((await permissions.json()).permissions).toEqual(Object.fromEntries(
    ['view', 'read', 'create', 'change', 'delete', 'export'].map(action => [action, actions.includes(action)])));
  expect((await fixture.call('/editor')).status).toBe(200);
  const create = await fixture.call('/projects', 'alice', 'POST', {});
  expect(create.status).toBe(actions.includes('create') ? 400 : 403);
  const save = await fixture.call(`/projects/${RECORD}/revisions`, 'alice', 'POST', {});
  expect(save.status).toBe(actions.includes('change') ? 400 : 403);
  const remove = await fixture.call(`/projects/${RECORD}`, 'alice', 'DELETE', {});
  expect(remove.status).toBe(actions.includes('delete') ? 400 : 403);
  const upload = await fixture.call('/project-assets', 'alice', 'POST', {});
  expect(upload.status).toBe(actions.includes('create') || actions.includes('change') ? 400 : 403);
  expect(fixture.pool.calls).toBe(0);
});

it('keeps authenticated shell/module reads behind named view permission and an exact asset allowlist', async () => {
  expect((await fixture.call('/editor', '')).status).toBe(401);
  expect((await fixture.call('/editor')).status).toBe(403);
  expect((await fixture.call('/editor', 'operator')).status).toBe(403);
  await fixture.change('viewer');
  const theme = await fixture.call('/theme/create.css'); expect(theme.status).toBe(200);
  expect(await theme.text()).toBe(readFileSync(join(PACKAGE, 'ui/create.css'), 'utf8'));
  expect((await fixture.call('/theme/not-packaged.css')).status).toBe(404);
  for (const name of ['model.mjs', 'model-validation.mjs', 'renderer.mjs', 'editor.css']) {
    const response = await fixture.call('/editor/' + name); expect(response.status).toBe(200);
    expect(await response.text()).toBe(readFileSync(join(PACKAGE, 'tools/editor', name), 'utf8'));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await fixture.call('/editor/' + name, 'alice', 'POST', {})).status).toBe(403);
    expect((await fixture.call('/editor/' + name, 'alice', 'HEAD')).status).toBe(403);
  }
  expect((await fixture.call('/editor/not-packaged.mjs')).status).toBe(404);
  expect((await fixture.call('/authorization.yaml')).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});

it('keeps export and asset cleanup bound separately from read access', async () => {
  await fixture.change('reader');
  expect((await fixture.call(`/projects/${RECORD}/export`)).status).toBe(403);
  expect((await fixture.call('/project-assets/cleanup', 'alice', 'POST', {})).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
  await fixture.change('exporter');
  expect((await fixture.call(`/projects/${RECORD}/export`)).status).toBe(503);
  expect(fixture.pool.calls).toBe(1);
  await fixture.change('admin');
  const cleanup = await fixture.call('/project-assets/cleanup', 'alice', 'POST', {});
  expect(cleanup.status).toBe(503); expect((await cleanup.json()).error).toBe('project_service_unavailable');
  expect(fixture.pool.calls).toBe(2);
});

it('refuses foreign issuers, explicit tenant/owner selectors, revocation and app deny before private work', async () => {
  await fixture.change('admin');
  expect((await fixture.call('/permissions', 'collision')).status).toBe(403);
  expect((await fixture.call('/permissions?owner=another')).status).toBe(400);
  expect((await fixture.call('/permissions?tenantId=another')).status).toBe(400);
  expect((await fixture.call('/permissions?workspace=another')).status).toBe(403);
  await fixture.change('admin', 'alice', 'revoke');
  expect((await fixture.call('/permissions')).status).toBe(403);
  await fixture.change('admin'); await fixture.change(undefined, 'alice', 'deny');
  expect((await fixture.call('/editor')).status).toBe(403);
  expect((await fixture.call(`/project-assets/${RECORD}`)).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});

it('does not translate a legacy app-admin assignment into named project permissions', async () => {
  await fixture.change('admin');
  await fixture.store.transaction(async ({ state }) => {
    const row = state.assignments.find(row => row.app === 'create' && row.role === 'admin')!;
    row.role = '@app-admin';
  });
  expect((await fixture.call('/editor')).status).toBe(403);
  expect((await fixture.call('/permissions')).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});
