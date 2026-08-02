/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-26 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast chrome: GS.sfx (small WebAudio cue synth, unlocked by the first pointer press), GS.onBeat (event→cue scoring fed by gs-core), and GS.play — the full-bleed set frame (marquee, beams, floor, lower-third caption, control dock), the podium-character row drawn from live seats/scores, the once-per-game opening titles, and sync() which stamps body[data-gs-show] and turns state deltas (buzz lock, round 0→1) into one-shot beats.
 * 2026-07-26 21:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Integration fix: restore GS.qrNode (the join-link QR the browser playthrough asserts on the TV lobby shot) — it was dropped when the chrome was rebuilt; the img hides itself when /qr is unavailable so the code text always suffices.
 */

/* global window, document, setTimeout */
(function () {
  'use strict';
  var GS = window.GS;
  var P = GS.presence;

  // ── GS.sfx: a tiny cue synth ──────────────────────────────────────────────
  // The AudioContext is created lazily and resumed only by a real pointer press —
  // autoplay policy makes anything earlier a silent no-op anyway.
  var MASTER = 0.25;   // every cue sits ~-12dB under the host's voice
  var actx = null;

  function audio() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
    return actx;
  }
  document.addEventListener('pointerdown', function () {
    var a = audio();
    if (a && a.state === 'suspended') a.resume().catch(function () {});
  });

  function tone(a, f, f2, at, dur, type, vol) {
    var t0 = a.currentTime + (at || 0);
    var osc = a.createOscillator(), g = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime((vol || 1) * MASTER, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(a, at, dur, vol, freq) {
    var len = Math.floor(a.sampleRate * dur);
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    var src = a.createBufferSource(); src.buffer = buf;
    var flt = a.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = freq || 2400; flt.Q.value = 0.6;
    var g = a.createGain(); g.gain.value = (vol || 1) * MASTER;
    src.connect(flt); flt.connect(g); g.connect(a.destination);
    src.start(a.currentTime + (at || 0));
  }

  var CUES = {
    ding: function (a) { tone(a, 1047, 0, 0, 0.5, 'sine', 0.8); tone(a, 1568, 0, 0, 0.35, 'sine', 0.3); },
    buzz: function (a) { tone(a, 170, 150, 0, 0.5, 'sawtooth', 0.7); },
    strike: function (a) { tone(a, 110, 95, 0, 0.55, 'square', 0.55); tone(a, 82, 0, 0.02, 0.55, 'square', 0.45); },
    fanfare: function (a) {
      [523, 659, 784].forEach(function (f, i) { tone(a, f, 0, i * 0.14, 0.22, 'triangle', 0.6); });
      tone(a, 1047, 0, 0.42, 0.6, 'triangle', 0.7);
    },
    applause: function (a) { noiseBurst(a, 0, 1.5, 0.5, 2600); noiseBurst(a, 0.08, 1.2, 0.35, 1400); },
    tick: function (a) { tone(a, 1500, 0, 0, 0.035, 'square', 0.3); },
    spin: function (a) { var at = 0; for (var i = 0; i < 10; i++) { tone(a, 1400 - i * 60, 0, at, 0.03, 'square', 0.3); at += 0.05 + i * 0.018; } },
    whammy: function (a) { tone(a, 420, 70, 0, 0.7, 'sawtooth', 0.65); tone(a, 210, 55, 0.1, 0.65, 'square', 0.3); },
    pop: function (a) { tone(a, 640, 320, 0, 0.09, 'sine', 0.6); },
  };

  /**
   * @description Play one named broadcast cue; silently a no-op until the user's
   *   first pointer press has unlocked the AudioContext.
   * @param {string} name - ding|buzz|strike|fanfare|applause|tick|spin|whammy|pop.
   * @returns {void}
   */
  GS.sfx = function (name) {
    var a = audio();
    if (!a || a.state !== 'running' || !CUES[name]) return;
    try { CUES[name](a); } catch (_e) { /* a mid-unlock race is never worth a crash */ }
  };

  /**
   * @description Score one incoming room event as a broadcast cue; gs-core calls
   *   this for every event in the sync tail.
   * @param {{kind:string,content:*}} e - The event as delivered by /sync.
   * @returns {void}
   */
  GS.onBeat = function (e) {
    if (!e || !e.kind) return;
    var kind = String(e.kind), text = String(e.content || '').toLowerCase();
    if (kind.indexOf('whammy') >= 0 || text.indexOf('whammy') >= 0) { GS.sfx('whammy'); return; }
    if (kind.indexOf('strike') >= 0) { GS.sfx('strike'); return; }
    if (kind.indexOf('reveal') >= 0) { GS.sfx('ding'); return; }
    if (kind.indexOf('spin') >= 0) { GS.sfx('spin'); return; }
    if (kind === 'react') { GS.sfx('pop'); return; }
    if (kind.indexOf('win') >= 0 || text.indexOf('win') >= 0) { GS.sfx('fanfare'); GS.sfx('applause'); }
  };

  // ── GS.play: the set frame, the characters, the titles ────────────────────
  var play = GS.play = {};
  var lastLock = null, lastRound = null, introFired = false;

  /**
   * @description The room's join-link QR (SVG rendered by /qr). Hides itself on
   *   load failure — the endpoint is optional sugar, the 6-letter code is the
   *   contract. The TV lobby shot shows it next to the join code.
   * @returns {?HTMLElement} The img node, or null without a room.
   */
  GS.qrNode = function () {
    if (!GS.roomId) return null;
    var img = GS.el('img', { class: 'gs-qr', alt: 'Scan to join',
      src: GS.base + '/qr?roomId=' + GS.roomId + '&origin=' + encodeURIComponent(window.location.origin) });
    img.addEventListener('error', function () { img.style.display = 'none'; });
    return img;
  };

  /**
   * @description Per-render chrome sync: stamps body[data-gs-show] for the css
   *   set treatments and turns state deltas the event tail can miss (buzz lock,
   *   round 0→1) into one-shot beats. Surfaces call it at the top of render.
   * @returns {void}
   */
  play.sync = function () {
    var st = GS.state || {};
    document.body.dataset.gsShow = st.showId || (GS.show && GS.show.id) || '';
    var lock = (st.buzz && st.buzz.lockedBy) || null;
    if (lock && lock !== lastLock) GS.sfx('buzz');
    lastLock = lock;
    var round = Number(st.round) || 0;
    if (lastRound === 0 && round === 1 && !introFired) { introFired = true; play.intro((GS.show && GS.show.title) || 'GAME SHOW'); }
    lastRound = round;
  };

  /**
   * @description The opening-titles overlay (~3s): beams, title zoom, APPLAUSE
   *   sign, fanfare then applause. Fired automatically once when round goes 0→1.
   * @param {string} title - The show title to zoom in.
   * @returns {void}
   */
  play.intro = function (title) {
    if (document.querySelector('.gp-intro')) return;
    var ov = GS.el('div', { class: 'gp-intro' },
      GS.el('div', { class: 'gp-intro-beams' }),
      GS.el('div', { class: 'gp-intro-title' }, title || 'GAME SHOW'),
      GS.el('div', { class: 'gp-intro-sign' }, 'APPLAUSE'));
    document.body.appendChild(ov);
    GS.sfx('fanfare');
    setTimeout(function () { GS.sfx('applause'); }, 700);
    setTimeout(function () { ov.classList.add('leaving'); }, 2600);
    setTimeout(function () { ov.remove(); }, 3150);
  };

  function scoreFor(seatId) {
    var hit = (GS.scoreboard || []).filter(function (t) { return t.seatId === seatId; })[0];
    if (hit) return hit.score;
    return Number(((GS.state || {}).scores || {})[seatId]) || 0;
  }

  function character(seat, focusSeatId, withScore) {
    var st = GS.state || {}, buzz = st.buzz || {}, board = st.board || {};
    var cls = 'gp-char' + (seat.team ? ' team' + seat.team : '') +
      (buzz.lockedBy === seat.seatId ? ' buzzed' : '') +
      (board.control === seat.seatId ? ' control' : '') +
      (focusSeatId === seat.seatId ? ' focus' : '');
    var pod = GS.el('div', { class: 'gp-podium' },
      GS.el('div', { class: 'gp-nameplate' }, seat.name + (seat.me ? ' ★' : '')));
    if (withScore) pod.appendChild(GS.el('div', { class: 'gp-charscore' }, String(scoreFor(seat.seatId))));
    return GS.el('div', { class: cls },
      GS.el('div', { class: 'gp-head' }, P.tile(seat)),
      GS.el('div', { class: 'gp-torso' }),
      pod);
  }

  function teamGroup(team, focusSeatId) {
    var board = (GS.state || {}).board || {};
    var sb = (GS.scoreboard || []).filter(function (t) { return t.team === team; })[0];
    var line = GS.el('div', { class: 'gp-team-line' });
    GS.teamSeats(team).forEach(function (s) { line.appendChild(character(s, focusSeatId, false)); });
    return GS.el('div', { class: 'gp-team-group team' + team + (board.control === team ? ' control' : '') },
      GS.el('div', { class: 'gp-team-banner' }, GS.el('span', {}, 'TEAM ' + team + ' '), GS.el('b', {}, String(sb ? sb.score : 0))),
      line);
  }

  /**
   * @description The podium-character row: a drawn podium + torso + P.tile head +
   *   nameplate + live score per player seat, with buzzed/control states styled.
   *   Team shows split Team A left / Team B right with the team score per banner.
   * @param {string} [focusSeatId] - Seat to visually spotlight, if any.
   * @param {string} [mood] - Optional cutaway class (dance|huddle|pan).
   * @returns {HTMLElement} The characters row node.
   */
  play.characters = function (focusSeatId, mood) {
    // Two rivals sharing one emoji face reads as a glitch on camera — dedupe the
    // default avatars across the roster (an explicit player choice always wins).
    var used = {};
    GS.players().forEach(function (s) {
      var glyph = P.avatarFor(s);
      if (!s.avatarId && used[glyph]) {
        for (var k = 1; k < P.AVATARS.length; k++) {
          var alt = P.AVATARS[(P.AVATARS.indexOf(glyph) + k) % P.AVATARS.length];
          if (!used[alt]) { s.avatarId = alt; glyph = alt; break; }
        }
      }
      used[glyph] = true;
    });
    var row = GS.el('div', { class: 'gp-chars' + (mood ? ' ' + mood : '') });
    if (!GS.players().length) {
      row.appendChild(GS.el('div', { class: 'gs-muted', style: 'align-self:center;padding:10px' }, 'Podiums are empty — players join with the code.'));
      return row;
    }
    if (GS.show && GS.show.teams) {
      row.appendChild(teamGroup('A', focusSeatId));
      row.appendChild(GS.el('div', { class: 'gp-chars-gap' }));
      row.appendChild(teamGroup('B', focusSeatId));
    } else {
      GS.players().forEach(function (s) { row.appendChild(character(s, focusSeatId, true)); });
    }
    return row;
  };

  /**
   * @description Wrap a controls node as the fixed bottom glass dock.
   * @param {HTMLElement} node - The contextual controls to pin.
   * @returns {HTMLElement} The dock node.
   */
  play.dock = function (node) {
    return GS.el('div', { class: 'gp-dock' }, GS.el('div', { class: 'gp-dock-inner' }, node));
  };

  /**
   * @description The full-bleed broadcast shell: marquee header (show logo styled
   *   via body[data-gs-show], round pill, neon join code), light beams + stage
   *   floor, the centerNode as the set area, the podium-character row, the
   *   lower-third host caption (the caption bar IS this strip), the floating big
   *   clock, and an optional bottom control dock.
   * @param {HTMLElement} centerNode - The set piece (a show board or TV shot).
   * @param {{dock:(HTMLElement|null),focus:string,mood:string}} [opts] - Dock node, spotlight seat, cutaway mood.
   * @returns {HTMLElement} The frame node.
   */
  play.frame = function (centerNode, opts) {
    opts = opts || {};
    var st = GS.state || {}, host = st.host || {};
    var frame = GS.el('div', { class: 'gp-frame' + (opts.dock ? ' has-dock' : '') });
    frame.appendChild(GS.el('div', { class: 'gp-beams' }, GS.el('i', { class: 'b1' }), GS.el('i', { class: 'b2' }), GS.el('i', { class: 'b3' })));
    frame.appendChild(GS.el('div', { class: 'gp-floor' }));
    frame.appendChild(GS.el('div', { class: 'gp-marquee' },
      GS.el('div', { class: 'gp-logo' }, (GS.show && GS.show.title) || 'GAME SHOW'),
      st.round ? GS.el('span', { class: 'gp-round' }, 'ROUND ' + st.round) : null,
      GS.el('div', { class: 'gs-grow' }),
      GS.room && GS.room.joinCode ? GS.el('div', { class: 'gp-code' }, GS.el('small', {}, 'CODE '), GS.room.joinCode) : null));
    var set = GS.el('div', { class: 'gp-set' }, centerNode);
    if (st.timer) set.appendChild(GS.el('div', { class: 'gp-clock' }, GS.controls.bigClock()));
    frame.appendChild(set);
    frame.appendChild(play.characters(opts.focus, opts.mood));
    // No line, no strip — an empty lower-third reads as a broken mystery box
    // (the exact bug the player-experience pass killed; keep its contract).
    if (host.line) {
      frame.appendChild(GS.el('div', { class: 'gs-caption gp-lower' },
        GS.el('span', { class: 'mc' }, 'HOST'), host.line));
    }
    if (opts.dock) frame.appendChild(play.dock(opts.dock));
    return frame;
  };
})();
