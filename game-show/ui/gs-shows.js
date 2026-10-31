/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The client-side show registry — the ADR-112 "collapse the four lookup tables" moment, triggered exactly as predicted by shows #3/#4. A show's client half is ONE gs-show-<id>.js file calling GS.registerShowUi with its renderer + phase tables; gs-surfaces.js consumes this registry and knows no show's rules. Mirrors lib/shows/show-registry.js on the server side.
 * 2026-10-30 22:30:00 | maintainer@emeraldcoastsystemsgroup.com    | Each show now says what to do right now (prompt), and may gate the wager box (canWager) and name its answer box (answerPlaceholder).
 */

/* global window */
(function () {
  'use strict';
  var GS = window.GS;

  /**
   * A registered client show definition:
   *   id           - matches the server show id (gameshow_rooms.show_id)
   *   board()      - render the board area for the current GS.state
   *   answerPhases - phases where the generic type-an-answer box shows
   *   wagerPhases  - phases where the generic wager box shows
   *   startPhases  - phases where the host's Start/Next-round button is live
   *   hostKey()    - host-eyes-only answer key node, or null
   *   controls(actorSeatId) - show-specific action buttons for a podium, or null
   *   hostExtras() - extra host-desk rows (e.g. Feud's Fast Money setup), or null
   *   prompt(seatId) - what to do right now: { you: text } when it is this seat's move,
   *                    { wait: text } when it is not; seatId is null for a host only running the show
   *   canWager(seatId) - whether this seat owes a wager in a wager phase
   *   answerPlaceholder - what the answer box asks for
   *   stageExtras() - extra buttons for the owner once the game is decided, or null
   *   nextLabel(phase) - what the owner's next-step button says here, or null for Next round
   */
  GS.showUi = {};

  /** @description Register one show's client half; called by each gs-show-<id>.js. */
  GS.registerShowUi = function (def) {
    if (!def || !def.id) return;
    GS.showUi[def.id] = {
      id: def.id,
      board: def.board || function () { return GS.el('div', { class: 'gs-muted gs-center' }, 'No board renderer.'); },
      answerPhases: def.answerPhases || [],
      wagerPhases: def.wagerPhases || [],
      startPhases: def.startPhases || ['lobby'],
      hostKey: def.hostKey || function () { return null; },
      controls: def.controls || function () { return null; },
      hostExtras: def.hostExtras || null,
      // Whether THIS seat may usefully type into the generic answer box right
      // now (turn-based shows gate it; a free-for-all show leaves the default).
      canType: def.canType || function () { return true; },
      prompt: def.prompt || function () { return null; },
      canWager: def.canWager || function () { return true; },
      answerPlaceholder: def.answerPlaceholder || null,
      stageExtras: def.stageExtras || null,
      nextLabel: def.nextLabel || function () { return null; },
    };
  };

  /** @description The active show's client def (falls back to a bare default). */
  GS.activeShowUi = function () {
    var id = (GS.state && GS.state.showId) || (GS.show && GS.show.id) || 'family-feud';
    return GS.showUi[id] || GS.showUi['family-feud'] || GS.registerShowUi({ id: id }) || GS.showUi[id];
  };
})();
