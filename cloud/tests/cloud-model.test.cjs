/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.1 (T73): the Cloud Accounts screen's Projects card from GET /api/cloud/gcp/projects: billing in words and tones, the tiles, Reconnect Google Cloud when Google hides billing, Connect when there is no connection, and a failed read said as such.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const C = require(path.join(__dirname, '..', 'ui', 'cloud-model.js')).CloudHome;
const plain = (v) => JSON.parse(JSON.stringify(v));
const PROJECTS = [
  { name: 'My First Project', projectId: 'tactical-gate-1', status: 'real billing', billingAccountName: 'My Billing Account' },
  { name: 'Gemini Project', projectId: 'gemini-project-2', status: 'linked to a closed billing account', billingAccountName: 'My Billing Account 1' },
  { name: 'My Project 81556', projectId: 'vernal-union-3', status: 'no billing', billingAccountName: null },
];

test('each project shows its billing in words with a tone, and the tiles count projects and real billing', () => {
  const v = plain(C.projectsView(200, { projects: PROJECTS, billingVisible: true }));
  assert.equal(v.state, 'listed');
  assert.deepEqual(v.rows.map((r) => [r.name, r.id, r.label, r.tone]), [
    ['My First Project', 'tactical-gate-1', 'real billing · My Billing Account', 'ok'],
    ['Gemini Project', 'gemini-project-2', 'linked to a closed billing account · My Billing Account 1', 'warn'],
    ['My Project 81556', 'vernal-union-3', 'no billing', 'muted'],
  ]);
  assert.deepEqual(v.tiles, [{ label: 'Projects', value: '3' }, { label: 'With real billing', value: '1' }]);
  assert.deepEqual([v.reconnect, v.connect, v.note], [false, false, '']);
});

test('billing Google will not show offers Reconnect Google Cloud, with the reason, and claims no billing count', () => {
  const hidden = PROJECTS.map((p) => ({ ...p, status: 'billing not visible: reconnect Google Cloud to let this app read billing', billingAccountName: null }));
  const v = plain(C.projectsView(200, { projects: hidden, billingVisible: false }));
  assert.equal(v.reconnect, true);
  assert.match(v.note, /Press Reconnect Google Cloud and allow billing access/);
  assert.deepEqual(v.rows.map((r) => [r.label, r.tone]), [['billing hidden', 'muted'], ['billing hidden', 'muted'], ['billing hidden', 'muted']]);
  assert.deepEqual(v.tiles, [{ label: 'Projects', value: '3' }], 'no real-billing count it cannot know');
});

test('no projects, no connection, a refused connection and a failed read are each said', () => {
  const empty = plain(C.projectsView(200, { projects: [], billingVisible: true }));
  assert.deepEqual([empty.state, empty.note], ['empty', 'Your Google account has no Google Cloud projects.']);
  const none = plain(C.projectsView(409, { error: 'connect', message: 'Google Cloud is not connected for you yet. Press Connect Google Cloud on the Cloud Accounts screen.' }));
  assert.deepEqual([none.state, none.connect, none.reconnect], ['refused', true, false]);
  const refused = plain(C.projectsView(409, { error: 'reconnect', message: 'Google Cloud refused the saved connection. Reconnect Google Cloud on the Cloud Accounts screen.' }));
  assert.deepEqual([refused.state, refused.reconnect, refused.connect], ['refused', true, false]);
  const failed = plain(C.projectsView(0, null));
  assert.deepEqual([failed.state, failed.note, failed.rows.length], ['error', 'Your projects could not be read just now.', 0]);
  const broken = plain(C.projectsView(502, { error: 'provider_error', message: 'Google Cloud could not be read right now.' }));
  assert.deepEqual([broken.state, broken.note], ['error', 'Google Cloud could not be read right now.']);
});
