/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Game Show surface core: the API client, the shared client store, the rev-based sync poll (with per-seat presence-frame busting), fire-and-forget host TTS for speaker surfaces, DOM helpers, and the action/answer/host senders. One synced state; every surface renders it.
 * 2026-07-24 14:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog burn-down: ?as=<seatId> pins a surface to a hotseat podium (the rehearsal view's clickers; owner-only server-side); exactly ONE device per room synthesizes TTS (lease claimed on the poll, lines queue instead of overlapping — #8); incoming 'react' events invoke GS.onReact so every surface shows the room's reactions (#16).
 * 2026-07-25 23:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | GS.wantLobby (?lobby=1) so the bootstrap can skip the resume-last-room path and show the lobby's show picker on demand.
 * 2026-07-26 19:12:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Every incoming event is also handed to GS.onBeat (next to the GS.onReact dispatch) so the broadcast chrome can score reveals/strikes/wins as sound cues.
 */

/* global window, document, navigator */
(function () {
  'use strict';

  var BASE = '/api/game-show';
  var qs = new URLSearchParams(window.location.search);

  var GS = window.GS = {
    base: BASE,
    view: (qs.get('view') || 'stage').toLowerCase(),   // stage | tv | clicker | host | audience | help
    explicitView: qs.has('view'),   // a URL that names a view already made the phone-mode choice
    joinCode: (qs.get('join') || '').toUpperCase(),
    roomId: qs.get('room') || null,
    wantLobby: qs.has('lobby'),   // ?lobby=1 skips the resume-last-room boot so a new show can be picked
    // shared store (one synced state, every surface renders it)
    room: null, seats: [], state: {}, rev: 0, seq: 0, scoreboard: [], events: [], show: null,
    presenceRev: {}, camBust: {}, lastHostAt: 0, render: null, _timer: null,
    skew: 0,          // serverNow - browserNow, so every surface counts down to the SAME deadline
    shows: [],        // catalog from /shows, for the lobby picker
    // Hotseat: the host may drive any podium (seatId) instead of their own. ?as=
    // pins it for the life of the tab — the rehearsal view uses one pinned clicker
    // per house podium. The server enforces owner-only on every actorSeatId.
    actAs: qs.get('as') || null,
    deviceId: 'dev-' + Math.random().toString(36).slice(2, 10),   // per-tab identity for the speaker lease
    isVoice: false,   // whether THIS device holds the room's TTS lease
    onReact: null,    // surface hook: called with each incoming reaction event content
  };

  /** @description The podium this surface acts as (pinned hotseat first, else my seat). */
  GS.actingSeat = function () { return GS.actAs || ((GS.mySeat() || {}).seatId || null); };

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

  // ── Host voice: ONE speaker per room, lines queue instead of overlapping ──
  // Speaker surfaces claim a short-TTL lease each poll (TV outranks the host
  // desk); only the holder synthesizes. Everyone else stays caption-only.
  var ttsQueue = [], ttsPlaying = false;

  function playNextLine() {
    if (ttsPlaying || !ttsQueue.length) return;
    var line = ttsQueue.shift();
    ttsPlaying = true;
    GS.api.post('/tts', { text: line.slice(0, 900) }).then(function (r) {
      if (!r.body || !r.body.ok || !r.body.audio) { ttsPlaying = false; playNextLine(); return; }   // caption-only when unavailable — never a robot voice
      var audio = document.getElementById('gs-audio');
      audio.src = 'data:' + (r.body.mime || 'audio/mpeg') + ';base64,' + r.body.audio;
      audio.onended = function () { ttsPlaying = false; playNextLine(); };
      audio.onerror = function () { ttsPlaying = false; playNextLine(); };
      audio.play().catch(function () { ttsPlaying = false; playNextLine(); });
    }).catch(function () { ttsPlaying = false; playNextLine(); });
  }

  GS.speak = function (line) {
    if (!line || !GS.isSpeaker() || !GS.isVoice) return;
    if (ttsQueue.length >= 4) ttsQueue.shift();   // never build a backlog of stale lines
    ttsQueue.push(line);
    playNextLine();
  };

  /** @description Claim/renew this room's speaker lease (speaker surfaces only). */
  GS.claimVoice = function () {
    if (!GS.roomId || !GS.isSpeaker()) return;
    GS.api.post('/speaker', { roomId: GS.roomId, deviceId: GS.deviceId, priority: GS.view === 'tv' ? 2 : 1 })
      .then(function (r) { GS.isVoice = !!(r.body && r.body.speaker); })
      .catch(function () {});
  };

  // ── Senders ───────────────────────────────────────────────────────────────
  function apply(result) {
    if (!result.body) return result;
    if (result.body.ok === false) { GS.toast(result.body.error || 'Not allowed.'); return result; }
    if (typeof result.body.rev === 'number') GS.rev = result.body.rev;
    // Immediate local echo: the acting device re-renders NOW (your own buzz shows
    // the ✋ instantly). The poll it advances to the new rev, so the sync reports
    // changed=false and nothing else would repaint this page until the next beat —
    // found by the automated browser playthrough.
    if (result.body.state) { GS.state = result.body.state; if (typeof GS.render === 'function') GS.render(); }
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
      // Reactions are transient floats, not board state — hand them to the surface.
      if (typeof GS.onReact === 'function') {
        data.events.forEach(function (e) { if (e.kind === 'react') GS.onReact(e.content); });
      }
      // Every event is also a show beat — the broadcast chrome scores it as sfx.
      if (typeof GS.onBeat === 'function') {
        data.events.forEach(function (e) { GS.onBeat(e); });
      }
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
    GS._timer = setInterval(function () { GS.poll(); GS.claimVoice(); }, cadence);
    GS.claimVoice();
  };
})();
