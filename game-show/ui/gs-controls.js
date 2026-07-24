/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 03:02:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The clock and the fire exit: a live countdown every surface renders from the server's deadline, and the host desk's stuck-game recovery panel. Show-agnostic — the countdown reads state.timer and the override buttons are gated by what the server accepts, never by a hard-coded phase list.
 */

/* global window, document, setInterval */
(function () {
  'use strict';
  var GS = window.GS;
  var C = GS.controls = {};

  // The server owns the deadline; the browser only counts down to it. Clock skew is
  // measured once per poll in gs-core (GS.skew) rather than trusted per frame, so a
  // phone whose clock is two minutes off still shows the same seconds as the TV.

  /** @description Milliseconds left on the round clock, or null when none is running. */
  C.remaining = function () {
    var timer = GS.state && GS.state.timer;
    if (!timer) return null;
    if (timer.pausedAt) return Math.max(0, timer.endsAt - timer.pausedAt);
    return Math.max(0, timer.endsAt - (Date.now() + GS.skew));
  };

  /** @description Whole seconds left, for display. */
  function secondsLeft() {
    var ms = C.remaining();
    return ms === null ? null : Math.ceil(ms / 1000);
  }

  /** @description Severity class so the last five seconds read as urgent on a TV. */
  function urgency(secs) {
    if (secs === null) return '';
    if (secs <= 5) return ' danger';
    if (secs <= 10) return ' warn';
    return '';
  }

  /** @description The small clock chip carried in every surface header. */
  C.countdown = function () {
    var timer = GS.state && GS.state.timer;
    if (!timer) return null;
    var secs = secondsLeft();
    return GS.el('span', { class: 'gs-chip gs-clock' + urgency(secs) + (timer.pausedAt ? ' paused' : ''), id: 'gs-clock' },
      (timer.pausedAt ? '⏸ ' : '⏱ ') + secs + 's' + (timer.note ? ' · ' + timer.note : ''));
  };

  /** @description The big TV countdown, shown while a window is genuinely racing. */
  C.bigClock = function () {
    var timer = GS.state && GS.state.timer;
    if (!timer) return null;
    var secs = secondsLeft();
    return GS.el('div', { class: 'gs-bigclock' + urgency(secs), id: 'gs-bigclock' }, timer.pausedAt ? '⏸' : String(secs));
  };

  // ── local ticker ──────────────────────────────────────────────────────────
  // Repaints only the clock nodes (never the whole surface) so a running countdown
  // does not fight the renderer or lose input focus mid-answer.
  var firedAt = 0;
  function tickPaint() {
    var secs = secondsLeft();
    var chip = document.getElementById('gs-clock');
    var big = document.getElementById('gs-bigclock');
    var timer = GS.state && GS.state.timer;
    if (chip && timer) {
      chip.textContent = (timer.pausedAt ? '⏸ ' : '⏱ ') + secs + 's' + (timer.note ? ' · ' + timer.note : '');
      chip.className = 'gs-chip gs-clock' + urgency(secs) + (timer.pausedAt ? ' paused' : '');
    }
    if (big && timer) {
      big.textContent = timer.pausedAt ? '⏸' : String(secs);
      big.className = 'gs-bigclock' + urgency(secs);
    }
    // The server resolves a lapsed window on the next poll; nudge that poll once so
    // the room does not sit on a visible zero for up to a full sync cadence.
    if (secs === 0 && timer && !timer.pausedAt && GS.roomId && Date.now() - firedAt > 3000) {
      firedAt = Date.now();
      GS.poll();
    }
  }
  setInterval(tickPaint, 250);

  // ── host override panel ───────────────────────────────────────────────────

  /** @description Send one host override and surface the server's reason if it refuses. */
  C.override = function (type, extra) {
    var action = { type: type };
    if (extra) Object.keys(extra).forEach(function (k) { action[k] = extra[k]; });
    return GS.act(action);
  };

  /** @description One override button. */
  function btn(label, type, extra, tone) {
    return GS.el('button', { class: 'gs-btn ' + (tone || 'ghost'), onclick: function () { C.override(type, extra); } }, label);
  }

  /** @description Clock row: extend, freeze, or force the current window to lapse. */
  function clockRow() {
    var timer = GS.state && GS.state.timer;
    return GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-muted' }, 'Clock:'),
      timer ? C.countdown() : GS.el('span', { class: 'gs-muted' }, 'not running'),
      btn('+30s', 'addTime', { ms: 30000 }),
      timer && timer.pausedAt ? btn('▶ Resume', 'resumeTimer', null, 'gold') : btn('⏸ Pause', 'pauseTimer'),
      btn('⏭ Move it along', 'forceTimeout', null, 'blue'));
  }

  /** @description Feud-only recovery: reveal a specific answer the host judges earned. */
  function feudRevealRow() {
    var answers = (GS.state.board && GS.state.board.answers) || [];
    var hidden = [];
    answers.forEach(function (a, i) { if (!a.revealed) hidden.push({ a: a, i: i }); });
    if (!hidden.length) return null;
    var sel = GS.el('select', { class: 'gs-input', style: 'max-width:220px' });
    hidden.forEach(function (h) { sel.appendChild(GS.el('option', { value: String(h.i) }, (h.i + 1) + '. ' + h.a.text)); });
    return GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-muted' }, 'Force reveal:'), sel,
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { C.override('forceReveal', { index: Number(sel.value) }); } }, 'Reveal'));
  }

  /** @description Hand the board to a specific team (Feud) or player (Jeopardy). */
  function controlRow(showId) {
    if (showId === 'family-feud') {
      return GS.el('div', { class: 'gs-row' },
        GS.el('span', { class: 'gs-muted' }, 'Give the board to:'),
        btn('Team A', 'setControl', { team: 'A' }), btn('Team B', 'setControl', { team: 'B' }),
        btn('Clear a strike', 'clearStrike'));
    }
    var sel = GS.el('select', { class: 'gs-input', style: 'max-width:200px' });
    GS.players().forEach(function (s) { sel.appendChild(GS.el('option', { value: s.seatId }, s.name)); });
    return GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-muted' }, 'Give the board to:'), sel,
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { if (sel.value) C.override('setControl', { seatId: sel.value }); } }, 'Set'));
  }

  /** @description Remove a podium whose player has left the party. */
  function removeRow() {
    var players = GS.players();
    if (!players.length) return null;
    var sel = GS.el('select', { class: 'gs-input', style: 'max-width:200px' });
    players.forEach(function (s) { sel.appendChild(GS.el('option', { value: s.seatId }, s.name)); });
    return GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-muted' }, 'Podium:'), sel,
      GS.el('button', { class: 'gs-btn ghost', onclick: function () {
        if (!sel.value) return;
        GS.api.post('/podium/remove', { roomId: GS.roomId, seatId: sel.value }).then(function (r) {
          if (r.body && r.body.ok === false) GS.toast(r.body.error || 'Could not remove that podium.');
          GS.poll();
        });
      } }, 'Remove'));
  }

  /**
   * @description The host desk's stuck-game recovery panel.
   * @param {string} showId - Which show is running, for the show-specific rows.
   * @returns {HTMLElement} The panel node.
   */
  C.hostPanel = function (showId) {
    var box = GS.el('div', { class: 'gs-panel gs-override', style: 'padding:12px' },
      GS.el('div', { class: 'gs-muted', style: 'margin-bottom:6px' }, 'If the game gets stuck (host only)'));
    box.appendChild(clockRow());
    box.appendChild(GS.el('div', { class: 'gs-row' },
      btn('🔔 Re-open buzzer', 'reopenBuzzer'),
      showId === 'family-feud' ? btn('⏭ Skip round', 'skipRound') : btn('⏭ Skip clue', 'skipClue'),
      btn('🏁 End game', 'endGame', null, 'gold')));
    var reveal = showId === 'family-feud' ? feudRevealRow() : null;
    if (reveal) box.appendChild(reveal);
    box.appendChild(controlRow(showId));
    var remove = removeRow();
    if (remove) box.appendChild(remove);
    return box;
  };
})();
