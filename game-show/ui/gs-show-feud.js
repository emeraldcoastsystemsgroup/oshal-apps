/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Family Feud's client half, extracted from gs-surfaces.js into the per-show registry (the ADR-112 table collapse) and extended with the Fast Money surfaces: the setup picker on the host desk, the timed two-run board, and the classic two-column reveal.
 * 2026-07-26 19:25:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The board became a SET PIECE (broadcast rebuild): gold-framed two-column flip-card board ordered column-first like the show, question marquee + BANK plate, one-shot 3D reveals and the giant strike-slam overlay driven by module-level last-seen deltas (never replayed on plain re-renders), steal-phase frame pulse, and the Fast Money masthead board with covered runs, DUPLICATE stamps, and an id-repaint odometer total. Phase tables, hostKey, and the Fast Money launcher are untouched.
 */

/* global window, document, setTimeout, setInterval */
(function () {
  'use strict';
  var GS = window.GS;
  if (!GS.registerShowUi) return;

  function isFm(phase) { return typeof phase === 'string' && phase.indexOf('fm-') === 0; }

  function seatName(seatId) {
    var hit = GS.seats.filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : 'Player';
  }

  function strikes() {
    // Three slots ALWAYS on the set once a round is live — a spectator must be
    // able to read how close the team is to losing the board, even at zero.
    var n = (GS.state.board && GS.state.board.strikes) || 0;
    var row = GS.el('div', { class: 'gs-strikes' });
    if (['faceoff', 'play', 'steal'].indexOf(GS.state.phase) < 0 && !n) return row;
    for (var i = 0; i < 3; i++) row.appendChild(GS.el('div', { class: 'gs-x' + (i < n ? '' : ' gsf-xempty') }, '✗'));
    return row;
  }

  // ── one-shot beats from state deltas ──────────────────────────────────────
  // The DOM is wiped on every changed poll, so flips and the strike slam must
  // key off module-level last-seen values — a plain re-render replays nothing.
  var seenQ = null, seenRevealed = null, seenStrikes = null;

  /** @description Diff the feud board against last render: returns {index:true} for freshly revealed cards and fires the strike slam when the count rises. */
  function feudDelta(b) {
    var answers = b.answers || [];
    var flips = {};
    var q = String(b.question || '');
    var rev = answers.map(function (a) { return a.revealed ? '1' : '0'; }).join('');
    if (seenQ === q && seenRevealed !== null) {
      answers.forEach(function (a, i) { if (a.revealed && seenRevealed.charAt(i) !== '1') flips[i] = true; });
    }
    seenQ = q; seenRevealed = rev;
    var n = Number(b.strikes) || 0;
    if (seenStrikes !== null && n > seenStrikes) slam(n);
    seenStrikes = n;
    return flips;
  }

  /** @description The strike slam: giant red X's (one per current strike, like the show) center-screen for ~900ms; lives on document.body so re-renders can't cut it short. */
  function slam(n) {
    if (document.querySelector('.gsf-slam')) return;
    var ov = GS.el('div', { class: 'gsf-slam' });
    for (var i = 0; i < n; i++) ov.appendChild(GS.el('div', { class: 'gsf-slam-x' }, '✗'));
    document.body.appendChild(ov);
    if (GS.sfx) GS.sfx('strike');
    setTimeout(function () { ov.remove(); }, 900);
  }

  // ── the survey board ──────────────────────────────────────────────────────

  /** @description One answer card: number-oval face while hidden, flipping to the white uppercase answer + gold points chip. The answer face only exists once revealed. */
  function card(a, i, flip) {
    var front = GS.el('div', { class: 'gsf-face gsf-front' }, GS.el('span', { class: 'gsf-num' }, String(i + 1)));
    var back = a.revealed ? GS.el('div', { class: 'gsf-face gsf-back' },
      GS.el('span', { class: 'gsf-txt' }, a.text),
      GS.el('span', { class: 'gsf-pts' }, String(a.points))) : null;
    return GS.el('div', { class: 'gsf-card' + (a.revealed ? ' revealed' : '') + (flip ? ' flip' : '') + (a.by ? ' by' + a.by : '') },
      GS.el('div', { class: 'gsf-in' }, front, back));
  }

  /** @description The card grid, column-first like the show: 1-4 down the left, 5-8 down the right. */
  function cardGrid(answers, flips) {
    var rows = Math.min(5, Math.max(1, Math.ceil(answers.length / 2)));
    var grid = GS.el('div', { class: 'gsf-cards gsf-rows-' + rows });
    answers.forEach(function (a, i) { grid.appendChild(card(a, i, !!flips[i])); });
    return grid;
  }

  /** @description The main-game set piece: question marquee over the gold survey frame with the BANK plate, strikes, and the steal-phase pulse. */
  function feudBoard() {
    var st = GS.state, b = st.board || {};
    var flips = feudDelta(b);
    var answers = b.answers || [];
    var stealTeam = (st.phase === 'steal' && b.steal && b.steal.team) || null;
    var bank = (Number(b.bank) || 0) * (Number(b.multiplier) || 1);
    var frame = GS.el('div', { class: 'gsf-frame' + (stealTeam ? ' steal-' + stealTeam : '') },
      GS.el('div', { class: 'gsf-bank' }, 'BANK ', GS.el('b', {}, '$' + bank)),
      answers.length ? cardGrid(answers, flips)
        : GS.el('div', { class: 'gsf-emblem' }, GS.el('span', {}, 'FAMILY FEUD')));
    return GS.el('div', { class: 'gsf-set' },
      GS.el('div', { class: 'gsf-question' }, b.question || 'Survey says… get ready!'),
      st.phase === 'faceoff' ? GS.el('div', { class: 'gsf-faceoff' }, '⚡ FACE-OFF!') : null,
      stealTeam ? GS.el('div', { class: 'gsf-steal-banner team' + stealTeam }, 'TEAM ' + stealTeam + ' STEALS FOR $' + bank + '!') : null,
      strikes(), frame);
  }

  // ── Fast Money ────────────────────────────────────────────────────────────
  var seenFm = null;                 // recorded-answer counts per run, last render
  var fmShown = 0, fmTarget = 0;     // the odometer's painted vs true total

  // One module-level ticker for the page lifetime (the gs-controls tickPaint
  // pattern): it only repaints the #gsf-fm-total node when it exists, so the
  // per-poll DOM rebuild never stacks intervals or orphans an animation.
  setInterval(function () {
    if (fmShown === fmTarget) return;
    var d = fmTarget - fmShown;
    fmShown += d > 0 ? Math.max(1, Math.ceil(d / 9)) : Math.min(-1, Math.floor(d / 9));
    var node = document.getElementById('gsf-fm-total');
    if (node) node.textContent = String(fmShown);
  }, 70);

  /** @description Diff the two Fast Money runs against last render: {index:true} per run for rows recorded since. */
  function fmDelta(fm) {
    var counts = [((fm.answers || [])[0] || []).length, ((fm.answers || [])[1] || []).length];
    var flips = [{}, {}];
    if (seenFm) {
      for (var r = 0; r < 2; r++) for (var i = seenFm[r]; i < counts[r]; i++) flips[r][i] = true;
    }
    seenFm = counts;
    return flips;
  }

  /** @description One board row: empty slot, covered card (the other run stays hidden mid-game, like the show), or the recorded answer with its points and DUPLICATE stamp. */
  function fmRow(a, open, flip) {
    if (!a) return GS.el('div', { class: 'gsf-fm-cell empty' });
    if (!open) return GS.el('div', { class: 'gsf-fm-cell covered' }, GS.el('span', { class: 'gsf-fm-dots' }, '• • •'));
    return GS.el('div', { class: 'gsf-fm-cell' + (flip ? ' flip' : '') },
      GS.el('span', { class: 'gsf-fm-txt' }, a.text),
      a.duplicate ? GS.el('span', { class: 'gsf-dup' }, 'DUPLICATE') : null,
      GS.el('span', { class: 'gsf-fm-pts' }, String(a.points || 0)));
  }

  /** @description One run column: player nameplate over five rows; a run is open while it's being played and at the reveal. */
  function fmColumn(fm, run, reveal, flips) {
    var open = reveal || fm.turn === run;
    var col = GS.el('div', { class: 'gsf-fm-col' },
      GS.el('div', { class: 'gsf-fm-name' }, seatName((fm.players || [])[run])));
    var list = (fm.answers || [])[run] || [];
    for (var i = 0; i < 5; i++) col.appendChild(fmRow(list[i], open, !!flips[i]));
    return col;
  }

  /** @description The Fast Money set piece: gold masthead, deep-blue two-run board, and the odometer TOTAL (>=200 fanfare arrives via the server's milestone beat). */
  function fmBoard() {
    var st = GS.state, fm = st.fm || {};
    var flips = fmDelta(fm);
    fmTarget = Number(fm.total) || 0;
    var reveal = st.phase === 'fm-reveal' || st.phase === 'outro';
    var wrap = GS.el('div', { class: 'gsf-set gsf-fm' },
      GS.el('div', { class: 'gsf-fm-masthead' }, 'FAST MONEY'));
    if (st.phase === 'fm-setup') {
      wrap.appendChild(GS.el('div', { class: 'gsf-fm-status' }, 'Two players, five questions. Host: start the round when ready.'));
      return wrap;
    }
    if (st.phase === 'fm-play') {
      var q = (fm.questions || [])[fm.current];
      wrap.appendChild(GS.el('div', { class: 'gsf-fm-status' }, seatName((fm.players || [])[fm.turn]) + ' — question ' + ((fm.current || 0) + 1) + ' of 5'));
      if (q) wrap.appendChild(GS.el('div', { class: 'gsf-question gsf-fm-q' }, q.question));
    } else {
      wrap.appendChild(GS.el('div', { class: 'gsf-fm-status' }, fm.won ? 'FAST MONEY WON!' : ('Total ' + (fm.total || 0) + ' — short of 200')));
    }
    var boardEl = GS.el('div', { class: 'gsf-fm-board' });
    for (var r = 0; r < 2; r++) boardEl.appendChild(fmColumn(fm, r, reveal, flips[r]));
    wrap.appendChild(boardEl);
    wrap.appendChild(GS.el('div', { class: 'gsf-fm-totalwrap' },
      GS.el('span', { class: 'gsf-fm-totallabel' }, 'TOTAL'),
      GS.el('span', { class: 'gsf-fm-total', id: 'gsf-fm-total' }, String(fmShown)),
      fm.won ? GS.el('span', { class: 'gsf-fm-won' }, '★ 200+') : null));
    return wrap;
  }

  function board() {
    if (isFm(GS.state.phase) && GS.state.fm) return fmBoard();
    return feudBoard();
  }

  function hostKey() {
    var st = GS.state, board2 = st.board || {};
    var list = GS.el('div', { class: 'gs-hostlist' });
    if (isFm(st.phase) && st.fm) {
      var q = (st.fm.questions || [])[st.fm.current];
      if (!q || st.phase !== 'fm-play') return null;
      list.appendChild(GS.el('div', { class: 'a up' }, GS.el('span', {}, q.question), GS.el('span', {}, '')));
      q.answers.forEach(function (a, i) {
        list.appendChild(GS.el('div', { class: 'a' }, GS.el('span', {}, (i + 1) + '. ' + a.text), GS.el('span', {}, a.points)));
      });
    } else {
      if (!(board2.answers || []).length) return null;
      board2.answers.forEach(function (a, i) {
        list.appendChild(GS.el('div', { class: 'a' + (a.revealed ? ' up' : '') },
          GS.el('span', {}, (i + 1) + '. ' + a.text), GS.el('span', {}, a.points + (a.revealed ? ' ✓' : ''))));
      });
    }
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px' },
      GS.el('div', { class: 'gs-muted', style: 'margin-bottom:6px' }, 'Answer key (host eyes only)'), list);
  }

  /** The Fast Money launcher: visible on the host desk once the game is decided. */
  function hostExtras() {
    var st = GS.state;
    if (st.fm || ['round-win', 'scoreboard'].indexOf(st.phase) < 0) return null;
    if ((Number(st.round) || 0) < ((st.board && st.board.roundsTotal) || 3)) return null;
    var players = GS.players();
    if (players.length < 2) return null;
    function sel() {
      var s = GS.el('select', { class: 'gs-input', style: 'max-width:180px' });
      players.forEach(function (p) { s.appendChild(GS.el('option', { value: p.seatId }, p.name)); });
      return s;
    }
    var s1 = sel(), s2 = sel();
    if (players[1]) s2.value = players[1].seatId;
    return GS.el('div', { class: 'gs-row', style: 'margin:12px 0' },
      GS.el('span', { class: 'gs-muted' }, '💰 Fast Money:'), s1, s2,
      GS.el('button', { class: 'gs-btn gold', onclick: function () {
        if (s1.value === s2.value) { GS.toast('Pick two different players.'); return; }
        GS.act({ type: 'startFastMoney', seat1: s1.value, seat2: s2.value });
      } }, 'Play Fast Money'));
  }

  GS.registerShowUi({
    id: 'family-feud',
    board: board,
    answerPhases: ['faceoff', 'play', 'steal', 'fm-play'],
    wagerPhases: [],
    startPhases: ['lobby', 'round-win', 'scoreboard', 'fm-setup'],
    hostKey: hostKey,
    controls: null,
    hostExtras: hostExtras,
  });
})();
