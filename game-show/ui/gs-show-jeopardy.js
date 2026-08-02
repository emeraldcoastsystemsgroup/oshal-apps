/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:50:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Jeopardy's client half, extracted from gs-surfaces.js into the per-show registry (ADR-112 table collapse), extended for Double Jeopardy: the round-break banner between boards and 'round-break' as a start phase so the host desk can build board two.
 * 2026-07-26 19:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast set piece: the board is now the WALL (category monitor bank over gold-value cells, used cells dark), clue/answer phases take over the whole set as a zooming blue card with a RING IN! pulse while the buzzer is open and the responder's name once locked, the Daily Double gets a gold starburst splash + one-shot fanfare, and round-break/final render as splash cards. All one-shots keyed off module-level last-seen state so the ~1.4s re-render never replays them; pick gating and the registry contract are unchanged.
 */

/* global window */
(function () {
  'use strict';
  var GS = window.GS;
  if (!GS.registerShowUi) return;

  function actingSeat() { return GS.actAs || ((GS.mySeat() || {}).seatId || null); }

  function seatName(seatId) {
    var hit = (GS.seats || []).filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : (seatId || '');
  }

  function activeClueOf(board) {
    if (!board || !board.pick) return null;
    var category = (board.categories || [])[board.pick.cat];
    return category ? (category.clues || [])[board.pick.row] || null : null;
  }

  // One-shot entrance tracking. GS.mount rebuilds the DOM on every changed poll,
  // so a CSS entrance animation would replay on each buzz-serial tick unless the
  // "is this takeover new?" decision lives module-level, keyed by the picked cell.
  var lastClueKey = null, lastDailyKey = null, breakSeen = false, finalSeen = false;

  function pickKey(board) {
    var pick = (board && board.pick) || {};
    return pick.cat + ':' + pick.row;
  }

  // ── the WALL ──────────────────────────────────────────────────────────────
  function wallRow(grid, cats, row, canPick) {
    cats.forEach(function (category, ci) {
      var clue = (category.clues || [])[row];
      if (!clue) { grid.appendChild(GS.el('div', { class: 'gsj-cell used' })); return; }
      var cell = GS.el('div', { class: 'gsj-cell' + (clue.used ? ' used' : (canPick ? '' : ' locked')) },
        clue.used ? '' : ('$' + clue.value));
      if (!clue.used && canPick) cell.addEventListener('click', function () { GS.act({ type: 'pick', cat: ci, row: row }, GS.actAs); });
      grid.appendChild(cell);
    });
  }

  function wall() {
    var board = GS.state.board || {}, cats = board.categories || [];
    if (!cats.length) {
      return GS.el('div', { class: 'gsj-set' },
        GS.el('div', { class: 'gsj-idle' },
          GS.el('div', { class: 'gsj-idle-glow' }, 'THE BOARD'),
          GS.el('p', { class: 'gs-center gs-muted' }, 'Waiting for the board…')));
    }
    var canPick = GS.state.phase === 'board' && (!board.control || board.control === actingSeat());
    var grid = GS.el('div', { class: 'gsj-wall', style: 'grid-template-columns:repeat(' + cats.length + ',1fr)' });
    cats.forEach(function (c) { grid.appendChild(GS.el('div', { class: 'gsj-cat' }, c.title)); });
    for (var row = 0; row < 5; row++) wallRow(grid, cats, row, canPick);
    return GS.el('div', { class: 'gsj-set' }, grid);
  }

  // ── the clue takeover ─────────────────────────────────────────────────────
  function clueTakeover(st, board, clue) {
    var key = pickKey(board), fresh = key !== lastClueKey;
    lastClueKey = key;
    var buzz = st.buzz || {};
    var cat = (board.categories || [])[(board.pick || {}).cat] || {};
    var stake = clue.isDaily && board.wager && board.wager.amount ? board.wager.amount : clue.value;
    return GS.el('div', { class: 'gsj-set' },
      GS.el('div', { class: 'gsj-clue-card' + (fresh ? ' gsj-enter' : '') + (buzz.open ? ' ring' : '') },
        GS.el('div', { class: 'gsj-kicker' }, (cat.title || '') + (stake ? ' — $' + stake : '')),
        GS.el('div', { class: 'gsj-clue-text' }, clue.clue),
        buzz.open ? GS.el('div', { class: 'gsj-ring-tag' }, 'RING IN!') : null,
        buzz.lockedBy ? GS.el('div', { class: 'gsj-responder' }, seatName(buzz.lockedBy)) : null));
  }

  // ── splashes ──────────────────────────────────────────────────────────────
  function dailySplash(board) {
    var key = pickKey(board), fresh = key !== lastDailyKey;
    lastDailyKey = key;
    if (fresh && GS.sfx) GS.sfx('fanfare');
    var who = seatName((board.wager && board.wager.seatId) || board.control);
    return GS.el('div', { class: 'gsj-set' },
      GS.el('div', { class: 'gsj-daily' + (fresh ? ' gsj-enter' : '') },
        GS.el('div', { class: 'gsj-burst' }),
        GS.el('div', { class: 'gsj-daily-title' }, 'DAILY DOUBLE!')),
      GS.el('div', { class: 'gsj-wager-card' },
        GS.el('div', { class: 'gsj-kicker' }, who || 'Picker'),
        GS.el('div', { class: 'gsj-wager-line' }, 'Name your wager')));
  }

  function breakSplash() {
    var fresh = !breakSeen;
    breakSeen = true;
    return GS.el('div', { class: 'gsj-set' },
      GS.el('div', { class: 'gsj-splash' + (fresh ? ' gsj-enter' : '') },
        GS.el('div', { class: 'gsj-splash-title' }, 'DOUBLE JEOPARDY'),
        GS.el('p', { class: 'gs-center gs-muted' }, 'Board one is done — doubled values are coming up. Host: start the next round.')));
  }

  function finalCard(st, board) {
    var fresh = !finalSeen;
    finalSeen = true;
    if (st.phase === 'final-wager') {
      return GS.el('div', { class: 'gsj-set' },
        GS.el('div', { class: 'gsj-clue-card gsj-final' + (fresh ? ' gsj-enter' : '') },
          GS.el('div', { class: 'gsj-kicker' }, 'FINAL JEOPARDY'),
          GS.el('div', { class: 'gsj-clue-text' }, board.final.category),
          GS.el('div', { class: 'gsj-wager-line' }, 'Place your wagers…')));
    }
    return GS.el('div', { class: 'gsj-set' },
      GS.el('div', { class: 'gsj-clue-card gsj-final' },
        GS.el('div', { class: 'gsj-kicker' }, 'FINAL JEOPARDY — ' + board.final.category),
        GS.el('div', { class: 'gsj-clue-text' }, board.final.clue)));
  }

  function board() {
    var st = GS.state, b = st.board || {}, clue = activeClueOf(b);
    if (st.phase !== 'clue' && st.phase !== 'answer') lastClueKey = null;
    if (st.phase !== 'daily-wager') lastDailyKey = null;
    if (st.phase !== 'round-break') breakSeen = false;
    if (st.phase !== 'final-wager' && st.phase !== 'final-answer') finalSeen = false;
    if (['clue', 'answer'].indexOf(st.phase) >= 0 && clue) return clueTakeover(st, b, clue);
    if (st.phase === 'daily-wager') return dailySplash(b);
    if (st.phase === 'round-break') return breakSplash();
    if (['final-wager', 'final-answer'].indexOf(st.phase) >= 0 && b.final) return finalCard(st, b);
    return wall();
  }

  function hostKey() {
    var b = GS.state.board || {};
    var list = GS.el('div', { class: 'gs-hostlist' });
    var clue = activeClueOf(b);
    if (clue) list.appendChild(GS.el('div', { class: 'a up' }, GS.el('span', {}, clue.clue), GS.el('span', {}, clue.answer)));
    if (b.final) list.appendChild(GS.el('div', { class: 'a' }, GS.el('span', {}, 'FINAL: ' + b.final.clue), GS.el('span', {}, b.final.answer)));
    if (!clue && !b.final) return null;
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px' },
      GS.el('div', { class: 'gs-muted', style: 'margin-bottom:6px' }, 'Answer key (host eyes only)'), list);
  }

  GS.registerShowUi({
    id: 'jeopardy',
    board: board,
    answerPhases: ['answer', 'final-answer'],
    wagerPhases: ['daily-wager', 'final-wager'],
    startPhases: ['lobby', 'round-break', 'final-setup'],
    hostKey: hostKey,
    controls: null,
    hostExtras: null,
    // Only the seat holding the response may type: the ring-in winner (or the
    // Daily Double picker) on a clue; any unjudged wagerer in the final.
    canType: function (seatId) {
      var st = GS.state || {}, b = st.board || {};
      if (st.phase === 'answer') {
        var wager = b.wager;
        var responder = wager && wager.amount != null ? wager.seatId : (st.buzz && st.buzz.lockedBy);
        return !!responder && responder === seatId;
      }
      if (st.phase === 'final-answer') {
        return (b.wagers || {})[seatId] !== undefined && !(b.finalJudged || {})[seatId];
      }
      return true;
    },
  });
})();
