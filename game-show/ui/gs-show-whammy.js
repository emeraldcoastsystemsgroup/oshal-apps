/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 03:22:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Whammy! client renderer: the 12-panel light-chase board (one module-level ticker repaints highlight by id, mirroring gs-controls' tickPaint, so re-renders never stack intervals), the dramatic last-stop card (WHAMMY in red), per-player bank/spins/whammy rows, and the PRESS YOUR LUCK / pass controls. Registered via GS.registerShowUi; no answer or wager phases — the board is pure luck.
 * 2026-07-26 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast set rebuild (styling moved to gs-set-whammy.css, gsy- prefix): panels now form the show's RING — perimeter cells of a 4x4 grid around a 2x2 center screen — and the single ticker chases that ring order with random jumps, holds on the landed panel, and animates the WHAMMY bank-drain counter. Center screen plays the beats (PRESS YOUR LUCK attract, stop reveal, 😈 scoot + drain to $0, winner card); one-shot animations key off a module-level last-stop signature so the ~1.4s rebuild can't replay them. Dock controls became the big red PRESS button; gating logic unchanged.
 * 2026-07-31 22:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #3 + #5: (3) a board under 12 panels no longer breaks the ring — Math.round spreads n panels collision-free but not gap-free (n=10 leaves ring slots 3 and 9 empty), so the unused perimeter slots now render as dimmed filler cells and the ring always closes; (5) the centre screen shows the CURRENT beat — a stop/whammy readout is a timed beat (hold + a readable moment), after which the ticker hands the screen back to the attract marquee, a page opened mid-game starts on attract instead of replaying the last readout, and no readout survives outside the lights phase. Guarded by tests/whammy-set.test.js.
 */

/* global window, document, setInterval, Date */
(function () {
  'use strict';
  var GS = window.GS;
  if (!GS || typeof GS.registerShowUi !== 'function') return;   // registry loads first by contract

  var CHASE_MS = 160;
  var HOLD_MS = 2200;    // the landed panel stays lit this long before the chase resumes
  var DOOM_MS = 1500;    // every cell flashes red while the whammy takes the bank
  var DRAIN_MS = 1300;   // the bank counter's ride down to $0
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  /** @description Panels on the current board (defensive — the board may not exist yet). */
  function panels() { return (GS.state && GS.state.board && GS.state.board.panels) || []; }

  /** @description Whether the seat may act on the board right now: it holds control, or nobody does (the first press claims it). */
  function myTurn(seatId) {
    var control = GS.state && GS.state.board && GS.state.board.control;
    return !!seatId && (!control || control === seatId);
  }

  /** @description Spins a seat has left, mirroring the server's lazy grant: an absent ledger key reads as the full allotment. */
  function spinsOf(seatId) {
    var board = (GS.state && GS.state.board) || {};
    var left = (board.spinsLeft || {})[seatId];
    return left === undefined ? (Number(board.spinsPerPlayer) || 5) : (Number(left) || 0);
  }

  /** @description Display name for a seat id, falling back to the id itself. */
  function seatName(seatId) {
    var hit = (GS.seats || []).filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : (seatId || '');
  }

  /** @description A seat's current bank. */
  function bankOf(seatId) { return Number(((GS.state || {}).scores || {})[seatId]) || 0; }

  // ── ring geometry ────────────────────────────────────────────────────────
  // The 12 perimeter cells of the 4x4 grid, clockwise from the top-left; the
  // css maps .gsy-p0…p11 onto those grid areas. Boards with 8-11 panels spread
  // evenly around the ring — Math.round(i*12/n) is collision-free for n >= 8,
  // but NOT gap-free (n=10 leaves slots 3 and 9 empty), so ringBoard fills the
  // unused perimeter slots with dimmed filler cells to close the ring (#3).
  /** @description Ring position (0-11, clockwise) for panel i of n. */
  function ringPos(i, n) { return Math.round(i * 12 / n) % 12; }

  // ── one-shot state tracking ──────────────────────────────────────────────
  // The DOM is wiped on every changed poll, so every animation derives from a
  // delta against these module-level "last seen" values, never from the render
  // itself: a stop signature (lastStop has no serial, but spins/scores/whammies
  // all move with each press) triggers the hold / doom / drain exactly once.
  var lastStopKey = null;
  var lastScores = {};
  var holdIdx = null, holdUntil = 0;   // landed panel stays lit
  var doomUntil = 0;                   // all-cells red flash on a whammy
  var drain = null;                    // {from,start} — the bank counter's fall
  var freshStop = false;               // true only on the render that first sees a stop
  var readoutUntil = 0;                // the stop readout owns the centre screen until this ms (#5)
  var READOUT_TAIL_MS = 1100;          // a readable moment after the animation before attract returns

  /** @description Signature of the latest press outcome — changes on every press even when the same panel repeats. */
  function stopKey(board) {
    return JSON.stringify([board.lastStop, board.spinsLeft, board.whammies, (GS.state || {}).scores]);
  }

  /** @description Compare the board against the last-seen signature and arm the one-shot beats (hold, doom flash, bank drain, centre readout window). Runs once per render, before any node is built. A page opened mid-game (first sight) arms NOTHING — the centre starts on attract instead of replaying a readout the room already watched (#5). */
  function detectStop() {
    var board = (GS.state && GS.state.board) || {};
    var stop = board.lastStop;
    freshStop = false;
    if (!stop) { lastStopKey = null; readoutUntil = 0; return; }
    var key = stopKey(board);
    if (key === lastStopKey) return;
    var firstSight = lastStopKey === null;   // page load mid-game: attract, don't replay
    lastStopKey = key;
    if (firstSight) return;
    freshStop = true;
    var now = Date.now();
    if (stop.kind === 'whammy') {
      holdIdx = null;
      doomUntil = now + DOOM_MS;
      drain = { from: Number(lastScores[stop.seatId]) || 0, start: now };
      readoutUntil = now + DOOM_MS + DRAIN_MS + READOUT_TAIL_MS;
    } else {
      holdIdx = typeof stop.panelIndex === 'number' ? stop.panelIndex : null;
      holdUntil = now + HOLD_MS;
      if (holdIdx !== null) chaseIdx = holdIdx;   // chase resumes from the landing spot
      readoutUntil = now + HOLD_MS + READOUT_TAIL_MS;
    }
  }

  /** @description Snapshot every bank AFTER detection so the next whammy knows what it torched. */
  function snapScores() {
    var scores = (GS.state || {}).scores || {};
    lastScores = {};
    Object.keys(scores).forEach(function (k) { lastScores[k] = scores[k]; });
    GS.players().forEach(function (s) { if (!(s.seatId in lastScores)) lastScores[s.seatId] = s.score || 0; });
  }

  // ── light chase ──────────────────────────────────────────────────────────
  // ONE module-level ticker for the whole page lifetime, mirroring gs-controls'
  // tickPaint: it repaints existing cells BY ID (class toggles only) and never
  // touches the DOM tree, so re-renders can rebuild the board freely without
  // stacking intervals. It also drives the drain counter — one clock, no leaks.
  var chaseIdx = 0;

  /** @description Advance the ring chase (with the show's random jumps), honor the landed-panel hold and whammy doom flash, step the drain counter, and hand a lapsed stop readout back to the attract marquee (#5); a no-op unless the cells are mounted. */
  function chaseTick() {
    var now = Date.now();
    paintDrain(now);
    // The centre readout is a BEAT, not a state: once its window lapses (and the
    // drain has finished falling) the ticker flips the screen back to attract by
    // class toggle — both layers are already in the DOM, nothing is created here.
    var screen = document.getElementById('gsy-screen');
    if (screen && !drain && now >= readoutUntil && screen.classList.contains('gsy-live')) {
      screen.classList.remove('gsy-live');
      screen.classList.add('gsy-past');
    }
    var n = panels().length;
    if (!n || !GS.state || GS.state.phase !== 'lights') return;
    var doom = now < doomUntil;
    var lit;
    if (holdIdx !== null && now < holdUntil) lit = holdIdx;
    else if (doom) lit = -1;
    else {
      // ~1 jump in 7 beats — the board skips around like the show; a static
      // board (reduced motion) keeps the last lit cell instead of roaming.
      if (!(REDUCED && REDUCED.matches)) {
        chaseIdx = Math.random() < 0.14 ? Math.floor(Math.random() * n) : (chaseIdx + 1) % n;
      }
      lit = chaseIdx;
    }
    for (var i = 0; i < n; i++) {
      var cell = document.getElementById('gsy-cell-' + i);
      if (!cell) continue;
      cell.classList.toggle('gsy-lit', i === lit);
      cell.classList.toggle('gsy-doom', doom);
    }
  }

  /** @description Repaint the whammy bank-drain counter by id until it hits $0. */
  function paintDrain(now) {
    if (!drain) return;
    var el = document.getElementById('gsy-drain');
    var t = now - drain.start;
    if (t >= DRAIN_MS) { if (el) el.textContent = '$0'; drain = null; return; }
    if (el) el.textContent = '$' + Math.max(0, Math.round(drain.from * (1 - t / DRAIN_MS)));
  }
  setInterval(chaseTick, CHASE_MS);

  // ── board pieces ─────────────────────────────────────────────────────────

  /** @description One arcade panel cell on the ring, id-addressable so the chase can repaint it without a re-render. */
  function panelCell(panel, i, n) {
    return GS.el('div', { id: 'gsy-cell-' + i, class: 'gsy-cell gsy-p' + ringPos(i, n) + (i === chaseIdx ? ' gsy-lit' : '') },
      GS.el('div', { class: 'lbl' }, panel.label),
      GS.el('div', { class: 'val' }, '$' + panel.value + (panel.kind === 'cash-spin' ? ' +🌀' : '')));
  }

  /** @description What the room is waiting on: the control seat and their spins, or the open-board call. */
  function statusLine() {
    var board = (GS.state || {}).board || {};
    if ((GS.state || {}).phase !== 'lights') return null;
    var text = board.control
      ? seatName(board.control) + ' — ' + spinsOf(board.control) + '🌀 left'
      : 'Anyone may press to claim the board!';
    return GS.el('div', { class: 'gsy-status' }, text);
  }

  /** @description The attract layer: the PRESS YOUR LUCK marquee over the room's status line. */
  function attractLayer() {
    return GS.el('div', { class: 'gsy-beat gsy-beat-attract' },
      GS.el('div', { class: 'gsy-marquee' }, 'PRESS YOUR LUCK!'),
      statusLine());
  }

  /**
   * @description The center screen's CURRENT beat: winner card, the 😈 whammy
   *   scoot + bank drain, the last stop big, or the PRESS YOUR LUCK attract
   *   marquee. A stop readout is a timed beat, not a state (#5): it renders live
   *   only inside its readout window (both layers are in the DOM; the ticker
   *   flips gsy-live → gsy-past when the window lapses, so the ~1.4s rebuild
   *   cadence can't strand a stale readout between beats), never renders outside
   *   the lights phase, and a page opened mid-game starts on attract. One-shot
   *   entrance classes only ride the render that FIRST saw the stop.
   */
  function centerScreen() {
    var st = GS.state || {}, board = st.board || {}, stop = board.lastStop;
    if ((st.phase === 'round-win' || st.phase === 'outro') && board.winner) {
      return GS.el('div', { class: 'gsy-screen' },
        GS.el('div', { class: 'gsy-imp' }, '🏆'),
        GS.el('div', { class: 'gsy-stop-label' }, seatName(board.winner) + ' takes it!'),
        GS.el('div', { class: 'gsy-stop-val' }, '$' + bankOf(board.winner)));
    }
    if (!stop || st.phase !== 'lights') return GS.el('div', { class: 'gsy-screen' }, attractLayer());
    var live = !!drain || Date.now() < readoutUntil;
    var beat = live ? ' gsy-live' : ' gsy-past';
    if (stop.kind === 'whammy') {
      var draining = !!drain;
      return GS.el('div', { id: 'gsy-screen', class: 'gsy-screen gsy-scr-whammy' + (freshStop ? ' fresh' : '') + beat },
        GS.el('div', { class: 'gsy-beat gsy-beat-stop' },
          GS.el('div', { class: 'gsy-imp' }, '😈'),
          GS.el('div', { class: 'gsy-whammy-word' }, 'WHAMMY!'),
          GS.el('div', { id: 'gsy-drain', class: 'gsy-drain' }, draining ? '$' + (drain.from || 0) : '$0'),
          GS.el('div', { class: 'gsy-status' }, seatName(stop.seatId) + ' loses the bank!'),
          statusLine()),
        attractLayer());
    }
    return GS.el('div', { id: 'gsy-screen', class: 'gsy-screen gsy-scr-stop' + (freshStop ? ' fresh' : '') + beat },
      GS.el('div', { class: 'gsy-beat gsy-beat-stop' },
        GS.el('div', { class: 'gsy-stop-label' }, stop.label),
        GS.el('div', { class: 'gsy-stop-val' }, '$' + stop.value + ' → ' + seatName(stop.seatId)),
        statusLine()),
      attractLayer());
  }

  /** @description One dimmed filler cell for a ring slot no panel occupies — the ring must always CLOSE (#3). */
  function fillerCell(pos) {
    return GS.el('div', { class: 'gsy-cell blank gsy-p' + pos },
      GS.el('div', { class: 'lbl' }, '· · ·'), GS.el('div', { class: 'val' }, '$—'));
  }

  /** @description The ring board: 12 perimeter arcade cells around the 2x2 center screen. A board under 12 panels closes its ring with dimmed filler cells in the unused slots (#3); before the panels exist it renders as the all-filler attract ring. */
  function ringBoard() {
    var list = panels(), n = list.length;
    var grid = GS.el('div', { class: 'gsy-board' });
    var used = {};
    if (n) {
      list.forEach(function (panel, i) { used[ringPos(i, n)] = true; grid.appendChild(panelCell(panel, i, n)); });
    }
    for (var i = 0; i < 12; i++) {
      if (!used[i]) grid.appendChild(fillerCell(i));
    }
    grid.appendChild(centerScreen());
    return grid;
  }

  /** @description Per-player ledger pods on the set apron: bank, 🌀 spins, 💀 whammies — risk is half the scoreboard in this show. Four whammies reads as knocked out. */
  function ledgerPods() {
    var board = (GS.state || {}).board || {};
    var row = GS.el('div', { class: 'gsy-pods' });
    GS.players().forEach(function (s) {
      var whams = Number((board.whammies || {})[s.seatId]) || 0;
      var cls = 'gsy-pod' + (board.control === s.seatId ? ' control' : '') + (whams >= 4 ? ' out' : '');
      row.appendChild(GS.el('div', { class: cls },
        GS.el('div', { class: 'name' }, s.name),
        GS.el('div', { class: 'bank' }, '$' + bankOf(s.seatId)),
        GS.el('div', { class: 'tally' }, '🌀 ' + spinsOf(s.seatId) + ' · 💀 ' + whams)));
    });
    return row;
  }

  /** @description The full Whammy! set piece for stage/tv surfaces: the ring board with its center screen, over the player ledger pods. */
  function board() {
    detectStop();
    var wrap = GS.el('div', { class: 'gsy-set' }, ringBoard());
    if (!panels().length) wrap.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, 'Waiting for the prize board…'));
    wrap.appendChild(ledgerPods());
    snapScores();
    return wrap;
  }

  /** @description The press/pass controls: shown to the seat holding the turn (or anyone while the board is unclaimed — the first press claims it). Null otherwise, so idle seats see nothing they cannot use. */
  function controls(actorSeatId) {
    if (!GS.state || GS.state.phase !== 'lights' || !myTurn(actorSeatId) || spinsOf(actorSeatId) <= 0) return null;
    var hasControl = !!(GS.state.board && GS.state.board.control);
    return GS.el('div', { class: 'gsy-dock gs-col gs-center' },
      GS.el('button', {
        class: 'gs-buzz-btn gsy-press',
        onclick: function () { GS.act({ type: 'pressYourLuck' }, actorSeatId); },
      }, 'PRESS'),
      GS.el('div', { class: 'gsy-spins' }, '🌀 ' + spinsOf(actorSeatId) + ' spins left'),
      hasControl ? GS.el('button', {
        class: 'gs-btn ghost gsy-pass',
        onclick: function () { GS.act({ type: 'passSpins' }, actorSeatId); },
      }, 'Pass my spins') : null);
  }

  GS.registerShowUi({
    id: 'whammy',
    board: board,
    answerPhases: [],          // nothing is ever typed — the board is pure luck
    wagerPhases: [],           // and nothing is ever wagered
    startPhases: ['lobby'],    // the prize board generates once, before the lights
    hostKey: function () { return null; },   // no hidden answers for host eyes
    controls: controls,
    hostExtras: null,
  });
})();
