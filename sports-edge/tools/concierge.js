/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Collapsible right-rail Sports Quant Concierge client (F22/F24): surface-bridge context publishing, quick prompt chips, voice/TTS composer controls, inline sports-quant bot requests, and approval-card presentation for confirm-gated actions.
 */
(function initSportsQuantConcierge() {
  'use strict';

  if (window.AppView && typeof window.AppView.active === 'function' && window.AppView.active()) return;

  var BOT_NAME = 'sports-quant';
  var APP_ID = 'sports-edge';
  var APP_LABEL = 'Sports Edge';
  var rail = document.getElementById('conciergeRail');
  var toggleBtn = document.getElementById('conciergeToggle');
  var closeBtn = document.getElementById('conciergeClose');
  var logEl = document.getElementById('conciergeLog');
  var formEl = document.getElementById('conciergeForm');
  var inputEl = document.getElementById('conciergeInput');
  var sendBtn = document.getElementById('conciergeSend');
  var attachBtn = document.getElementById('conciergeAttach');
  var speakerBtn = document.getElementById('conciergeSpeaker');
  var micBtn = document.getElementById('conciergeMic');
  var noticeEl = document.getElementById('conciergeNotice');
  var contextRow = document.getElementById('conciergeContextRow');
  if (!rail || !toggleBtn || !logEl || !formEl || !inputEl) return;

  var sessionId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('se-' + Date.now());
  var busy = false;
  var lastReply = '';
  var attachBoardSnapshot = false;
  var mediaRecorder = null;
  var bridgeClient = null;

  function setOpen(open) {
    document.body.setAttribute('data-concierge', open ? 'open' : 'closed');
    toggleBtn.setAttribute('aria-expanded', String(Boolean(open)));
    if (open) setTimeout(function () { inputEl.focus(); }, 30);
  }

  function currentBoardContext() {
    var activeTabBtn = document.querySelector('nav button[aria-selected="true"]');
    var activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'games';
    var st = window.state || {};
    var followed = Array.isArray(st.followed) ? st.followed.map(function (f) { return f.league + ':' + f.team; }) : [];
    return {
      app: APP_ID,
      activeTab: activeTab,
      followedTeams: followed,
      currentEventId: st.currentEvent || null,
      upcomingGamesCount: Array.isArray(st.games) ? st.games.length : 0,
    };
  }

  function publishBridgeContext() {
    if (!bridgeClient || typeof bridgeClient.emitContext !== 'function') return;
    try { bridgeClient.emitContext(currentBoardContext()); } catch (_e) { /* standalone */ }
  }

  function connectSurfaceBridge() {
    import('/shared/ui/js/surface-bridge-client.js').then(function (mod) {
      if (!mod || typeof mod.createSurfaceBridgeClient !== 'function') return;
      bridgeClient = mod.createSurfaceBridgeClient({ app: APP_ID });
      if (typeof bridgeClient.attach === 'function') bridgeClient.attach();
      publishBridgeContext();
    }).catch(function () { /* standalone mode */ });
  }

  function authHeaders(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    try {
      var tok = window.sessionStorage.getItem('oshal.token');
      if (tok) h.Authorization = 'Bearer ' + tok;
    } catch (_e) { /* sandboxed storage */ }
    return h;
  }

  function requestJson(method, url, body, extraHeaders) {
    var opts = { method: method, credentials: 'same-origin', headers: authHeaders(extraHeaders) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) {
        var parsed = {};
        try { parsed = txt ? JSON.parse(txt) : {}; } catch (_e) { parsed = { error: txt || ('HTTP ' + r.status) }; }
        if (!r.ok) throw new Error(parsed.message || parsed.reason || parsed.error || ('HTTP ' + r.status));
        return parsed;
      });
    });
  }

  function appendMessage(text, isUser) {
    var art = document.createElement('article');
    art.className = 'concierge-msg ' + (isUser ? 'concierge-user' : 'concierge-reply');
    var who = document.createElement('span');
    who.className = 'concierge-speaker';
    who.textContent = isUser ? 'You' : 'Sports Quant';
    var p = document.createElement('p');
    p.textContent = text;
    art.appendChild(who);
    art.appendChild(p);
    logEl.appendChild(art);
    logEl.scrollTop = logEl.scrollHeight;
    return art;
  }

  function refreshHostBoard() {
    try {
      if (typeof window.loadGames === 'function' && !document.getElementById('tab-games').hidden) window.loadGames();
      if (typeof window.loadRecord === 'function' && !document.getElementById('tab-record').hidden) window.loadRecord();
    } catch (_e) { /* host refresh optional */ }
  }

  function renderFallbackCard(proposal, host) {
    var card = document.createElement('section');
    card.className = 'concierge-approval-card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Action requiring your approval');
    var title = document.createElement('h3');
    title.className = 'concierge-approval-title';
    title.textContent = APP_LABEL + ' · ' + String(proposal.tool || 'record_pick').replace(/_/g, ' ');
    var desc = document.createElement('p');
    desc.className = 'concierge-approval-desc';
    desc.textContent = proposal.description || ('Confirm ' + JSON.stringify(proposal.arguments || {}));
    var actions = document.createElement('div');
    actions.className = 'concierge-approval-actions';
    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'concierge-approve-btn';
    okBtn.textContent = 'Approve';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'concierge-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    var statusLine = document.createElement('p');
    statusLine.className = 'concierge-notice';
    function settle(kind) {
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      var path = '/api/jarvis/package-tools/' + kind;
      requestJson('POST', path, { proposalId: proposal.id }, { 'x-oshal-package-tool': '1' }).then(function () {
        statusLine.textContent = kind === 'execute' ? 'Approved and recorded.' : 'Cancelled.';
        window.dispatchEvent(new CustomEvent('oshal-package-tool-done', { detail: { proposalId: proposal.id, outcome: kind } }));
        if (kind === 'execute') refreshHostBoard();
      }).catch(function (err) {
        statusLine.textContent = err.message || 'Could not complete approval.';
        okBtn.disabled = false;
        cancelBtn.disabled = false;
      });
    }
    okBtn.addEventListener('click', function () { settle('execute'); });
    cancelBtn.addEventListener('click', function () { settle('decline'); });
    actions.appendChild(okBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    card.appendChild(statusLine);
    host.appendChild(card);
  }

  function resolveProposal(ref) {
    if (ref && typeof ref === 'object' && ref.tool && ref.id) return Promise.resolve(ref);
    var id = typeof ref === 'string' ? ref : (ref && (ref.id || ref.proposalId));
    if (!id) return Promise.resolve(null);
    return requestJson('GET', '/api/jarvis/package-tools/proposals/' + encodeURIComponent(id))
      .then(function (r) { return r.proposal || r; });
  }

  function presentProposals(result) {
    var refs = (Array.isArray(result.packageToolProposals) ? result.packageToolProposals : [result.packageToolProposal]).filter(Boolean);
    if (!refs.length) return Promise.resolve(0);
    return Promise.all(refs.slice(0, 5).map(resolveProposal)).then(function (items) {
      var proposals = items.filter(Boolean);
      if (!proposals.length) return 0;
      var host = document.createElement('div');
      logEl.appendChild(host);
      if (typeof window.oshalPresentPackageTools === 'function') {
        window.oshalPresentPackageTools({ packageToolProposals: proposals }, host, { appName: APP_LABEL });
      } else {
        proposals.forEach(function (p) { renderFallbackCard(p, host); });
      }
      logEl.scrollTop = logEl.scrollHeight;
      return proposals.length;
    });
  }

  function renderContextChip() {
    contextRow.innerHTML = '';
    if (!attachBoardSnapshot) return;
    var ctx = currentBoardContext();
    var pill = document.createElement('span');
    pill.className = 'concierge-context-pill';
    pill.textContent = 'Board: ' + ctx.activeTab + (ctx.followedTeams.length ? (' (' + ctx.followedTeams.join(', ') + ')') : '');
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove attached board context');
    rm.textContent = '×';
    rm.addEventListener('click', function () { attachBoardSnapshot = false; renderContextChip(); });
    pill.appendChild(rm);
    contextRow.appendChild(pill);
  }

  function updateControls() {
    sendBtn.disabled = busy;
    if (speakerBtn) speakerBtn.disabled = !lastReply;
  }

  function sendPrompt(rawText) {
    var message = String(rawText || '').trim();
    if (!message || busy) return;
    setOpen(true);
    busy = true;
    updateControls();
    var ctx = currentBoardContext();
    var outgoing = attachBoardSnapshot ? (message + '\nActive Sports Edge context: ' + JSON.stringify(ctx)) : message;
    appendMessage(message, true);
    inputEl.value = '';
    noticeEl.textContent = 'Sports Quant is checking lines and ledger…';
    requestJson('POST', '/api/swarm/bots/' + BOT_NAME + '/ask', {
      message: outgoing, context: ctx, sessionId: sessionId,
    }).then(function (res) {
      if (typeof res.sessionId === 'string') sessionId = res.sessionId;
      lastReply = String(res.reply || res.answer || '').trim();
      appendMessage(lastReply || 'Review the proposed action below.', false);
      return presentProposals(res);
    }).then(function (cardCount) {
      noticeEl.textContent = cardCount ? 'Review and approve or cancel the action above.' : '';
      attachBoardSnapshot = false;
      renderContextChip();
    }).catch(function (err) {
      noticeEl.textContent = err.message || 'Sports Quant could not complete that request.';
    }).then(function () {
      busy = false;
      updateControls();
    });
  }

  function toggleSpeech() {
    if (!lastReply || !window.speechSynthesis) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      speakerBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    var u = new SpeechSynthesisUtterance(lastReply);
    u.onend = function () { speakerBtn.setAttribute('aria-pressed', 'false'); };
    speakerBtn.setAttribute('aria-pressed', 'true');
    window.speechSynthesis.speak(u);
  }

  function toggleMic() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      noticeEl.textContent = 'Voice input is unavailable in this browser.';
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      micBtn.setAttribute('aria-pressed', 'true');
      noticeEl.textContent = 'Listening… click mic again to transcribe.';
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = function () {
        micBtn.setAttribute('aria-pressed', 'false');
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        var reader = new FileReader();
        reader.onloadend = function () {
          var b64 = String(reader.result || '').split(',')[1] || '';
          requestJson('POST', '/api/voice/transcribe', { audio: b64, mimeType: blob.type }).then(function (r) {
            if (r && r.text) inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + r.text.trim();
            noticeEl.textContent = '';
          }).catch(function (err) { noticeEl.textContent = err.message || 'Voice transcription unavailable.'; });
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
    }).catch(function () { noticeEl.textContent = 'Microphone permission was not granted.'; });
  }

  document.body.classList.add('has-concierge');
  setOpen(window.innerWidth >= 960);

  toggleBtn.addEventListener('click', function () {
    setOpen(document.body.getAttribute('data-concierge') !== 'open');
  });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  if (attachBtn) attachBtn.addEventListener('click', function () {
    attachBoardSnapshot = !attachBoardSnapshot;
    renderContextChip();
  });
  if (speakerBtn) speakerBtn.addEventListener('click', toggleSpeech);
  if (micBtn) micBtn.addEventListener('click', toggleMic);

  Array.prototype.forEach.call(rail.querySelectorAll('[data-concierge-prompt]'), function (chip) {
    chip.addEventListener('click', function () { sendPrompt(chip.getAttribute('data-concierge-prompt')); });
  });

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    sendPrompt(inputEl.value);
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendPrompt(inputEl.value);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {
    b.addEventListener('click', function () { setTimeout(publishBridgeContext, 20); });
  });
  window.addEventListener('oshal-package-tool-done', refreshHostBoard);
  updateControls();
  connectSurfaceBridge();
})();
