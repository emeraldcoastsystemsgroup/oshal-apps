/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 02:20:00 | codex                                      | Add a reusable TV cutaway player that prefers pre-rendered MP4 clips and always retains a reduced-motion-aware local animation fallback.
 */

/* global window, document */
(function () {
  'use strict';

  var GS = window.GS;
  var ITEMS = [
    { id: 'show-open', label: 'Tonight in the studio', durationMs: 3200 },
    { id: 'buzzer-race', label: 'Ready on the buzzers', durationMs: 2600 },
    { id: 'team-huddle', label: 'Team huddle', durationMs: 3000 },
    { id: 'interview', label: 'On the spot', durationMs: 2600 },
    { id: 'strike', label: 'Strike', durationMs: 1800 },
    { id: 'celebration', label: 'Round winner', durationMs: 4200 },
  ];
  var available = {};
  var lastSignature = null;
  var closeTimer = null;

  function item(id) {
    return ITEMS.filter(function (entry) { return entry.id === id; })[0] || null;
  }

  function select(state) {
    var current = state || {};
    var phase = String(current.phase || '');
    var shot = String((current.shot && current.shot.type) || '');
    if (phase === 'strike') return 'strike';
    if (shot === 'buzzer-race') return 'buzzer-race';
    if (shot === 'team-huddle') return 'team-huddle';
    if (shot === 'interview') return 'interview';
    if (shot === 'celebration') return 'celebration';
    if (shot === 'lobby' || (shot === 'audience-pan' && phase === 'intro')) return 'show-open';
    return null;
  }

  function close(node) {
    if (!node || !node.parentNode) return;
    node.classList.add('leaving');
    setTimeout(function () { if (node.parentNode) node.remove(); }, 260);
  }

  function fallback(entry) {
    var scene = GS.el('div', { class: 'gs-cutaway-fallback', 'aria-hidden': 'true' });
    scene.appendChild(GS.el('i', { class: 'gs-cutaway-orbit one' }));
    scene.appendChild(GS.el('i', { class: 'gs-cutaway-orbit two' }));
    scene.appendChild(GS.el('i', { class: 'gs-cutaway-beam left' }));
    scene.appendChild(GS.el('i', { class: 'gs-cutaway-beam right' }));
    for (var i = 0; i < 12; i++) {
      var spark = GS.el('i', { class: 'gs-cutaway-spark' });
      spark.style.setProperty('--i', i);
      scene.appendChild(spark);
    }
    scene.appendChild(GS.el('div', { class: 'gs-cutaway-title' },
      GS.el('small', {}, 'GAME SHOW'),
      GS.el('strong', {}, entry.label)));
    return scene;
  }

  function play(id, signature) {
    var entry = item(id);
    if (!entry) return;
    var previous = document.querySelector('.gs-cutaway');
    if (previous) previous.remove();
    if (closeTimer) clearTimeout(closeTimer);

    var overlay = GS.el('div', {
      class: 'gs-cutaway gs-cutaway-' + id,
      role: 'status',
      'aria-label': entry.label,
      'data-signature': signature || 'preview',
    });
    overlay.appendChild(fallback(entry));
    if (available[id]) {
      var video = GS.el('video', {
        class: 'gs-cutaway-video', src: available[id], autoplay: '', muted: '',
        playsinline: '', preload: 'auto', 'aria-hidden': 'true',
      });
      video.muted = true;
      video.addEventListener('ended', function () { close(overlay); });
      video.addEventListener('error', function () { video.remove(); });
      overlay.insertBefore(video, overlay.firstChild);
      video.play().catch(function () { video.remove(); });
    }
    document.body.appendChild(overlay);
    closeTimer = setTimeout(function () { close(overlay); }, available[id] ? 8000 : entry.durationMs);
  }

  function sync(state) {
    var id = select(state);
    if (!id) return;
    var shot = (state && state.shot) || {};
    var signature = [id, Number(shot.serial) || 0, String(state.phase || '')].join(':');
    if (signature === lastSignature) return;
    lastSignature = signature;
    play(id, signature);
  }

  GS.cutaways = {
    items: ITEMS.slice(),
    select: select,
    sync: sync,
    preview: function (id) { play(id, 'preview:' + Date.now()); },
  };

  GS.api.get('/cutaways/catalog').then(function (response) {
    var rows = (response.body && response.body.items) || [];
    rows.forEach(function (entry) {
      if (entry.available && item(entry.id)) available[entry.id] = entry.src;
    });
  }).catch(function () {});
})();
