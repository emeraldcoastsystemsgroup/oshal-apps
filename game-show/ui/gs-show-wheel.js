/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 10:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Wheel of Fortune client renderer, registered via GS.registerShowUi: letter-tile puzzle board, called-letters strip, per-player round banks, a SPIN button, the consonant grid while a spin is pending, and a buy-a-vowel row when the bank covers it. The generic answer box (answerPhases) is the solve input. New tile styling is inline — game-show.css is shared and untouched.
 * 2026-07-26 20:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast set piece: a real SVG wheel (17 segments mirroring the server order, rotated radial labels, gold hub, fixed pointer) spun by ONE module-level ticker that repaints the rotor BY ID — outcomes detected from the event tail (spins $N / BANKRUPT / loses a turn) with a spin.value fallback, 3-5 decelerating turns landing on the matching segment, clacker ticks while turning, ding/strike on land. Puzzle wall as a green-framed white-tile board with cyan flip-in on newly revealed letters, category banner, A-Z called-letters tracker, round-bank pods with the control seat lit, and a big gold wheel SPIN button in the dock. Gating logic and the registerShowUi contract are unchanged; styling moved to gs-set-wheel.css (gsw- prefix).
 */

/* global window, document, setInterval */
(function () {
  'use strict';
  var GS = window.GS;
  if (!GS || typeof GS.registerShowUi !== 'function') return;   // registry loads first; bail rather than crash the surface

  var VOWELS = ['A', 'E', 'I', 'O', 'U'];
  var CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ'.split('');
  var VOWEL_COST = 250;

  // Mirrors SEGMENTS in lib/shows/wheel.js — the physical wheel must show the
  // same 17 slots the server picks from, in the same order.
  var SEGMENTS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 650, 700, 800, 900, 'bankrupt', 'bankrupt', 'lose-turn'];
  var SEG = 360 / SEGMENTS.length;
  // 7-color cycle over 14 money segments: no two adjacent segments repeat.
  var MONEY_FILL = ['#ef4444', '#fbbf24', '#38bdf8', '#22c55e', '#f472b6', '#a78bfa', '#fb923c'];
  var MONEY_TEXT = ['#ffffff', '#1f2937', '#0c2a3f', '#052e16', '#3f0f2a', '#2a1065', '#431407'];

  /** @description Resolve a seatId to its display name for turn/bank labels. */
  function seatName(seatId) {
    var hit = GS.seats.filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : (seatId || '');
  }

  /** @description Play a chrome sfx cue if the chrome is loaded (tv/stage have it; nothing crashes without it). */
  function cue(name) { if (typeof GS.sfx === 'function') GS.sfx(name); }

  /** @description Whether the viewer asked for reduced motion — the wheel then jumps to its landing instead of spinning. */
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ── the wheel (SVG built once; only the rotor's rotate() ever changes) ─────
  /** @description Point on a circle, angle measured clockwise from 12 o'clock (SVG y-down makes clockwise the positive sweep). */
  function pt(r, deg) {
    var rad = deg * Math.PI / 180;
    return (r * Math.sin(rad)).toFixed(2) + ' ' + (-r * Math.cos(rad)).toFixed(2);
  }

  /** @description One wedge + its radial label; segment i is centered at i*SEG so index 0 starts under the pointer. */
  function wedge(i) {
    var val = SEGMENTS[i];
    var a0 = i * SEG - SEG / 2, a1 = a0 + SEG, c = i * SEG;
    var fill, text, label, size;
    if (val === 'bankrupt') { fill = '#0b0b12'; text = '#ffffff'; label = 'BANKRUPT'; size = 8; }
    else if (val === 'lose-turn') { fill = '#f8fafc'; text = '#1f2937'; label = 'LOSE A TURN'; size = 6.5; }
    else { fill = MONEY_FILL[i % 7]; text = MONEY_TEXT[i % 7]; label = '$' + val; size = 13; }
    return '<path d="M 0 0 L ' + pt(100, a0) + ' A 100 100 0 0 1 ' + pt(100, a1) + ' Z" fill="' + fill + '" stroke="#0a0f2a" stroke-width="1"/>' +
      '<text transform="rotate(' + c + ') translate(0 -58) rotate(' + (c > 100 && c < 260 ? 270 : 90) + ')" text-anchor="middle" dominant-baseline="central" ' +
      'font-size="' + size + '" font-weight="900" fill="' + text + '" font-family="inherit">' + label + '</text>';
  }

  var WEDGES = (function () {
    var parts = [];
    for (var i = 0; i < SEGMENTS.length; i++) parts.push(wedge(i));
    for (var j = 0; j < SEGMENTS.length; j++) parts.push('<circle cx="' + pt(100, j * SEG - SEG / 2).replace(' ', '" cy="') + '" r="2.2" fill="#fde68a"/>');
    return parts.join('');
  })();

  /** @description The full wheel SVG at a given rotor angle: rim, wedges, hub, fixed pointer at 12 o'clock. */
  function wheelSvg(angle) {
    return '<svg class="gsw-wheel" viewBox="-115 -115 230 230" role="img" aria-label="The prize wheel">' +
      '<defs><radialGradient id="gsw-hubg" cx="38%" cy="32%"><stop offset="0%" stop-color="#fde68a"/><stop offset="70%" stop-color="#fbbf24"/><stop offset="100%" stop-color="#b45309"/></radialGradient></defs>' +
      '<circle r="103" fill="#0a0f2a" stroke="#fbbf24" stroke-width="3.5"/>' +
      '<g id="gsw-rotor" transform="rotate(' + angle.toFixed(2) + ')">' + WEDGES +
      '<circle r="20" fill="url(#gsw-hubg)" stroke="#92400e" stroke-width="1.5"/><circle r="6" fill="#b45309"/></g>' +
      '<path d="M -9 -113 L 9 -113 L 0 -91 Z" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/></svg>';
  }

  // ── spin animation ────────────────────────────────────────────────────────
  // ONE module-level ticker for the page lifetime (the whammy chaseTick pattern):
  // it repaints the rotor group BY ID and never creates nodes, so the ~1.4s
  // re-render can rebuild the whole set mid-spin — the next tick (and the render
  // itself, via currentAngle()) put the rotor right back at the eased angle.
  var cumAngle = 0;         // cumulative rotation, ever-growing so every spin turns the same way
  var anim = null;          // {from,to,start,dur,land,label} while a spin is in flight
  var lastClack = 0;        // throttles the segment-boundary tick sfx
  var lastSeenSeq = null;   // event-tail high-water mark (null = first render, don't replay history)
  var lastSpinVal = null;   // fallback outcome detector when the event tail is quiet

  /** @description The rotor angle to draw right now: eased mid-spin, resting otherwise. */
  function currentAngle() {
    if (!anim) return cumAngle;
    var t = (Date.now() - anim.start) / anim.dur;
    if (t >= 1) return anim.to;
    var eased = 1 - Math.pow(1 - t, 3);
    return anim.from + (anim.to - anim.from) * eased;
  }

  /** @description A landing rotation that parks the pointer on a segment matching the outcome (BANKRUPT picks one of its two slots), with in-segment jitter. */
  function targetFor(kind, value) {
    var idx;
    if (kind === 'bankrupt') idx = 14 + (Math.random() < 0.5 ? 0 : 1);
    else if (kind === 'lose-turn') idx = 16;
    else { idx = SEGMENTS.indexOf(Number(value)); if (idx < 0) idx = 0; }
    var land = -idx * SEG + (Math.random() - 0.5) * SEG * 0.6;
    var base = cumAngle + 1080 + Math.random() * 720;   // 3-5 full turns before settling
    return base + (((land - base) % 360) + 360) % 360;
  }

  /** @description Start (or, under reduced motion, instantly complete) a spin toward a known outcome. */
  function startSpin(kind, value) {
    var to = targetFor(kind, value);
    var label = kind === 'bankrupt' ? 'BANKRUPT' : (kind === 'lose-turn' ? 'LOSE A TURN' : '$' + value);
    var land = kind === 'value' ? 'ding' : 'strike';
    if (reducedMotion()) {
      cumAngle = to;
      var rotor = document.getElementById('gsw-rotor');
      if (rotor) rotor.setAttribute('transform', 'rotate(' + cumAngle.toFixed(2) + ')');
      cue(land);
      return;
    }
    anim = { from: cumAngle, to: to, start: Date.now(), dur: 3400 + Math.random() * 900, land: land, label: label };
    cue('spin');
  }

  /** @description Advance the in-flight spin one frame: repaint the rotor by id, clack past segment edges, land with the outcome cue. */
  function spinTick() {
    if (!anim) return;
    var now = Date.now();
    var angle = currentAngle();
    var rotor = document.getElementById('gsw-rotor');
    if (rotor) rotor.setAttribute('transform', 'rotate(' + angle.toFixed(2) + ')');
    if (now - anim.start >= anim.dur) {
      cumAngle = anim.to;
      var out = document.getElementById('gsw-outcome');
      if (out) out.textContent = anim.label;
      cue(anim.land);
      anim = null;
      return;
    }
    if (now - lastClack > 90 && Math.floor(angle / SEG) !== Math.floor((angle - 2) / SEG)) { lastClack = now; cue('tick'); }
  }
  setInterval(spinTick, 40);

  /** @description Turn state deltas into spin launches: new tail events (spins $N / BANKRUPT / loses a turn) first, a null→value flip of board.spin as the fallback. First render only records the high-water marks. */
  function checkBeats(board) {
    var evs = GS.events || [];
    var maxSeq = evs.length ? evs[evs.length - 1].seq : 0;
    var first = lastSeenSeq === null;
    var fired = false;
    if (!first) {
      evs.forEach(function (e) {
        if (e.seq <= lastSeenSeq) return;
        var text = String(e.content || '');
        var m = /spins \$(\d+)/.exec(text);
        if (m) { startSpin('value', Number(m[1])); fired = true; }
        else if (/BANKRUPT/i.test(text)) { startSpin('bankrupt'); fired = true; }
        else if (/loses a turn/i.test(text)) { startSpin('lose-turn'); fired = true; }
      });
    }
    lastSeenSeq = maxSeq;
    var sv = (board.spin && board.spin.value != null) ? board.spin.value : null;
    if (!first && !fired && !anim && sv != null && lastSpinVal == null) startSpin('value', sv);
    lastSpinVal = sv;
  }

  // ── the puzzle wall ───────────────────────────────────────────────────────
  var lastPuzzle = null, lastShown = null;   // which letters were already up, so ONLY fresh reveals flip

  /** @description The puzzle as the show's tile wall: blank white tiles hide letters, revealed letters flip in (cyan flash on the render where they first appear), spaces are gaps, punctuation always shows. */
  function tiles(board) {
    var wall = GS.el('div', { class: 'gsw-puzzle' });
    var puzzle = String(board.puzzle || '');
    if (!puzzle) { wall.appendChild(GS.el('div', { class: 'gs-muted gsw-waiting' }, 'Waiting for the puzzle…')); lastPuzzle = null; lastShown = null; return wall; }
    var guessed = board.guessed || [];
    var shownNow = {}, fresh = {};
    puzzle.split('').forEach(function (ch) {
      if (/[A-Z]/.test(ch) && (board.solved || guessed.indexOf(ch) >= 0)) shownNow[ch] = 1;
    });
    if (lastPuzzle === puzzle && lastShown) {
      Object.keys(shownNow).forEach(function (ch) { if (!lastShown[ch]) fresh[ch] = 1; });
    }
    lastPuzzle = puzzle; lastShown = shownNow;
    puzzle.split(' ').forEach(function (word) {
      var w = GS.el('span', { class: 'gsw-word' });
      word.split('').forEach(function (ch) {
        var isLetter = /[A-Z]/.test(ch);
        var shown = !isLetter || !!shownNow[ch];
        w.appendChild(GS.el('span', { class: 'gsw-tile' + (shown ? ' shown' : '') + (fresh[ch] ? ' flip' : '') }, shown ? ch : ' '));
      });
      wall.appendChild(w);
    });
    return wall;
  }

  /** @description The A-Z called-letters tracker: every letter, called ones dimmed out. */
  function alphaTracker(board) {
    var guessed = board.guessed || [];
    var grid = GS.el('div', { class: 'gsw-alpha' });
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (letter) {
      grid.appendChild(GS.el('span', { class: 'gsw-al' + (guessed.indexOf(letter) >= 0 ? ' called' : '') }, letter));
    });
    return grid;
  }

  /** @description Per-player round-bank pods — the money BANKRUPT would erase — with the control seat lit gold. */
  function bankPods(board) {
    var banks = board.banks || {};
    var row = GS.el('div', { class: 'gsw-pods' });
    GS.players().forEach(function (s) {
      row.appendChild(GS.el('div', { class: 'gsw-pod' + (board.control === s.seatId ? ' control' : '') },
        GS.el('span', { class: 'gsw-pod-name' }, s.name),
        GS.el('span', { class: 'gsw-pod-cash' }, '$' + (Number(banks[s.seatId]) || 0))));
    });
    return row;
  }

  /** @description Turn + spin status line under the category banner. */
  function statusRow(board) {
    var row = GS.el('div', { class: 'gsw-status' });
    if (board.winner) row.appendChild(GS.el('span', { class: 'gsw-solved' }, '★ ' + seatName(board.winner) + ' SOLVES IT!'));
    else if (board.control) row.appendChild(GS.el('span', { class: 'gs-chip' }, 'Turn: ' + seatName(board.control)));
    return row;
  }

  /** @description The Wheel set piece: green-framed tile wall, category banner, then the wheel beside the letter tracker + bank pods. */
  function board() {
    var b = (GS.state && GS.state.board) || {};
    checkBeats(b);
    var sv = (b.spin && b.spin.value != null) ? b.spin.value : null;
    var outcome = anim ? 'SPINNING…' : (sv != null ? 'ON THE WHEEL — $' + sv : '');
    return GS.el('div', { class: 'gsw-set' },
      GS.el('div', { class: 'gsw-puzzleframe' }, tiles(b)),
      GS.el('div', { class: 'gsw-category' }, b.category || 'Wheel of Fortune'),
      statusRow(b),
      GS.el('div', { class: 'gsw-lower' },
        GS.el('div', { class: 'gsw-wheelwrap', html: wheelSvg(currentAngle()) },
          GS.el('div', { class: 'gsw-outcome', id: 'gsw-outcome' }, outcome)),
        GS.el('div', { class: 'gsw-side' }, alphaTracker(b), bankPods(b))));
  }

  /** @description Host-eyes-only answer key: the unmasked puzzle (null before a round opens). */
  function hostKey() {
    var b = (GS.state && GS.state.board) || {};
    if (!b.puzzle) return null;
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px' },
      GS.el('div', { class: 'gs-muted', style: 'margin-bottom:6px' }, 'Puzzle (host eyes only)'),
      GS.el('div', { style: 'font-weight:800' }, (b.category || '?') + ' — ' + b.puzzle));
  }

  /** @description A grid of letter buttons, skipping letters already called. */
  function letterGrid(letters, guessed, send) {
    var grid = GS.el('div', { class: 'gsw-letters' });
    letters.forEach(function (letter) {
      if ((guessed || []).indexOf(letter) >= 0) return;
      grid.appendChild(GS.el('button', {
        class: 'gs-btn ghost gsw-letter',
        onclick: function () { send(letter); },
      }, letter));
    });
    return grid;
  }

  /**
   * @description Per-player action buttons for one seat. When the seat holds the
   * wheel (or the turn is unclaimed): SPIN, plus buy-a-vowel once the bank covers
   * $250. While that seat's spin is pending: the consonant grid. The solve input
   * is the surface's generic answer box (answerPhases), labeled by the hint below.
   * @param {?string} actorSeatId - The seat these controls drive (hotseat-aware).
   * @returns {?object} A DOM node, or null when there is nothing for this seat to do.
   */
  function controls(actorSeatId) {
    var st = GS.state || {};
    if (st.phase !== 'puzzle') return null;
    var b = st.board || {};
    var seat = actorSeatId || ((GS.mySeat() || {}).seatId || null);
    if (!seat) return null;
    var box = GS.el('div', { class: 'gs-col gsw-controls', style: 'align-items:center' });
    if (b.control && b.control !== seat) {
      box.appendChild(GS.el('div', { class: 'gs-muted' }, seatName(b.control) + ' has the wheel…'));
      return box;
    }
    if (b.spin && b.spin.value != null) {
      box.appendChild(GS.el('div', { class: 'gs-chip gsw-callchip' }, 'You spun $' + b.spin.value + ' — call a consonant'));
      box.appendChild(letterGrid(CONSONANTS, b.guessed, function (letter) { GS.act({ type: 'guessLetter', letter: letter }, actorSeatId); }));
      return box;
    }
    box.appendChild(GS.el('button', {
      class: 'gsw-spinbtn',
      onclick: function () { GS.act({ type: 'spin' }, actorSeatId); },
    }, 'SPIN'));
    if ((Number((b.banks || {})[seat]) || 0) >= VOWEL_COST) {
      box.appendChild(GS.el('div', { class: 'gs-muted', style: 'margin-top:6px' }, 'Buy a vowel — $' + VOWEL_COST));
      box.appendChild(letterGrid(VOWELS, b.guessed, function (letter) { GS.act({ type: 'buyVowel', letter: letter }, actorSeatId); }));
    }
    box.appendChild(GS.el('div', { class: 'gs-muted', style: 'margin-top:6px;font-size:13px' }, 'Type the full puzzle to solve'));
    return box;
  }

  GS.registerShowUi({
    id: 'wheel',
    board: board,
    answerPhases: ['puzzle'],        // the generic answer box is the solve input
    wagerPhases: [],
    startPhases: ['lobby', 'round-win'],
    hostKey: hostKey,
    controls: controls,
    hostExtras: null,
    // The solve box only belongs to the wheel holder with no consonant owed —
    // anyone else typing into it would just be refused by the server.
    canType: function (seatId) {
      var b = (GS.state && GS.state.board) || {};
      if (b.spin && b.spin.value != null) return false;
      return !b.control || b.control === seatId;
    },
  });
})();
