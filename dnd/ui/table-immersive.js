/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * ----------------------------------------------------------------------------- 
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Add a true immersive-table controller and a persistent right gameplay rail for the active character, ready actions, inventory, story, and Dungeon Master chat.
 * 2026-07-23 00:12:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Add direct quick questions that ask the contextual Dungeon Master for known facts, searchable leads, or three non-repeating ways forward.
 * 2026-07-23 00:31:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Present recurring NPC names, roles, and player-visible personality cues in the active-character rail.
 */

'use strict';

let immersiveRequested = false;

/** @description Render compact inventory rows for the always-available gameplay rail. */
function railInventoryRows(inventory) {
  if (!inventory.items.length) return '<span class="rail-empty">Pack is empty</span>';
  return inventory.items.slice(0, 8).map((item) =>
    `<span class="rail-item"><b>${esc(item.name)}</b>${item.quantity > 1 ? ` ×${Number(item.quantity)}` : ''}</span>`
  ).join('');
}

/** @description Render resource-honest ready actions for the active character. */
function railReadyActions(token, sheet) {
  const ready = (sheet.actions || []).filter((action) => actionResourceStatus(token, action).available);
  if (!ready.length) return '<span class="rail-empty">No actions ready</span>';
  return ready.slice(0, 6).map((action) => `<span class="rail-action">${esc(action.name)}</span>`).join('');
}

/** @description Keep the right rail aligned with the exact active character and resources. */
function renderGameplayRail() {
  const root = $('railCharacter'), token = board && activeToken();
  if (!root) return;
  root.classList.toggle('hidden', !token || token.kind === 'prop');
  if (!token || token.kind === 'prop') { root.innerHTML = ''; return; }
  const sheet = token.kind === 'pc' ? (boardSheets[token.slug] || sheetOf(token) || {}) : {};
  const inventory = inventoryOf(sheet), role = tokenRoleLabel(token);
  const controller = token.kind === 'pc' ? controllerLabel(token) : `${role || 'NPC'} · Dungeon Master`;
  const personality = token.kind === 'monster' ? tokenPersonality(token) : '';
  const portrait = token.kind === 'pc' ? `${API}/art/token/${encodeURIComponent(token.slug)}` : `${API}/art/token/${encodeURIComponent(token.ref)}`;
  root.innerHTML = `<button type="button" class="rail-character-head" id="railSheetBtn">
      <span class="rail-portrait" style="background-image:url('${portrait}')"></span>
      <span><small>ACTIVE · ${esc(controller)}</small><b>${esc(tokenDisplayName(token))}</b><em>❤ ${token.hp}/${token.maxHp} · 🛡 ${token.ac} · 👟 ${movementLeft(token)}ft</em></span>
      <i>${token.kind === 'pc' ? 'View full sheet' : esc(role)}</i>
    </button>
    ${personality ? `<div class="rail-character-note">${esc(personality)}</div>` : ''}
    <div class="rail-label">Available now</div><div class="rail-pills">${railReadyActions(token, sheet)}</div>
    <div class="rail-label">Carried items</div><div class="rail-pills">${railInventoryRows(inventory)}</div>`;
  $('railSheetBtn').disabled = token.kind !== 'pc';
  if (token.kind === 'pc') $('railSheetBtn').onclick = () => showCharacterSheet(token);
}

/** @description Keep the DM button truthful and focus chat when the rail opens. */
function syncDmPanelButton(open, focus) {
  const button = $('storyBtn');
  if (button) button.textContent = open ? '✕ Close DM' : '💬 DM & Story';
  if (open && focus) setTimeout(() => $('talkInput') && $('talkInput').focus(), 0);
}

/** @description Apply the table layout even when browser full-screen permission is delayed. */
function setImmersiveMode(active) {
  immersiveRequested = !!active;
  document.body.classList.toggle('table-fullscreen', immersiveRequested);
  if (immersiveRequested) setStoryOpen(true);
  const button = $('fullscreenBtn');
  if (button) {
    button.textContent = immersiveRequested ? '⛶ EXIT FULL SCREEN' : '⛶ PLAY FULL SCREEN';
    button.title = immersiveRequested ? 'Return to the cockpit (or press Escape)' : 'Hide the cockpit and fill the display with the game';
  }
  if (content && board) requestAnimationFrame(() => layout());
}

/** @description Enter browser full screen from the player's direct button gesture. */
async function enterImmersiveTable() {
  setImmersiveMode(true);
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (_error) {
    banner('Table focus is active. Browser full screen was blocked; press F11 for the remaining browser chrome.');
  }
}

/** @description Exit both browser and in-table immersive modes. */
async function exitImmersiveTable() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); }
  catch (_error) { /* CSS focus mode still exits below. */ }
  setImmersiveMode(false);
}

/** @description Toggle the immersive table without leaving the current campaign. */
function toggleImmersiveTable() {
  return immersiveRequested || document.fullscreenElement ? exitImmersiveTable() : enterImmersiveTable();
}

/** @description Ask one explicit quick-help question through the same live table conversation. */
function askDmPrompt(button) {
  const input = $('talkInput');
  input.value = button.dataset.dmPrompt || button.textContent;
  sendTalk();
}

/** @description Install discoverable gameplay rail, chat, full-screen, and Escape controls. */
function wireImmersiveTable() {
  $('fullscreenBtn').onclick = () => void toggleImmersiveTable();
  $('storyBtn').onclick = () => {
    const open = !$('story').classList.contains('open');
    setStoryOpen(open); syncDmPanelButton(open, open);
  };
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    setImmersiveMode(active);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && immersiveRequested && !document.fullscreenElement) setImmersiveMode(false);
  });
  document.querySelectorAll('[data-dm-prompt]').forEach((button) => {
    button.onclick = () => askDmPrompt(button);
  });
}

wireImmersiveTable();
