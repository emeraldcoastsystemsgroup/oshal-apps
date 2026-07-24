/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Game Show surface core: the API client, the shared client store, the rev-based sync poll (with per-seat presence-frame busting), fire-and-forget host TTS for speaker surfaces, DOM helpers, and the action/answer/host senders. One synced state; every surface renders it.
 */

/* global window, document, navigator */
(function () {
  'use strict';

  var BASE = '/api/game-show';
  var qs = new URLSearchParams(window.location.search);

  var GS = window.GS = {
    base: BASE,
    view: (qs.get('view') || 'stage').toLowerCase(),   // stage | tv | clicker | host | audience | help
    joinCode: (qs.get('join') || '').toUpperCase(),
    roomId: qs.get('room') || null,
    // shared store (one synced state, every surface renders it)
    room: null, seats: [], state: {}, rev: 0, seq: 0, scoreboard: [], events: [], show: null,
    presenceRev: {}, camBust: {}, lastHostAt: 0, render: null, _timer: null,
    skew: 0,          // serverNow - browserNow, so every surface counts down to the SAME deadline
    shows: [],        // catalog from /shows, for the lobby picker
    actAs: null,      // hotseat: the host may drive any podium (seatId) instead of their own
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────
  GS.el = function (tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key.slice(0, 2) === 'on' && typeof attrs[key] === 'function') node.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] != null && attrs[key] !== false) node.setAttribute(key, attrs[key]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    }
    return node;
  };
  GS.root = function () { return document.getElementById('gs-root'); };
  GS.mount = function (node) { var r = GS.root(); r.innerHTML = ''; r.appendChild(node); };
  GS.toast = function (msg) {
    var t = GS.el('div', { class: 'gs-float', style: 'left:50%;bottom:22vh;transform:translateX(-50%);background:rgba(0,0,0,.7);padding:8px 14px;border-radius:10px;font-size:15px' }, msg);
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2400);
  };

  // ── API client ──────────────────────────────────────────────────────────
  function handle(res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); }
  GS.api = {
    get: function (path) { return fetch(BASE + path, { credentials: 'same-origin' }).then(handle); },
    post: function (path, body) {
      return fetch(BASE + path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
      }).then(handle);
    },
    postBytes: function (path, blob, mime) {
      return fetch(BASE + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': mime || 'image/jpeg' }, body: blob }).then(handle);
    },
  };

  // ── Selectors ─────────────────────────────────────────────────────────────
  GS.mySeat = function () { return GS.seats.filter(function (s) { return s.me; })[0] || null; };
  GS.isOwner = function () { return !!(GS.room && GS.room.isOwner); };
  GS.isSpeaker = function () { return GS.view === 'tv' || GS.view === 'host'; };
  GS.teamSeats = function (team) { return GS.seats.filter(function (s) { return s.team === team && s.role !== 'host'; }); };
  GS.players = function () { return GS.seats.filter(function (s) { return s.role !== 'host'; }); };
  GS.presenceUrl = function (seat) {
    return BASE + '/presence/' + GS.roomId + '/' + seat.seatId + '.jpg?v=' + (GS.camBust[seat.seatId] || 0);
  };

  // ── Host voice (fire-and-forget on speaker surfaces only) ─────────────────
  GS.speak = function (line) {
    if (!line || !GS.isSpeaker()) return;
    GS.api.post('/tts', { text: line.slice(0, 900) }).then(function (r) {
      if (!r.body || !r.body.ok || !r.body.audio) return;   // caption-only when unavailable — never a robot voice
      var audio = document.getElementById('gs-audio');
      audio.src = 'data:' + (r.body.mime || 'audio/mpeg') + ';base64,' + r.body.audio;
      audio.play().catch(function () {});
    }).catch(function () {});
  };

  // ── Senders ───────────────────────────────────────────────────────────────
  function apply(result) {
    if (!result.body) return result;
    if (result.body.ok === false) { GS.toast(result.body.error || 'Not allowed.'); return result; }
    if (typeof result.body.rev === 'number') GS.rev = result.body.rev;
    if (result.body.state) GS.state = result.body.state;
    GS.poll();   // pull seats/scoreboard/events right away
    return result;
  }
  GS.act = function (action, actorSeatId) { return GS.api.post('/action', { roomId: GS.roomId, action: action, actorSeatId: actorSeatId }).then(apply); };
  GS.answer = function (guess, actorSeatId) { return GS.api.post('/answer', { roomId: GS.roomId, guess: guess, actorSeatId: actorSeatId }).then(apply); };
  GS.hostCmd = function (mode, payload) { return GS.api.post('/host', { roomId: GS.roomId, mode: mode, payload: payload || {} }).then(apply); };

  // ── Sync ────────────────────────────────────────────────────────────────
  GS.ingest = function (data) {
    var changed = false;
    // The round clock is a server deadline. Re-measure the offset every poll so a
    // device with a wrong clock still shows the same countdown as the big screen.
    if (typeof data.now === 'number') GS.skew = data.now - Date.now();
    if (Array.isArray(data.seats)) {
      data.seats.forEach(function (seat) {
        if (GS.presenceRev[seat.seatId] !== seat.presenceRev) { GS.presenceRev[seat.seatId] = seat.presenceRev; GS.camBust[seat.seatId] = seat.presenceRev; changed = true; }
      });
      if (data.seats.length !== GS.seats.length) changed = true;
      GS.seats = data.seats;
    }
    if (data.changed && data.state) { GS.state = data.state; GS.rev = data.rev; changed = true; }
    else if (typeof data.rev === 'number') GS.rev = data.rev;
    if (Array.isArray(data.scoreboard) && data.scoreboard.length) GS.scoreboard = data.scoreboard;
    if (Array.isArray(data.events) && data.events.length) {
      GS.events = GS.events.concat(data.events);
      GS.seq = data.events[data.events.length - 1].seq;
      changed = true;
    }
    if (data.status && GS.room) GS.room.status = data.status;
    var host = GS.state && GS.state.host;
    if (host && host.at && host.at > GS.lastHostAt) { GS.lastHostAt = host.at; GS.speak(host.line); }
    return changed;
  };

  GS.poll = function () {
    if (!GS.roomId) return Promise.resolve();
    return GS.api.get('/sync?roomId=' + GS.roomId + '&rev=' + GS.rev + '&seq=' + GS.seq).then(function (r) {
      if (!r.body || r.body.ok === false) return;
      if (GS.ingest(r.body) && typeof GS.render === 'function') GS.render();
    }).catch(function () {});
  };

  GS.loadState = function (roomId) {
    GS.roomId = roomId;
    return GS.api.get('/state?roomId=' + roomId).then(function (r) {
      if (!r.body || r.body.ok === false) return r;
      if (typeof r.body.now === 'number') GS.skew = r.body.now - Date.now();
      GS.room = r.body.room; GS.state = r.body.state || {}; GS.rev = r.body.rev || 0;
      GS.seats = r.body.seats || []; GS.scoreboard = r.body.scoreboard || [];
      GS.events = r.body.events || []; GS.show = r.body.show || null;
      GS.seq = GS.events.length ? GS.events[GS.events.length - 1].seq : 0;
      GS.seats.forEach(function (s) { GS.presenceRev[s.seatId] = s.presenceRev; GS.camBust[s.seatId] = s.presenceRev; });
      if (GS.state.host && GS.state.host.at) GS.lastHostAt = GS.state.host.at;
      return r;
    });
  };

  GS.startSync = function () {
    if (GS._timer) clearInterval(GS._timer);
    var cadence = GS.view === 'tv' ? 1000 : 1400;
    GS._timer = setInterval(GS.poll, cadence);
  };
})();
