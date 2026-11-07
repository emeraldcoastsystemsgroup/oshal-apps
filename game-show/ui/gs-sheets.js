/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (game-show stage, clicker, host): the sheets every surface opens over the game, in their own layer outside #gs-root so the ~1.4 s re-render never shuts them. Help (the rules, the running show first; no page reload), You (your podium's team and how you are shown, or Play at a podium for a host without one), and an in-page confirm (New game leaves the running room). Each sheet is opaque, has a scrim, a title and Done, and closes on Done, the scrim and Escape. Also the 44px ? icon and the ⋯ More menu the stage and clicker headers use.
 */

/* global window, document */
(function () {
  'use strict';
  var GS = window.GS;
  var layer = null, open = null, moreOpen = false;

  function host() {
    if (!layer) { layer = GS.el('div', { id: 'gs-sheets' }); document.body.appendChild(layer); }
    return layer;
  }
  function showId() { return (GS.state && GS.state.showId) || (GS.show && GS.show.id) || 'family-feud'; }

  // ── Help: the rules, the show on the board first ──────────────────────────
  var RULES = [
    ['family-feud', 'Family Feud', 'You are on Team A. Buzz in on the face-off, then type what you think most people would say. Your team keeps answering until the board is full or you get three strikes, then the other team can steal the points. Three rounds; the top team wins, and can then try Fast Money.'],
    ['jeopardy', 'Jeopardy', 'Click a dollar amount to see a clue, buzz in if you know it, then type the answer ("What is…" is optional). Right adds the money and gives you the next pick; wrong takes it away. After two boards comes Final Jeopardy, where you bet what you have.'],
    ['wheel', 'Wheel of Fortune', 'On your turn press SPIN, then press a consonant: you win the spin for each one on the board. Buy a vowel for $250, or type the whole puzzle to solve it and keep your money. Three puzzles.'],
    ['whammy', 'Whammy!', 'Press PRESS to stop the moving lights. Cash adds up, but a Whammy wipes your bank and four put you out. Spend your spins, or pass them to the leader. The biggest bank wins.'],
  ];
  var FRIENDS = [
    'Choose Host for friends instead. Everyone opens Game Show on their phone and enters the 6-letter code.',
    'Put the Big Screen on a TV: it shows the board, the podiums, and the host.',
    'Buzz first, then type, or tap the 🎤 and just say your answer.',
    'Show yourself as a live camera, an avatar, or just your name: your call.',
  ];

  /**
   * @description The rules as page content, the given show first and the others below it.
   * @param {?string} first - The show to put first (the one on the board), or null for catalog order.
   * @returns {HTMLElement} The rules node.
   */
  GS.helpContent = function (first) {
    var rows = RULES.slice().sort(function (a, b) { return (b[0] === first) - (a[0] === first); });
    var box = GS.el('div', { class: 'gs-help' },
      GS.el('p', {}, 'Press a game. The computer plays the other podiums and the game starts by itself. A line at the bottom of the screen always tells you whose turn it is and what to do.'));
    rows.forEach(function (r, i) {
      box.appendChild(GS.el(i === 0 && first ? 'section' : 'div', { class: 'gs-help-show' + (r[0] === first ? ' current' : '') },
        GS.el('h3', {}, r[1] + (r[0] === first ? ' (this game)' : '')), GS.el('p', {}, r[2])));
    });
    var friends = GS.el('ul', {});
    FRIENDS.forEach(function (line) { friends.appendChild(GS.el('li', {}, line)); });
    box.appendChild(GS.el('div', { class: 'gs-help-show' }, GS.el('h3', {}, 'Playing with friends'), friends));
    return box;
  };

  // ── You: your podium ──────────────────────────────────────────────────────
  function seatPost(patch) {
    return GS.api.post('/seat', Object.assign({ roomId: GS.roomId }, patch)).then(function (r) {
      if (r.body && r.body.ok === false) GS.toast(r.body.error || 'Could not change your seat.');
      return GS.poll();
    }).then(function () { if (GS.presence && GS.presence.syncCamera) setTimeout(GS.presence.syncCamera, 300); paint(); });
  }
  function choice(label, on, act) {
    return GS.el('button', { type: 'button', class: 'gs-btn gs-choice' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: act }, label);
  }
  function youBody() {
    var teams = !!(GS.show && GS.show.teams), body = GS.el('div', { class: 'gs-col' });
    if (!GS.canPlay()) {
      body.appendChild(GS.el('p', {}, 'You are running this game, not playing it. Take a podium to buzz in and answer like everyone else.'));
      var row = GS.el('div', { class: 'gs-row' });
      (teams ? ['A', 'B'] : [null]).forEach(function (t) {
        row.appendChild(GS.el('button', { type: 'button', class: 'gs-btn primary', onclick: function () { seatPost({ role: 'player', team: t }).then(close); } },
          t ? 'Play on Team ' + t : 'Play at a podium'));
      });
      body.appendChild(row);
      return body;
    }
    var seat = GS.mySeat() || {};
    if (teams) {
      body.appendChild(GS.el('div', { class: 'gs-sheet-label' }, 'Your team'));
      body.appendChild(GS.el('div', { class: 'gs-row' }, choice('Team A', seat.team === 'A', function () { seatPost({ team: 'A' }); }),
        choice('Team B', seat.team === 'B', function () { seatPost({ team: 'B' }); })));
    }
    body.appendChild(GS.el('div', { class: 'gs-sheet-label' }, 'Show me as'));
    body.appendChild(GS.el('div', { class: 'gs-row' },
      choice('🙂 Avatar', seat.presenceKind === 'avatar', function () { seatPost({ presenceKind: 'avatar' }); }),
      choice('📷 Camera', seat.presenceKind === 'camera', function () { seatPost({ presenceKind: 'camera' }); }),
      choice('🔇 Name only', seat.presenceKind === 'off', function () { seatPost({ presenceKind: 'off' }); })));
    return body;
  }

  // ── the sheet frame ───────────────────────────────────────────────────────
  var KINDS = {
    help: { title: 'How to play', body: function () { return GS.helpContent(GS.roomId ? showId() : null); } },
    you: { title: 'You', body: youBody },
    confirm: { title: '', body: null },
    custom: { title: '', body: null },
  };

  function paint() {
    var l = host();
    l.innerHTML = '';
    if (!open) return;
    var kind = KINDS[open.kind];
    var body = open.kind === 'confirm' ? confirmBody(open) : open.kind === 'custom' ? open.body() : kind.body();
    var title = open.kind === 'confirm' || open.kind === 'custom' ? open.title : kind.title;
    l.appendChild(GS.el('div', { class: 'gs-scrim', onclick: close }));
    l.appendChild(GS.el('div', { class: 'gs-sheet' + (open.full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-ds-sheet': open.kind },
      GS.el('div', { class: 'gs-sheet-head' }, GS.el('h2', {}, title),
        GS.el('button', { type: 'button', class: 'gs-sheet-done', onclick: close }, open.kind === 'confirm' ? 'Cancel' : 'Done')),
      GS.el('div', { class: 'gs-sheet-body' }, body)));
  }
  function confirmBody(spec) {
    return GS.el('div', { class: 'gs-col' }, GS.el('p', {}, spec.text),
      GS.el('div', { class: 'gs-row' },
        GS.el('button', { type: 'button', class: 'gs-btn primary', onclick: function () { close(); spec.yes(); } }, spec.yesLabel),
        GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: close }, 'Stay in this game')));
  }
  function close() { open = null; paint(); }

  GS.sheets = {
    /** @description Open Help or You over the game. @param {string} kind - help|you. @returns {void} */
    open: function (kind) { moreOpen = false; open = { kind: kind }; paint(); if (GS.render) GS.render(); },
    /** @description Ask before an action that leaves the game. @param {{title:string,text:string,yesLabel:string,yes:Function}} spec - The question. @returns {void} */
    confirm: function (spec) { moreOpen = false; open = Object.assign({ kind: 'confirm' }, spec); paint(); if (GS.render) GS.render(); },
    /**
     * @description A full sheet with its own body (the Host Desk's Show setup). It is repainted only on refresh(),
     *   never by a poll, so a field being typed in keeps its focus.
     * @param {{title:string, body:Function, full:boolean}} spec - Title and body builder.
     * @returns {void}
     */
    custom: function (spec) { moreOpen = false; open = Object.assign({ kind: 'custom' }, spec); paint(); },
    /** @description Repaint the open sheet (after an action changed what it shows). @returns {void} */
    refresh: function () { if (open) paint(); },
    close: close,
    /** @description Which sheet is open, if any. @returns {?string} The kind. */
    current: function () { return open ? open.kind : null; },
    /** @description Keep the You sheet in step with the seat after a poll. @returns {void} */
    sync: function () { if (open && open.kind === 'you') paint(); },
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (open) close();
    else if (moreOpen) { moreOpen = false; if (GS.render) GS.render(); }
  });

  /** @description The 44px ? icon: the rules as a sheet over the game, with no reload. @returns {HTMLElement} The button. */
  GS.helpButton = function () {
    return GS.el('button', { type: 'button', class: 'gs-icon', 'aria-label': 'How to play', title: 'How to play', onclick: function () { GS.sheets.open('help'); } }, '?');
  };

  /**
   * @description The header's ⋯ More menu; its open state lives here so a re-render keeps it open.
   * @param {Array<{label:string, act:Function}>} items - The menu rows.
   * @returns {?HTMLElement} The menu node, or null with no rows.
   */
  GS.moreMenu = function (items) {
    if (!items.length) return null;
    var menu = GS.el('div', { class: 'gs-more' },
      GS.el('button', { type: 'button', class: 'gs-icon', 'aria-label': 'More', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': moreOpen ? 'true' : 'false',
        onclick: function () { moreOpen = !moreOpen; if (GS.render) GS.render(); } }, '⋯'));
    if (moreOpen) {
      var list = GS.el('div', { class: 'gs-more-menu', role: 'menu' });
      items.forEach(function (it) {
        list.appendChild(GS.el('button', { type: 'button', role: 'menuitem', onclick: function () { moreOpen = false; it.act(); if (GS.render) GS.render(); } }, it.label));
      });
      menu.appendChild(list);
    }
    return menu;
  };
  document.addEventListener('pointerdown', function (e) {
    if (moreOpen && !(e.target.closest && e.target.closest('.gs-more'))) { moreOpen = false; if (GS.render) GS.render(); }
  });

  /** @description The stage's New game row: leaving a running room asks first, in the page. @returns {{label:string, act:Function}} The row. */
  GS.newGameItem = function () {
    return { label: 'New game', act: function () {
      GS.sheets.confirm({ title: 'Start a new game?', yesLabel: 'Pick a new game',
        text: 'You leave this game for the game picker. It stays in Your open games, so you can resume it or end it there.',
        yes: function () { window.location.search = '?view=stage&lobby=1'; } });
    } };
  };
})();
