/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * ----------------------------------------------------------------------------- 
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Add a true immersive-table controller and a persistent right gameplay rail for the active character, ready actions, inventory, story, and Dungeon Master chat.
 * 2026-07-23 00:12:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Add direct quick questions that ask the contextual Dungeon Master for known facts, searchable leads, or three non-repeating ways forward.
 * 2026-07-23 00:31:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Present recurring NPC names, roles, and player-visible personality cues in the active-character rail.
 * 2026-09-28 23:05:00 | maintainer@emeraldcoastsystemsgroup.com     | Wire the full-screen, Dungeon Master panel, Escape and quick-question controls only when no audience view renders (ADR-164 D6): under the family view of table.html the table is hidden and never starts. The full table wires them exactly as before.
 * 2026-10-10 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | The rail portrait asks only for bundled art (tokenArtUrl); a token without it shows the plain portrait frame.
 * 2026-11-06 08:15:00 | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (dnd-table): the HUD's More menu (Timeline, Help, DM Settings, Full screen) opens from ⋯ More and closes on an item, an outside press or Escape; DM & Story keeps its name and reports aria-pressed, so the drawer's ✕ is its one close control; Full screen is plain words (phone fonts have no ⛶).
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
  const portrait = tokenArtUrl(token.kind === 'pc' ? token.slug : token.ref);
  root.innerHTML = `<button type="button" class="rail-character-head" id="railSheetBtn">
      <span class="rail-portrait"${artStyle(portrait)}></span>
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
  // One close control: the drawer's own ✕. The HUD button keeps its name and shows that the drawer is open.
  const button = $('storyBtn');
  if (button) button.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (open && focus) setTimeout(() => $('talkInput') && $('talkInput').focus(), 0);
}

/** @description Apply the table layout even when browser full-screen permission is delayed. */
function setImmersiveMode(active) {
  immersiveRequested = !!active;
  document.body.classList.toggle('table-fullscreen', immersiveRequested);
  if (immersiveRequested) setStoryOpen(true);
  const button = $('fullscreenBtn');
  if (button) {
    button.textContent = immersiveRequested ? 'Exit full screen' : 'Full screen';
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

/** @description Open or close the HUD's More menu (Timeline, Help, DM Settings, Full screen). */
function setMoreMenu(open) {
  const menu = $('moreMenu'), button = $('moreBtn');
  if (!menu || !button) return;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { const first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true }); }
}

/** @description The More menu closes on its own items, an outside press and Escape; it never stays over the board. */
function wireMoreMenu() {
  const menu = $('moreMenu');
  if (!menu || !$('moreBtn')) return;
  $('moreBtn').onclick = (event) => { event.stopPropagation(); setMoreMenu(menu.classList.contains('hidden')); };
  menu.addEventListener('click', (event) => { if (event.target.closest('button')) setMoreMenu(false); });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.classList.contains('hidden') && !menu.contains(event.target) && event.target !== $('moreBtn')) setMoreMenu(false);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.classList.contains('hidden')) { setMoreMenu(false); $('moreBtn').focus(); } });
}

/** @description Install discoverable gameplay rail, chat, full-screen, and Escape controls. */
function wireImmersiveTable() {
  wireMoreMenu();
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

// Audience view (ADR-164 D6): the family view of table.html hides the table, so its controls are never wired.
if (!window.AppView || !AppView.active()) wireImmersiveTable();
