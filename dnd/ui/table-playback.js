/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:08:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add read-only timeline playback with honest board gaps, exact snapshot maps, roll details, scrubbing, stepping, speed controls, and separately confirmed rewind branching.
 * 2026-07-23 11:10:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep an explicit Return to Game control visible at the top of every populated timeline.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Resolve saved scenes across the complete adventure catalog during playback.
 */

'use strict';

let timelinePlaybackSession = null, timelinePlaybackTimer = null, timelinePlaybackRequest = 0;

/** @description Format one persisted timestamp without assuming it exists. */
function playbackTime(value) {
  try { return value ? new Date(value).toLocaleString() : 'time not recorded'; }
  catch (_error) { return 'time not recorded'; }
}

/** @description Return a compact human label for one persisted frame. */
function playbackFrameTitle(frame) {
  if (frame.type === 'snapshot') return frame.label || 'Saved board';
  if (frame.type === 'current') return frame.label || 'Current saved board';
  return `#${Number(frame.seq) || 0} ${String(frame.kind || 'story').replaceAll('-', ' ')}`;
}

/** @description Render exact persisted dice groups without rolling again. */
function playbackRolls(payload) {
  const rolls = payload && Array.isArray(payload.rolls) ? payload.rolls : [];
  if (!rolls.length) return '';
  const rows = rolls.map((roll) => {
    const faces = Array.isArray(roll.faces) ? roll.faces.join(', ') : '';
    const bonus = Number(roll.bonus) ? ` ${Number(roll.bonus) > 0 ? '+' : '-'} ${Math.abs(Number(roll.bonus))}` : '';
    const target = roll.targetName ? ` against ${esc(roll.targetName)}` : '';
    return `<div class="playback-roll"><b>${esc(roll.actorName || 'Roller')}</b><span>${esc(roll.actionName || String(roll.kind || 'roll'))}${target}</span><code>${esc(roll.dice || '')} [${esc(faces)}]${bonus} = ${Number(roll.total) || 0}</code><em>${esc(roll.outcome || '')}</em></div>`;
  });
  return `<div class="playback-rolls">${rows.join('')}</div>`;
}

/** @description Find immutable scene art and grid metadata for a persisted board. */
function playbackScene(state) {
  const adventures = content && content.adventures || [content && content.adventure];
  const scenes = adventures.flatMap((adventure) => adventure && adventure.scenes || []);
  return scenes.find((scene) => scene.id === state.sceneId) || null;
}

/** @description Render one token at its exact captured grid coordinate. */
function playbackToken(token, grid) {
  const x = Number(token.x), y = Number(token.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  const left = Math.max(0, Math.min(100, ((x + 0.5) / grid.w) * 100));
  const top = Math.max(0, Math.min(100, ((y + 0.5) / grid.h) * 100));
  const color = /^#[0-9a-f]{3,8}$/i.test(String(token.color || '')) ? token.color : '#e0a44c';
  const status = token.dead ? 'dead' : token.fled ? 'fled' : Number(token.hp) <= 0 ? 'down' : 'living';
  const glyph = String(token.glyph || token.name || '?').slice(0, 2);
  const title = `${token.name || token.id || 'token'} at (${x}, ${y}) - ${Number(token.hp) || 0}/${Number(token.maxHp) || 0} HP`;
  return `<span class="playback-token ${esc(token.kind || 'token')} ${status}" style="left:${left}%;top:${top}%;border-color:${color}" title="${esc(title)}"><b>${esc(glyph)}</b><small>${esc(String(token.name || token.id || '').split(' ')[0])}</small></span>`;
}

/** @description Render only a genuinely captured board, otherwise show the fidelity gap. */
function playbackBoard(frame) {
  if (!frame.board || !Array.isArray(frame.board.tokens)) {
    return `<div class="playback-gap"><b>Board revision not captured</b><p>${esc(frame.fidelityNote || 'This event has story data only. Token positions are not reconstructed.')}</p></div>`;
  }
  const scene = playbackScene(frame.board), fallbackW = Math.max(1, ...frame.board.tokens.map((token) => Number(token.x) + 1 || 1));
  const fallbackH = Math.max(1, ...frame.board.tokens.map((token) => Number(token.y) + 1 || 1));
  const grid = scene && scene.grid || { w: fallbackW, h: fallbackH };
  const tokens = frame.board.tokens.map((token) => playbackToken(token, grid)).join('');
  const art = scene ? `background-image:linear-gradient(rgba(10,8,6,.22),rgba(10,8,6,.4)),url('${API}/art/map/${encodeURIComponent(scene.id)}')` : '';
  return `<div class="playback-board-wrap"><div class="playback-board" style="${art}">${tokens}</div><div class="playback-board-meta"><b>${esc(scene && scene.title || frame.board.sceneId || 'Saved board')}</b><span>${esc(frame.board.mode || 'unknown mode')} - round ${Number(frame.board.round) || 0}</span></div></div>`;
}

/** @description Render the selected timeline fact and any exact board available beside it. */
function playbackFrameHtml(frame) {
  const branch = frame.branch === 'prior' ? '<span class="playback-warning">PRIOR BRANCH</span>' : '';
  const contentHtml = frame.content ? `<p class="playback-copy">${esc(frame.content)}</p>` : '';
  const restore = frame.restorable ? '<button class="big" id="playbackRestore">Restore / Branch from this Save</button>' : '';
  return `<div class="playback-frame-head"><div><small>${esc(playbackTime(frame.createdAt))}</small><h2>${esc(playbackFrameTitle(frame))}</h2></div><span class="playback-fidelity ${frame.fidelity === 'exact-board' ? 'exact' : 'gap'}">${frame.fidelity === 'exact-board' ? 'EXACT BOARD' : 'LOG ONLY'}</span>${branch}</div>${contentHtml}${playbackRolls(frame.payload)}<p class="playback-note">${esc(frame.fidelityNote || '')}</p>${playbackBoard(frame)}<div class="playback-restore">${restore}</div>`;
}

/** @description Stop passive playback without changing campaign or timeline data. */
function stopTimelinePlayback() {
  if (timelinePlaybackTimer !== null) clearInterval(timelinePlaybackTimer);
  timelinePlaybackTimer = null;
  if (timelinePlaybackSession) timelinePlaybackSession.playing = false;
  if ($('playbackToggle')) $('playbackToggle').textContent = 'Play';
}

/** @description Select one persisted frame without making any API request. */
function selectPlaybackFrame(index) {
  if (!timelinePlaybackSession) return;
  const frames = timelinePlaybackSession.data.frames || [];
  const next = Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
  timelinePlaybackSession.index = next;
  if ($('playbackFrame')) $('playbackFrame').innerHTML = playbackFrameHtml(frames[next]);
  if ($('playbackScrubber')) $('playbackScrubber').value = String(next);
  if ($('playbackPosition')) $('playbackPosition').textContent = `${next + 1} / ${frames.length}`;
  document.querySelectorAll('[data-playback-index]').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.playbackIndex) === next);
  });
  if ($('playbackPrev')) $('playbackPrev').disabled = next === 0;
  if ($('playbackNext')) $('playbackNext').disabled = next === frames.length - 1;
  if ($('playbackRestore')) $('playbackRestore').onclick = () => confirmPlaybackRestore(frames[next]);
}

/** @description Advance passive playback one frame and stop cleanly at the end. */
function tickTimelinePlayback() {
  if (!timelinePlaybackSession) return stopTimelinePlayback();
  const last = timelinePlaybackSession.data.frames.length - 1;
  if (timelinePlaybackSession.index >= last) return stopTimelinePlayback();
  selectPlaybackFrame(timelinePlaybackSession.index + 1);
}

/** @description Start or pause read-only playback at the chosen display speed. */
function toggleTimelinePlayback() {
  if (!timelinePlaybackSession || !(timelinePlaybackSession.data.frames || []).length) return;
  if (timelinePlaybackSession.playing) return stopTimelinePlayback();
  if (timelinePlaybackSession.index >= timelinePlaybackSession.data.frames.length - 1) selectPlaybackFrame(0);
  const speed = Number($('playbackSpeed') && $('playbackSpeed').value) || 1;
  timelinePlaybackSession.playing = true;
  if ($('playbackToggle')) $('playbackToggle').textContent = 'Pause';
  timelinePlaybackTimer = setInterval(tickTimelinePlayback, Math.max(250, 1600 / speed));
}

/** @description Return from playback through the caller-selected non-mutating screen. */
function leaveTimelinePlayback() {
  stopTimelinePlayback(); timelinePlaybackRequest++;
  const back = timelinePlaybackSession && timelinePlaybackSession.options.back;
  timelinePlaybackSession = null;
  if (typeof back === 'function') back(); else closeOverlay();
}

/** @description Bind playback navigation, selection, speed, save, and exit controls. */
function bindTimelinePlaybackControls() {
  $('playbackBack').onclick = leaveTimelinePlayback;
  $('playbackClose').onclick = leaveTimelinePlayback;
  $('playbackPrev').onclick = () => selectPlaybackFrame(timelinePlaybackSession.index - 1);
  $('playbackNext').onclick = () => selectPlaybackFrame(timelinePlaybackSession.index + 1);
  $('playbackToggle').onclick = toggleTimelinePlayback;
  $('playbackScrubber').oninput = (event) => { stopTimelinePlayback(); selectPlaybackFrame(event.target.value); };
  $('playbackSpeed').onchange = () => { if (timelinePlaybackSession.playing) { stopTimelinePlayback(); toggleTimelinePlayback(); } };
  document.querySelectorAll('[data-playback-index]').forEach((button) => {
    button.onclick = () => { stopTimelinePlayback(); selectPlaybackFrame(button.dataset.playbackIndex); };
  });
  if ($('playbackSave')) $('playbackSave').onclick = savePlaybackMoment;
  if ($('playbackLeaveTable')) $('playbackLeaveTable').onclick = () => { stopTimelinePlayback(); void quitToGameMenu(); };
}

/** @description Render the full read-only timeline shell and its honest coverage summary. */
function renderTimelinePlayback() {
  const session = timelinePlaybackSession, data = session.data, frames = data.frames || [];
  if (!frames.length) { overlay(`<h1>Timeline Playback</h1><p>No persisted story or board frames are available.</p><button class="big" id="playbackBack">${esc(session.options.backLabel || 'Back')}</button>`, 'playback'); $('playbackBack').onclick = leaveTimelinePlayback; return; }
  const items = frames.map((frame, index) => `<button class="playback-event" data-playback-index="${index}"><span>${esc(playbackFrameTitle(frame))}</span><small>${frame.fidelity === 'exact-board' ? 'exact board' : 'story / roll only'} - ${esc(playbackTime(frame.createdAt))}</small></button>`).join('');
  const coverage = data.coverage || {}, canSave = session.options.allowSave && data.campaign.is_owner && !data.ended;
  const save = canSave ? '<button class="big ghost" id="playbackSave">Save Current Board</button>' : '';
  const leave = session.options.table ? '<button class="big ghost" id="playbackLeaveTable">Quit to My Games</button>' : '';
  const backLabel = esc(session.options.backLabel || 'Return to Game');
  overlay(`<div class="playback-title"><div><h1>Timeline Playback</h1><p><b>Read-only.</b> Selecting, scrubbing, stepping, or playing never changes the campaign. Restore is a separate confirmed action.</p></div><div class="playback-title-actions"><span>${Number(coverage.archiveEntries) || 0} story beats<br>${Number(coverage.exactBoards) || 0} exact boards</span><button type="button" class="playback-close" id="playbackClose">← ${backLabel}</button></div></div><div class="playback-controls"><button id="playbackPrev">Previous</button><button id="playbackToggle">Play</button><button id="playbackNext">Next</button><label>Speed <select id="playbackSpeed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option></select></label><b id="playbackPosition"></b></div><input id="playbackScrubber" class="playback-scrubber" type="range" min="0" max="${frames.length - 1}" value="${session.index}" aria-label="Timeline position"><div class="playback-layout"><div class="playback-events">${items}</div><div class="playback-frame" id="playbackFrame"></div></div><div class="playback-actions">${save}<button class="big ghost" id="playbackBack">${backLabel}</button>${leave}</div>`, 'playback');
  $('overlayCard').classList.add('playback-wide');
  bindTimelinePlaybackControls(); selectPlaybackFrame(session.index);
}

/** @description Load an authorized campaign timeline through the GET-only playback route. */
async function showCampaignPlayback(campaignId, options) {
  const requestId = ++timelinePlaybackRequest;
  stopTimelinePlayback(); overlay('<h1>Timeline Playback</h1><p><span class="spin"></span> Loading persisted story, rolls, and exact saved boards...</p>', 'playback');
  const result = await api(`/playback?campaignId=${encodeURIComponent(campaignId)}`, { cache: 'no-store' }).catch(() => null);
  if (requestId !== timelinePlaybackRequest) return false;
  if (!result || !result.ok) {
    overlay(`<h1>Playback unavailable</h1><p>${esc(result && result.error || 'The saved timeline could not be loaded.')}</p><button class="big" id="playbackBack">Back</button>`, 'playback');
    $('playbackBack').onclick = () => { if (options && typeof options.back === 'function') options.back(); else closeOverlay(); }; return false;
  }
  const frames = Array.isArray(result.frames) ? result.frames : [];
  timelinePlaybackSession = { campaignId, data: { ...result, frames }, options: options || {}, index: Math.max(0, frames.length - 1), playing: false };
  renderTimelinePlayback(); return true;
}

/** @description Open playback for the currently loaded table without changing its state. */
function showCurrentCampaignPlayback(options) {
  if (!campaign) { banner('Choose a campaign first.'); return false; }
  const terminal = board && ['complete', 'defeat'].includes(board.mode);
  const fallback = terminal && board.mode === 'defeat' ? showDefeatState : terminal ? showResolvedState : closeOverlay;
  return showCampaignPlayback(campaign.campaign_id, {
    table: true, allowSave: !terminal, back: fallback, backLabel: terminal ? 'Back to Summary' : 'Back to Table', ...(options || {}),
  });
}

/** @description Ask separately before any restore can mutate the shared campaign branch. */
function confirmPlaybackRestore(frame) {
  stopTimelinePlayback();
  const legacy = frame.branch === 'legacy' ? '<p class="playback-warning-copy">This legacy save has no story cursor. The exact board can be restored, but old story history cannot be safely aligned.</p>' : '';
  overlay(`<h1>Create a playable branch here?</h1><p>The shared table will return to <b>${esc(frame.label || 'this exact save')}</b>. Later entries on the current branch will be removed after archive entry ${frame.archiveSeq === null ? 'unknown' : Number(frame.archiveSeq)}. The campaign itself is never deleted.</p>${legacy}<button class="big" id="playbackRestoreConfirm">Confirm Restore / Rewind</button> <button class="big ghost" id="playbackRestoreCancel">Cancel</button>`, 'playback-restore');
  $('playbackRestoreCancel').onclick = renderTimelinePlayback;
  $('playbackRestoreConfirm').onclick = () => restorePlaybackSnapshot(frame);
}

/** @description Perform the separately confirmed restore, then enter the new live branch. */
async function restorePlaybackSnapshot(frame) {
  if (!timelinePlaybackSession || !frame || !frame.restorable) return false;
  const campaignId = timelinePlaybackSession.campaignId;
  $('playbackRestoreConfirm').disabled = true;
  if (campaign && campaign.campaign_id === campaignId) return loadSnapshot(frame.snapshotId);
  const result = await api('/restore', { method: 'POST', body: JSON.stringify({ campaignId, snapshotId: frame.snapshotId, presenterId: presentationClientId }) }).catch(() => null);
  if (!result || !result.ok) { banner(result && result.error || 'The campaign could not be restored.'); renderTimelinePlayback(); return false; }
  stopTimelinePlayback(); timelinePlaybackSession = null;
  return enterCampaign(campaignId);
}

/** @description Save the currently loaded live board, then refresh read-only playback. */
async function savePlaybackMoment() {
  if (!campaign || !board || !timelinePlaybackSession) return;
  const label = `${SC() ? SC().title : 'Adventure'} - round ${Number(board.round) || 1}`;
  const options = timelinePlaybackSession.options, campaignId = campaign.campaign_id;
  const s = await createSnapshot(label, false);
  if (!s || !s.ok) { banner(s && s.error || 'Could not save this moment.'); return; }
  banner('Saved this exact board.'); await showCampaignPlayback(campaignId, options);
}
