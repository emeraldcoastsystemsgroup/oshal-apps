/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:06:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Presence: the swappable "video-frame module" for a podium. Renders a seat as a live camera still, an avatar, or a nameplate — the player's call — and captures a camera frame every ~2s on the device that owns the seat. The motion-avatar (e.g. shark overlay) is a future module that slots into tile() unchanged.
 */

/* global window, document, navigator */
(function () {
  'use strict';
  var GS = window.GS;
  var AVATARS = ['😀', '😎', '🤠', '🦈', '👽', '🐯', '🦄', '🤖', '🐼', '🦁', '🐸', '👑', '🐙', '🐝', '🦊', '🐧'];

  /** @description Pick a stable avatar glyph for a seat (explicit choice wins). */
  function avatarFor(seat) {
    if (seat.avatarId) return seat.avatarId;
    var hash = 0, id = seat.seatId || '';
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return AVATARS[hash % AVATARS.length];
  }

  /** @description Render one podium's presence tile (camera | avatar | off). */
  function tile(seat) {
    var buzz = GS.state.buzz || {};
    var faceoff = (GS.state.board && GS.state.board.faceoff) || {};
    var cls = 'gs-tile';
    if (seat.team === 'A') cls += ' teamA'; else if (seat.team === 'B') cls += ' teamB';
    if (buzz.lockedBy === seat.seatId) cls += ' buzzed';
    if (faceoff.firstSeat === seat.seatId || faceoff.secondSeat === seat.seatId) cls += ' active';
    var inner;
    if (seat.presenceKind === 'camera') {
      inner = GS.el('img', { src: GS.presenceUrl(seat), alt: seat.name });
      inner.addEventListener('error', function () { inner.replaceWith(GS.el('div', { class: 'avatar' }, avatarFor(seat))); });
    } else if (seat.presenceKind === 'off') {
      inner = GS.el('div', { class: 'avatar', style: 'font-size:22px;padding:6px' }, (seat.name || '?').slice(0, 12));
    } else {
      inner = GS.el('div', { class: 'avatar' }, avatarFor(seat));
    }
    var node = GS.el('div', { class: cls }, inner);
    if (buzz.lockedBy === seat.seatId) node.appendChild(GS.el('div', { class: 'badge' }, 'BUZZ'));
    return node;
  }

  /** @description Render a podium (tile + name + team/score). */
  function podium(seat) {
    return GS.el('div', { class: 'gs-podium' },
      tile(seat),
      GS.el('div', { class: 'plabel' }, seat.name + (seat.me ? ' (you)' : '')),
      GS.el('div', { class: 'pscore' }, seat.team ? ('Team ' + seat.team) : (seat.role === 'host' ? 'Host' : '')));
  }

  /** @description Render the whole podium strip, optionally with a cutaway animation class. */
  function strip(extraClass) {
    var wrap = GS.el('div', { class: 'gs-podiums' + (extraClass ? (' ' + extraClass) : '') });
    var players = GS.players();
    if (!players.length) { wrap.appendChild(GS.el('div', { class: 'gs-muted' }, 'No podiums yet — players join from their phones.')); return wrap; }
    players.forEach(function (s) { wrap.appendChild(podium(s)); });
    return wrap;
  }

  // ── Camera capture (only on the device that owns the seat + a controller view) ──
  var camTimer = null, camStream = null, camWarned = false;

  /** @description Start/stop the camera based on my seat's presence choice and view. */
  function syncCamera() {
    var seat = GS.mySeat();
    var want = seat && seat.presenceKind === 'camera' && ['stage', 'clicker', 'host'].indexOf(GS.view) >= 0;
    if (want && !camTimer) startCam(seat);
    if (!want && camTimer) stopCam();
  }

  function startCam(seat) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 320 }, audio: false }).then(function (stream) {
      camStream = stream;
      var video = document.getElementById('gs-cam');
      video.srcObject = stream; video.play().catch(function () {});
      camTimer = setInterval(function () { capture(seat.seatId); }, 2200);
    }).catch(function () { if (!camWarned) { camWarned = true; GS.toast('Camera blocked — showing an avatar.'); } });
  }

  function stopCam() {
    if (camTimer) { clearInterval(camTimer); camTimer = null; }
    if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
  }

  function capture(seatId) {
    var video = document.getElementById('gs-cam'), canvas = document.getElementById('gs-canvas');
    if (!video.videoWidth) return;
    var ctx = canvas.getContext('2d');
    var side = Math.min(video.videoWidth, video.videoHeight);
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(function (blob) {
      if (blob) GS.api.postBytes('/presence?roomId=' + GS.roomId + '&seatId=' + seatId, blob, 'image/jpeg');
    }, 'image/jpeg', 0.7);
  }

  GS.presence = { AVATARS: AVATARS, avatarFor: avatarFor, tile: tile, podium: podium, strip: strip, syncCamera: syncCamera };
})();
