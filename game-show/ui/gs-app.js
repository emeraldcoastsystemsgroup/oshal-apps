/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Surface bootstrap: resolve the room (explicit ?room, deep-link ?join, or the caller's most recent room), load state, start the sync poll, and hand off to the view renderer.
 * 2026-07-25 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | ?lobby=1 skips the resume-last-room boot. The auto-resume made the lobby (and its show picker) unreachable once you had ever hosted a game — there was no way to start a NEW show without ending the old room from psql.
 * 2026-07-26 [rebuild] | roger.murphy@emeraldcoastsystemsgroup.com  | ?join=CODE now finishes the gesture: the QR/link auto-joins and seats you (the audit counted the one tap the deep link existed to remove); a failed auto-join falls back to the prefilled lobby. Plus a global-error recovery toast so one bad render can never leave a dead screen.
 */

/* global window, document */
(function () {
  'use strict';
  var GS = window.GS;

  // One bad frame must never kill the show — surface it and keep polling.
  window.addEventListener('error', function () {
    if (document.getElementById('gs-recover')) return;
    var bar = GS.el('div', { id: 'gs-recover', class: 'gs-float', style: 'left:50%;top:14px;transform:translateX(-50%);background:rgba(127,29,29,.9);padding:8px 14px;border-radius:10px' },
      'Something hiccuped — tap to refresh.');
    bar.style.pointerEvents = 'auto'; bar.style.cursor = 'pointer'; bar.style.animation = 'none';
    bar.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(bar);
    setTimeout(function () { bar.remove(); }, 8000);
  });

  /** @description Load a room's full state, start syncing, and render — or fall back to the lobby. */
  GS.boot = function (roomId) {
    return GS.loadState(roomId).then(function (r) {
      if (r && r.body && r.body.ok === false) { GS.roomId = null; if (GS.render) GS.render(); return; }
      GS.startSync();
      if (GS.render) GS.render();
    }).catch(function () { GS.roomId = null; if (GS.render) GS.render(); });
  };

  /** @description Decide which room to open on load, then boot or show the lobby. */
  function start() {
    // Load the show catalog so the lobby picker lists whatever the server registers.
    GS.api.get('/shows').then(function (r) {
      if (r.body && r.body.shows) { GS.shows = r.body.shows; if (!GS.roomId && GS.render) GS.render(); }
    }).catch(function () {});
    if (GS.roomId) { GS.boot(GS.roomId); return; }
    if (GS.joinCode) {
      // The QR/link IS the join gesture — finish it. A failure (bad code, ended
      // room) falls back to the lobby with the code prefilled, exactly as before.
      GS.api.post('/join', { code: GS.joinCode }).then(function (r) {
        if (r.body && r.body.ok) { GS.joinCode = ''; GS.boot(r.body.roomId); }
        else if (GS.render) GS.render();
      }).catch(function () { if (GS.render) GS.render(); });
      return;
    }
    if (GS.wantLobby) { if (GS.render) GS.render(); return; }  // explicit lobby: pick a show / resume from the list
    GS.api.get('/rooms').then(function (r) {
      var rooms = (r.body && r.body.rooms) || [];
      if (rooms.length) GS.boot(rooms[0].roomId);
      else if (GS.render) GS.render();
    }).catch(function () { if (GS.render) GS.render(); });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
