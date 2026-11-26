/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.6 (CREATE-TOOL-VIDEO-04, -09, -12): prove owned uploaded media listing -> addSource/addClip, non-destructive revision history & restore ("undo that" and explicit revision), and duplicateClip / renameTrack / deleteTrack across pure models, forced-RLS PostgreSQL HTTP routes, concierge contract/tools, and real Chromium Playwright UI at 1440x900 and 412x915.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { bedProbe, clipProbe, mediaBytes, mediaForm, startApi } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';
import { addSource, appendSegment, createTimeline, duplicateSegment, patchSegment } from '../tools/editor/timeline-model.mjs';
import { applyMultitrack } from '../tools/editor/multitrack-model.mjs';
import { applyAgentOperations, blankProject, editingContract } from '../tools/editor/agent-tools.mjs';

const PHONE = { viewport: { width: 412, height: 915 }, device: { isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const SRC = { asset: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'video', name: 'Clip A', frames: 90, width: 1280, height: 720, audio: true };

let database, cleanup, browser;
before(async () => {
  database = await startPostgres(cb => { cleanup = cb; });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(database.admin); });

test('model and editing-contract support duplicateClip (preserving all settings), renameTrack, and deleteTrack', () => {
  const contract = editingContract();
  assert.equal(contract.sourceVersion, '1.14.6');
  assert.deepEqual(contract.operations.duplicateClip, ['id', 'track', 'start']);
  assert.deepEqual(contract.operations.renameTrack, ['id', 'name']);
  assert.deepEqual(contract.operations.deleteTrack, ['id']);

  let v1 = addSource(createTimeline('V1 Dup'), SRC).document;
  v1 = appendSegment(v1, 'v1', { in: 10, out: 50 });
  v1 = patchSegment(v1, 's1', { volume: 135, speed: 150, look: { id: 'warm', strength: 70 }, stabilize: 'standard' });
  const dupV1 = duplicateSegment(v1, 's1');
  assert.equal(dupV1.document.segments.length, 2);
  assert.notEqual(dupV1.id, 's1');
  assert.deepEqual({ ...dupV1.document.segments[1], id: 's1' }, dupV1.document.segments[0]);

  let v2 = applyAgentOperations(blankProject({ title: 'V2 Parity' }), [
    { type: 'addSource', sourceMetadata: SRC },
    { type: 'addClip', track: 'video1', sourceKey: 'v1', start: 0, in: 10, out: 40 },
  ]);
  const origId = v2.tracks[0].clips[0].id;
  v2 = applyAgentOperations(v2, [
    { type: 'clip', id: origId, patch: { volume: 140, opacity: 75, scale: 120, x: 15, y: -10, brightness: 12, contrast: 115, saturation: 130, fadeIn: 5, fadeOut: 5, transition: 'black', speed: 150, look: { id: 'cinema', strength: 85 }, stabilize: 'light', keys: [{ frame: 0, property: 'opacity', value: 75, interpolation: 'linear' }] } },
    { type: 'duplicateClip', id: origId },
  ]);
  assert.equal(v2.tracks[0].clips.length, 2);
  const [first, second] = v2.tracks[0].clips;
  assert.notEqual(first.id, second.id);
  assert.equal(second.start, 20, 'placed immediately after 20-frame (30f @ 1.5x) original clip');
  for (const field of ['source', 'in', 'out', 'volume', 'opacity', 'scale', 'x', 'y', 'brightness', 'contrast', 'saturation', 'fadeIn', 'fadeOut', 'transition', 'speed', 'look', 'stabilize', 'keys']) {
    assert.deepEqual(second[field], first[field], `duplicateClip preserves ${field}`);
  }

  v2 = applyAgentOperations(v2, [
    { type: 'addTrack', kind: 'video', name: 'Overlay' },
    { type: 'renameTrack', id: 'video1', name: 'Main A-Roll' },
  ]);
  assert.equal(v2.tracks[0].name, 'Main A-Roll');
  const overlayId = v2.tracks[2].id;
  const dupOnOverlay = applyAgentOperations(v2, [{ type: 'duplicateClip', id: origId, track: overlayId, start: 60 }]);
  assert.equal(dupOnOverlay.tracks[2].clips.length, 1);
  assert.equal(dupOnOverlay.tracks[2].clips[0].start, 60);

  const afterDelOverlay = applyAgentOperations(dupOnOverlay, [{ type: 'deleteTrack', id: overlayId }]);
  assert.equal(afterDelOverlay.tracks.length, 2);
  const afterDelAudio = applyAgentOperations(afterDelOverlay, [{ type: 'deleteTrack', id: 'audio1' }]);
  assert.equal(afterDelAudio.tracks.length, 1);
  assert.throws(() => applyAgentOperations(afterDelAudio, [{ type: 'deleteTrack', id: 'video1' }]), /last remaining track/);

  const lockedDoc = applyMultitrack(afterDelOverlay, { type: 'track', id: 'audio1', patch: { locked: true } });
  assert.throws(() => applyAgentOperations(lockedDoc, [{ type: 'renameTrack', id: 'audio1', name: 'Nope' }]), /Unlock/);
  assert.throws(() => applyAgentOperations(lockedDoc, [{ type: 'deleteTrack', id: 'audio1' }]), /Unlock/);

  let linkedDoc = applyAgentOperations(v2, [{ type: 'extractAudio', id: origId, track: 'audio1' }]);
  assert.ok(linkedDoc.tracks[0].clips[0].link);
  const unlinkedAfterTrackDel = applyAgentOperations(linkedDoc, [{ type: 'deleteTrack', id: 'audio1' }]);
  assert.equal(unlinkedAfterTrackDel.tracks[0].clips[0].link, undefined, 'deleting audio track unlinks surviving video partner cleanly');
});

test('HTTP and PostgreSQL prove GET /editor/media -> addSource/addClip, timeline ops, and non-destructive revision restore', async t => {
  const api = await startApi(t, database.pool);
  const upVideo = await api.call('/editor/media?kind=video', 'POST', mediaForm(mediaBytes('video', clipProbe({ seconds: 3 })), 'yesterday.mp4'));
  assert.equal(upVideo.status, 201);
  const upAudio = await api.call('/editor/media?kind=audio', 'POST', mediaForm(mediaBytes('audio', bedProbe({ seconds: 5 })), 'music.wav'));
  assert.equal(upAudio.status, 201);

  const listAlice = await api.call('/editor/media');
  assert.equal(listAlice.status, 200);
  assert.equal(listAlice.body.media.length, 2);
  const vidItem = listAlice.body.media.find(m => m.id === upVideo.body.media.id);
  assert.equal(vidItem.mimeType, 'video/mp4');
  assert.ok(vidItem.createdAt && vidItem.title);
  assert.equal(vidItem.sourceMetadata.asset, upVideo.body.media.id);
  assert.equal(vidItem.sourceMetadata.kind, 'video');
  assert.deepEqual((await api.call('/editor/media', 'GET', undefined, 'bob')).body, { media: [] }, 'foreign owner sees zero uploads');

  const created = await api.call('/editor/agent-projects', 'POST', { title: 'Parity Cut' });
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;

  const noPrior = await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', {});
  assert.deepEqual([noPrior.status, noPrior.body], [409, { error: 'video_edit_no_prior_revision' }]);

  const rev2 = await api.call(`/editor/projects/${projectId}/operations`, 'POST', {
    id: projectId, baseRevision: 1,
    operations: [
      { type: 'addSource', sourceMetadata: vidItem.sourceMetadata },
      { type: 'addClip', track: 'video1', sourceKey: 'v1', start: 0, in: 0, out: 45 },
    ],
  });
  assert.equal(rev2.status, 201, JSON.stringify(rev2.body));
  assert.equal(rev2.body.project.revision, 2);
  const clipId = rev2.body.project.document.tracks[0].clips[0].id;

  const rev3 = await api.call(`/editor/projects/${projectId}/operations`, 'POST', {
    id: projectId, baseRevision: 2,
    operations: [
      { type: 'clip', id: clipId, patch: { volume: 125, opacity: 80 } },
      { type: 'duplicateClip', id: clipId },
      { type: 'renameTrack', id: 'video1', name: 'Primary Video' },
      { type: 'addTrack', kind: 'video', name: 'Temp Track' },
    ],
  });
  assert.equal(rev3.status, 201, JSON.stringify(rev3.body));
  assert.equal(rev3.body.project.revision, 3);
  assert.equal(rev3.body.project.document.tracks[0].name, 'Primary Video');
  assert.equal(rev3.body.project.document.tracks[0].clips.length, 2);
  assert.equal(rev3.body.project.document.tracks[0].clips[1].volume, 125);
  assert.equal(rev3.body.project.document.tracks[0].clips[1].opacity, 80);

  const tempTrackId = rev3.body.project.document.tracks[2].id;
  const rev4 = await api.call(`/editor/projects/${projectId}/operations`, 'POST', {
    id: projectId, baseRevision: 3,
    operations: [{ type: 'deleteTrack', id: tempTrackId }],
  });
  assert.equal(rev4.status, 201);
  assert.equal(rev4.body.project.document.tracks.length, 2);

  const hist = await api.call(`/editor/projects/${projectId}/revisions`);
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.body.revisions.map(r => r.revision), [4, 3, 2, 1]);
  assert.ok(hist.body.revisions.every(r => typeof r.summary === 'string' && r.summary.length > 0));

  const alreadyCurrent = await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', { revision: 4 });
  assert.deepEqual([alreadyCurrent.status, alreadyCurrent.body], [409, { error: 'video_edit_revision_already_current' }]);

  const undoDefault = await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', { id: projectId });
  assert.equal(undoDefault.status, 201, JSON.stringify(undoDefault.body));
  assert.equal(undoDefault.body.restoredFromRevision, 3);
  assert.equal(undoDefault.body.project.revision, 5);
  assert.equal(undoDefault.body.project.document.tracks.length, 3, 'restored revision 3 with Temp Track back');

  const restoreExplicit = await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', { revision: 2, baseRevision: 5 });
  assert.equal(restoreExplicit.status, 201, JSON.stringify(restoreExplicit.body));
  assert.equal(restoreExplicit.body.restoredFromRevision, 2);
  assert.equal(restoreExplicit.body.project.revision, 6);
  assert.equal(restoreExplicit.body.project.document.tracks[0].name, 'Video 1');
  assert.equal(restoreExplicit.body.project.document.tracks[0].clips.length, 1);

  assert.equal((await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', { revision: 2, baseRevision: 5 })).status, 409);
  assert.equal((await api.call(`/editor/projects/${projectId}/revisions/restore`, 'POST', { revision: 1 }, 'bob')).status, 404);
  const histAfter = await api.call(`/editor/projects/${projectId}/revisions`);
  assert.deepEqual(histAfter.body.revisions.map(r => r.revision), [6, 5, 4, 3, 2, 1], 'all earlier revisions preserved immutably');
});

test('Chromium UI proves Uploaded library, Duplicate clip, Rename/Delete track, and Version history Restore at 1440x900 and 412x915', async t => {
  for (const [label, options] of [['desktop 1440x900', DESKTOP], ['phone 412x915', PHONE]]) {
    const touch = label.startsWith('phone');
    const press = (page, loc) => touch ? loc.tap() : loc.click();
    const { page, api, errors } = await openEditor(t, browser, database, { ...options, theme: 'graphite' });
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.type()); void d.dismiss(); });

    const preUpload = await api.call('/editor/media?kind=video', 'POST', mediaForm(mediaBytes('video', clipProbe({ seconds: 2 })), 'library-clip.mp4'));
    assert.equal(preUpload.status, 201);

    await press(page, page.locator('[data-ds-toolrow]').getByRole('button', { name: /Add/ }), touch);
    const addSheet = page.locator('dialog.ds-layer[open][aria-label="Add media"]');
    await addSheet.waitFor();
    const useUploadBtn = addSheet.locator(`[data-use-uploaded-media="${preUpload.body.media.id}"]`);
    await useUploadBtn.waitFor();
    await press(page, useUploadBtn);
    await page.locator('#status').filter({ hasText: /added to timeline/ }).waitFor();
    await page.goBack(); await addSheet.waitFor({ state: 'detached' });

    await press(page, page.locator('#track .segment').first());
    const dupBtn = page.locator('[data-ds-toolrow]').getByRole('button', { name: /Duplicate/ });
    await dupBtn.scrollIntoViewIfNeeded(); await press(page, dupBtn);
    assert.equal(await page.locator('#track .segment').count(), 2, `${label}: v1 duplicate creates 2nd segment`);
    await press(page, page.locator('[data-ds-toolrow]').getByRole('button', { name: /Done/ }));

    await press(page, page.locator('#saveProject'));
    await page.locator('#status').filter({ hasText: 'Saved · revision 1' }).waitFor();

    const moreBtn = page.locator('[data-ds-toolrow]').getByRole('button', { name: /More/ });
    await moreBtn.scrollIntoViewIfNeeded(); await press(page, moreBtn);
    await press(page, page.getByRole('menuitem', { name: /Track, keyframe and caption tools/ }));
    const tracksSheet = page.locator('dialog.ds-layer[open][aria-label="Tracks and captions"]');
    await tracksSheet.waitFor();
    await press(page, tracksSheet.locator('#upgradeMultitrack'));
    await page.goBack(); await tracksSheet.waitFor({ state: 'detached' });

    await page.locator('[data-track-id="video1"]').waitFor();
    await press(page, page.locator('[data-rename-track="video1"]'));
    await page.locator('[data-rename-track-input="video1"]').fill('Hero Video');
    await press(page, page.locator('[data-rename-track-save="video1"]'));
    await page.locator('[data-track-heading="video1"]').filter({ hasText: 'Hero Video · video' }).waitFor();

    await press(page, page.locator('[data-multi-clip]').first());
    const dupV2Btn = page.locator('[data-ds-toolrow]').getByRole('button', { name: /Duplicate/ });
    await dupV2Btn.scrollIntoViewIfNeeded(); await press(page, dupV2Btn);
    assert.equal(await page.locator('[data-track-id="video1"] [data-multi-clip]').count(), 3, `${label}: v2 duplicate creates 3rd clip`);
    await press(page, page.locator('[data-ds-toolrow]').getByRole('button', { name: /Done/ }));

    await press(page, page.locator('[data-delete-track="audio1"]'));
    assert.equal(await page.locator('[data-track-id]').count(), 1, `${label}: audio1 track deleted`);
    assert.equal(await page.locator('[data-delete-track="video1"]').isDisabled(), true, `${label}: sole remaining track cannot be deleted`);

    await press(page, page.locator('#saveProject'));
    await page.locator('#status').filter({ hasText: 'Saved · revision 2' }).waitFor();

    await press(page, page.getByRole('button', { name: 'Project', exact: true }));
    await press(page, page.getByRole('menuitem', { name: 'Version history…' }));
    const revSheet = page.locator('dialog.ds-layer[open][aria-label="Version history"]');
    await revSheet.waitFor();
    await revSheet.locator('[data-restore-revision="1"]').waitFor();
    assert.equal(await revSheet.locator('[data-restore-revision="2"]').isDisabled(), true, `${label}: current revision Restore disabled`);
    await press(page, revSheet.locator('[data-restore-revision="1"]'));
    await revSheet.locator('[data-revisions-status]').filter({ hasText: 'Restored revision 1 as revision 3.' }).waitFor();
    assert.equal(await revSheet.locator('[data-revisions-list] li').count(), 3, `${label}: all 3 revisions preserved`);
    await page.goBack(); await revSheet.waitFor({ state: 'detached' });

    assert.equal(await page.locator('#track .segment').count(), 2, `${label}: restored revision 1 timeline`);
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    assert.ok(overflow <= 1, `${label}: zero horizontal overflow (${overflow}px)`);
    assert.deepEqual(dialogs, [], `${label}: zero native browser dialogs`);
    assert.deepEqual(errors, [], `${label}: zero page errors`);
  }
});

test('concierge persona and manifest declare uploaded media, revision restore, and timeline management parity', async () => {
  const persona = await readFile(new URL('../personas/video-editor.yaml', import.meta.url), 'utf8');
  assert.match(persona, /video-list-media/);
  assert.match(persona, /video-list-revisions/);
  assert.match(persona, /video-restore-revision/);
  assert.match(persona, /duplicateClip/);
  assert.match(persona, /renameTrack/);
  assert.match(persona, /deleteTrack/);
});
