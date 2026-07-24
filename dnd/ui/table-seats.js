/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com  | Give hosts a confirmed Party/Lobby control that releases an abandoned guest and immediately resumes an active hero as an AI Companion.
 */

'use strict';

/** @description Return the short safe display name used throughout the table. */
function seatPlayerName(seat) {
  return String(seat && seat.name || 'Waiting player').split(/[\s@]/)[0];
}

/** @description Resolve the claimed hero name without trusting client seat text. */
function seatHeroName(seat) {
  if (!seat || !seat.slug) return '';
  const sheet = boardSheets[seat.slug] || (content.heroes || []).find((hero) => hero.id === seat.slug);
  return String(sheet && sheet.name || seat.slug).split(/[\s,]/)[0];
}

/** @description Render a takeover only for the host and never for the host's own seat. */
function hostSeatReleaseButton(seat) {
  if (!campaign || !campaign.is_owner || !seat || seat.me || !seat.seatKey) return '';
  const label = seat.slug ? 'Make AI Companion' : 'Remove waiting player';
  const detail = seat.slug ? `${seatPlayerName(seat)} no longer controls ${seatHeroName(seat)}` : `Remove ${seatPlayerName(seat)} from this lobby`;
  return `<div class="campaign-actions host-seat-actions"><button class="leave" data-release-seat="${esc(seat.seatKey)}" title="${esc(detail)}">${label}</button></div>`;
}

/** @description Show unclaimed participants and host recovery beside each waiting seat. */
function waitingSeatRoster() {
  const waiting = players.filter((seat) => !seat.slug);
  if (!waiting.length) return '';
  const rows = waiting.map((seat) => `<div><span>${esc(seatPlayerName(seat))}</span>${hostSeatReleaseButton(seat)}</div>`).join('');
  return `<div class="waiting-seats"><b>Still choosing</b>${rows}</div>`;
}

/** @description Return to the Party or Lobby after cancelling a takeover. */
function returnToSeatScreen(screen) {
  if (screen === 'lobby') showLobby();
  else showHeroes(true);
}

/** @description Adopt a successful release before any new turn writes occur. */
function adoptReleasedSeat(result) {
  players = result.players || players;
  if (Number.isFinite(Number(result.rev))) rev = Number(result.rev);
  rememberConfirmedBoard(board, rev);
  updateInitiativeBar(); renderDock(); setTurnFlag();
}

/** @description Release one confirmed guest and wake their active hero if necessary. */
async function performHostSeatRelease(seat, screen) {
  const result = await api('/campaign/release-seat', {
    method: 'POST', body: JSON.stringify({ campaignId: campaign.campaign_id, seatKey: seat.seatKey }),
  }).catch(() => null);
  if (!result || !result.ok) {
    banner(result && result.error || 'Could not release that player seat.'); returnToSeatScreen(screen); return;
  }
  const released = result.released || {}, wasActive = board && board.mode === 'combat'
    && activeToken() && activeToken().slug === released.slug;
  adoptReleasedSeat(result);
  banner(released.slug ? `${seatHeroName(released)} is now an AI Companion.` : 'The waiting player was removed.');
  if (wasActive) { closeOverlay(); beginTurn(); }
  else returnToSeatScreen(screen);
}

/** @description Require an explicit host confirmation before removing a participant. */
function confirmHostSeatRelease(seatKey, screen) {
  const seat = players.find((candidate) => candidate.seatKey === seatKey);
  if (!campaign || !campaign.is_owner || !seat || seat.me) return;
  const player = seatPlayerName(seat), hero = seatHeroName(seat);
  const title = seat.slug ? `Make ${hero} an AI Companion?` : `Remove ${player} from the lobby?`;
  const effect = seat.slug
    ? `${player}'s seat will be released. ${hero} stays alive on the board and the host AI takes over immediately if it is that hero's turn.`
    : `${player}'s unclaimed seat will be removed so the host can start. They can join again while this lobby remains open.`;
  overlay(`<h1>${esc(title)}</h1><p>${esc(effect)}</p><button class="big" id="releaseSeatConfirm">${seat.slug ? 'Make AI Companion' : 'Remove waiting player'}</button> <button class="big ghost" id="releaseSeatCancel">Cancel</button>`, 'release-seat');
  $('releaseSeatCancel').onclick = () => returnToSeatScreen(screen);
  $('releaseSeatConfirm').onclick = () => { $('releaseSeatConfirm').disabled = true; void performHostSeatRelease(seat, screen); };
}

/** @description Bind only the host controls present in the current Party/Lobby card. */
function bindHostSeatReleaseControls(screen) {
  document.querySelectorAll('[data-release-seat]').forEach((button) => {
    button.onclick = () => confirmHostSeatRelease(button.dataset.releaseSeat, screen);
  });
}
