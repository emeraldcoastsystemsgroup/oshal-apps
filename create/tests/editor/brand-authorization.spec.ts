/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the brand kit's role grants and exact bindings through the real core policy runtime and route mounter, with the business database deliberately unavailable.
 */
import { beforeEach, afterEach, expect, it } from 'vitest';
import { createAuthorizationBoundaryFixture } from './authorization-boundary.fixture';
let fixture: Awaited<ReturnType<typeof createAuthorizationBoundaryFixture>>;
beforeEach(async () => { fixture = await createAuthorizationBoundaryFixture(); });
afterEach(async () => { await fixture?.close(); });

const KIT = { version: 1, name: 'Synthetic brand', colors: { primary: '#7d2ae8', secondary: '#00c4cc', accent: '#ff7a59', dark: '#1d1733', light: '#ffffff' },
  extras: [], fonts: { heading: 'Century Gothic', body: 'Calibri' }, voice: '', logo: null };
const ACCESS: Record<string, { read: boolean; change: boolean }> = {
  viewer: { read: false, change: false }, reader: { read: true, change: false }, creator: { read: true, change: false },
  editor: { read: true, change: true }, exporter: { read: true, change: false }, admin: { read: true, change: true },
};

// A permitted request reaches the store, whose database is deliberately unavailable (503); a refused one never does (403).
for (const [role, access] of Object.entries(ACCESS)) it(`gives the ${role} role exactly its brand access`, async () => {
  await fixture.change(role);
  expect((await fixture.call('/brand')).status).toBe(200);
  expect((await fixture.call('/brand-kit')).status).toBe(access.read ? 503 : 403);
  expect((await fixture.call('/brand-kit', 'alice', 'PUT', { baseRevision: 0, kit: KIT })).status).toBe(access.change ? 503 : 403);
  expect((await fixture.call('/brand-kit', 'alice', 'DELETE', { baseRevision: 1 })).status).toBe(access.change ? 503 : 403);
  expect((await fixture.call('/brand-kit/logo', 'alice', 'POST', {})).status).toBe(access.change ? 400 : 403);
  expect(fixture.pool.calls).toBe(Number(access.read) + 2 * Number(access.change));
});

it('serves the Brand Kit page and its modules only behind view permission and the exact allowlist', async () => {
  expect((await fixture.call('/brand', '')).status).toBe(401);
  expect((await fixture.call('/brand')).status).toBe(403);
  await fixture.change('viewer');
  for (const name of ['brand-kit.mjs', 'brand-page.mjs', 'brand-editor.mjs', 'brand.css']) expect((await fixture.call('/editor/' + name)).status).toBe(200);
  expect((await fixture.call('/brand', 'alice', 'POST', {})).status).toBe(403);
  expect((await fixture.call('/brand-kit/other')).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});

it('refuses selectors, foreign issuers and a legacy app-admin assignment before any brand work', async () => {
  await fixture.change('admin');
  expect((await fixture.call('/brand-kit?tenantId=another')).status).toBe(400);
  expect((await fixture.call('/brand-kit?workspace=another')).status).toBe(403);
  expect((await fixture.call('/brand-kit', 'collision')).status).toBe(403);
  await fixture.store.transaction(async ({ state }) => {
    const row = state.assignments.find(item => item.app === 'create' && item.role === 'admin')!;
    row.role = '@app-admin';
  });
  expect((await fixture.call('/brand-kit')).status).toBe(403);
  expect((await fixture.call('/brand-kit', 'alice', 'PUT', { baseRevision: 0, kit: KIT })).status).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});
