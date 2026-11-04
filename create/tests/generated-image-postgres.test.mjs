/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.16.0: prove a picture from a sentence against the real migrations in a disposable PostgreSQL, over real HTTP, with the explicitly named fixture provider: a new project, a layer added to a named one, another owner refused, a failed generation leaving nothing, and the daily ceiling counted from saved images; a waking generator is asked again, and one call makes and draws a project.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres, resetPostgres } from './project-postgres.fixture.mjs';
import { startApi, input } from './project-api.fixture.mjs';
import { fixtureProvider } from './region-edit.fixture.mjs';

let db, cleanup;
after(async () => { await cleanup?.(); });
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); });
beforeEach(async () => { await resetPostgres(db.admin); });

async function start(t, options = {}) {
  const fixture = fixtureProvider({ costClass: 'free', costUsd: null, ...options.provider });
  const settings = { dailyCap: 20, concurrency: 1, timeoutMs: 10000, imageDailyCap: options.cap ?? 20, imageRetryMs: 5 };
  const api = await startApi(t, db.pool, { regionEdits: { dependencies: fixture.dependencies, settings } });
  return { api, fixture };
}

test('a sentence makes a new project whose one layer is the saved picture', async t => {
  const { api, fixture } = await start(t);
  const made = await api.call('/generated-images', 'POST', { prompt: 'a cartoon rocket ship', title: 'Rocket' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const { project } = made.body;
  assert.equal(project.title, 'Rocket'); assert.equal(project.revision, 1);
  assert.deepEqual(fixture.calls.map(call => call.prompt), ['a cartoon rocket ship']);
  const [layer] = project.document.layers;
  assert.equal(layer.type, 'image'); assert.equal(project.document.width, 64); assert.equal(project.document.height, 48);
  const image = project.document.images[layer.assetId];
  const bytes = await fetch(api.origin + image.src, { headers: { 'x-fixture-actor': 'alice' } });
  assert.equal(bytes.status, 200, 'the saved picture is served to its owner');
  assert.equal((await api.call(`/projects/${project.id}`)).body.project.revision, 1, 'it reads back from the store');
});

test('with an id the picture is a new centred layer and one new revision, and the rest of the project is kept', async t => {
  const { api } = await start(t);
  const layers = [{ id: 'title', type: 'text', name: 'Title', text: 'Keep me', x: 10, y: 10, w: 200, h: 40 }];
  const created = await api.call('/projects', 'POST', input('Poster', {}, layers));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id, document } = created.body.project;
  const added = await api.call('/generated-images', 'POST', { id, prompt: 'a night sky' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.project.revision, 2);
  assert.deepEqual(added.body.project.document.layers.map(layer => layer.id === 'title' ? layer.text : layer.type), ['Keep me', 'image']);
  const picture = added.body.project.document.layers[1];
  assert.equal(picture.x, Math.round((document.width - picture.w) / 2), 'centred on the canvas');
});

test('another owner cannot add to a project, and a failed generation saves nothing', async t => {
  const { api, fixture } = await start(t);
  const { body } = await api.call('/generated-images', 'POST', { prompt: 'mine', title: 'Mine' });
  const foreign = await api.call('/generated-images', 'POST', { id: body.project.id, prompt: 'theirs' }, 'bob');
  assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
  assert.equal(fixture.calls.length, 1, 'the provider was never asked for the other owner');
  fixture.setMode('fail');
  const failed = await api.call('/generated-images', 'POST', { prompt: 'will fail', title: 'Failed' });
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'image_generation_failed');
  assert.match(failed.body.detail, /refused this synthetic request/, 'the provider\'s own words reach the person');
  assert.equal((await api.call('/projects')).body.projects.length, 1, 'no project from the failure');
});

test('the daily ceiling refuses before the provider is asked', async t => {
  const { api, fixture } = await start(t, { cap: 1 });
  assert.equal((await api.call('/generated-images', 'POST', { prompt: 'one', title: 'One' })).status, 201);
  const refused = await api.call('/generated-images', 'POST', { prompt: 'two', title: 'Two' });
  assert.equal(refused.status, 429); assert.equal(refused.body.error, 'image_daily_cap_reached');
  assert.equal(fixture.calls.length, 1);
  assert.equal((await api.call('/generated-images', 'POST', { prompt: 'bob', title: 'Bob' }, 'bob')).status, 201, 'the ceiling is per person');
});

test('a generator still waking is asked again inside the request, so the person approves once', async t => {
  const { api, fixture } = await start(t, { provider: { startingFor: 2 } });
  const made = await api.call('/generated-images', 'POST', { prompt: 'a rocket', title: 'Rocket' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(fixture.calls.length, 3, 'two answers that it is starting, then the picture');
});

test('one call makes a project and draws it, and a refused batch leaves no project and says why', async t => {
  const { api } = await start(t);
  const hull = { type: 'add', layer: { id: 'hull', type: 'rect', name: 'Hull', x: 10, y: 10, w: 50, h: 100, fill: 'red' } };
  const made = await api.call('/agent-projects', 'POST', { title: 'Rocket', background: 'white', operations: [hull] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.project.document.layers.map(layer => [layer.name, layer.fill]), [['Hull', '#ff0000']]);
  assert.equal(made.body.project.document.background, '#ffffff');
  const refused = await api.call('/agent-projects', 'POST', { title: 'Bad', operations: [{ type: 'add', layer: { id: 'x', type: 'shape', x: 0, y: 0, w: 1, h: 1 } }] });
  assert.equal(refused.status, 400); assert.equal(refused.body.detail, 'Unsupported layer type');
  assert.equal((await api.call('/projects')).body.projects.length, 1, 'only the good project exists');
});
