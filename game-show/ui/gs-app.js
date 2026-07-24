/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Surface bootstrap: resolve the room (explicit ?room, deep-link ?join, or the caller's most recent room), load state, start the sync poll, and hand off to the view renderer.
 */

/* global window, document */
(function () {
  'use strict';
  var GS = window.GS;

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
    if (GS.joinCode) { if (GS.render) GS.render(); return; }   // deep-link: lobby prefilled with the code
    GS.api.get('/rooms').then(function (r) {
      var rooms = (r.body && r.body.rooms) || [];
      if (rooms.length) GS.boot(rooms[0].roomId);
      else if (GS.render) GS.render();
    }).catch(function () { if (GS.render) GS.render(); });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
