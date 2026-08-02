/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The surfaces: one synced state rendered as five layouts (tv/stage/clicker/host/audience) plus lobby + help. The big screen is directed by state.shot (board, buzzer race, huddle, audience pan, celebration dance, interview); phones are the buzzer + answer; the host desk drives the show and can run hotseat podiums.
 * 2026-07-24 14:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog burn-down: per-show renderers/tables moved to the GS.showUi registry (ADR-112 collapse — this file knows no show's rules now); NEW ?view=rehearsal — every surface in ONE browser window against one room, so a full playthrough needs no TV and no phones; speak-your-answer mic on the answer box (#5); audience reactions broadcast (#16); host-desk cost chip (#15) and a play-your-own-questions panel; clickers honor ?as= hotseat pinning.
 * 2026-07-25 02:20:00 | codex                                      | Trigger reusable TV cutaways from semantic shot serials and expose host-desk previews.
 * 2026-07-25 23:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The lobby is reachable again (☰ New game header button + your-open-games list with Resume/End — auto-resume had made the show picker unreachable once a room existed), and one-person play is real: 🤖 Solo night fills the stage with AI players (skill-tiered NPC podiums, addable per-team from the host desk too).
 * 2026-07-26 19:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast shell (operator: "no set, no characters, just the inner workings"): stage and tv now render inside GS.play.frame — marquee, beams, podium characters, lower-third caption — with the stage's player controls + owner quick actions in the bottom glass dock (team/presence switching folded into a 🙂 You popover) and the tv shot branches preserved verbatim; the lobby's show <select> became clickable poster cards that host straight onto the stage; every render stamps the chrome via GS.play.sync(). Host desk, clicker, audience, and rehearsal are untouched.
 * 2026-07-26 21:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Integration pass: restore the five hooks the committed browser playthrough asserts that the rebuild dropped — the TV lobby's join QR (GS.qrNode), the host desk's 🔧 Show tools drawer (module-level open state; holds the recovery panel, hotseat, interview, cutaways), the 'AI spend $' cost text, the clicker's #gs-dock action container + 'buzzed first' status for the losing phone, and the stage dock's .gs-dockbuzz pinned buzzer bar.
 * 2026-07-31 22:50:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #11: the lobby's 🏆 Hall of fame — top end-of-game scores across YOUR ended games (GET /leaderboard over the gameshow_seats.score snapshots), best first, with the show each score was set on. Renders nothing when there is no history yet.
 */

/* global window, document, location, navigator */
(function () {
  'use strict';
  var GS = window.GS;
  var P = GS.presence;

  function ui() { return GS.activeShowUi(); }
  function canStartNow() { return ui().startPhases.indexOf(GS.state.phase || 'lobby') >= 0; }
  function isAnswerPhase() { return ui().answerPhases.indexOf(GS.state.phase) >= 0; }
  function isWagerPhase() { return ui().wagerPhases.indexOf(GS.state.phase) >= 0; }
  function showId() { return (GS.state && GS.state.showId) || (GS.show && GS.show.id) || 'family-feud'; }
  function seatName(seatId) {
    var hit = GS.seats.filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : seatId;
  }

  function scoresRow() {
    var board = GS.state.board || {};
    var row = GS.el('div', { class: 'gs-scores' });
    (GS.scoreboard || []).forEach(function (t) {
      // Team shows highlight the controlling TEAM; individual shows the controlling SEAT.
      var isControl = t.team ? board.control === t.team : board.control === t.seatId;
      row.appendChild(GS.el('div', { class: 'gs-team' + (t.team ? ' ' + t.team : '') + (isControl ? ' control' : '') },
        GS.el('div', { class: 'name' }, t.name), GS.el('div', { class: 'score' }, t.score)));
    });
    var wrap = GS.el('div', {}, row);
    if (board.bank) wrap.appendChild(GS.el('div', { class: 'gs-bank' }, 'Bank: ', GS.el('span', { class: 'n' }, board.bank * (board.multiplier || 1))));
    return wrap;
  }

  function captionBar() {
    var host = GS.state.host || {};
    return GS.el('div', { class: 'gs-caption' }, host.line ? GS.el('span', { class: 'mc' }, 'HOST') : null, host.line || '…');
  }

  function header() {
    return GS.el('div', { class: 'gs-top' },
      GS.el('div', { class: 'gs-brand' }, '★ GAME SHOW'),
      GS.el('span', { class: 'gs-chip' }, (GS.show && GS.show.title) || 'Family Feud'),
      GS.state.round ? GS.el('span', { class: 'gs-chip' }, 'Round ' + GS.state.round) : null,
      GS.controls.countdown(),
      GS.el('div', { class: 'gs-grow' }),
      // The broadcast screen stays chrome-free; every hands-on surface can always
      // get back to the lobby to pick a different show or start a new game.
      GS.view !== 'tv' && GS.roomId ? GS.el('a', { class: 'gs-btn ghost', style: 'padding:4px 10px', href: '?view=stage&lobby=1' }, '☰ New game') : null,
      GS.room ? GS.el('span', { class: 'gs-chip' }, 'Code ' + (GS.room.joinCode || '')) : null);
  }

  function confetti() {
    if (document.querySelector('.gs-confetti')) return;
    var box = GS.el('div', { class: 'gs-confetti' }), colors = ['#fbbf24', '#38bdf8', '#f472b6', '#22c55e', '#fff'];
    for (var i = 0; i < 60; i++) {
      var p = GS.el('i');
      p.style.left = (Math.random() * 100) + '%'; p.style.background = colors[i % 5];
      p.style.animationDuration = (2 + Math.random() * 2.5) + 's'; p.style.animationDelay = (Math.random() * 2) + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box); setTimeout(function () { box.remove(); }, 6000);
  }

  function needLobby() { return !GS.roomId || (!GS.mySeat() && !GS.isOwner()); }

  // ── Reactions: broadcast + render everyone's floats (#16) ─────────────────
  function floatReact(content) {
    var f = GS.el('div', { class: 'gs-float', style: 'left:' + (20 + Math.random() * 60) + '%;bottom:80px;font-size:26px' }, content);
    document.body.appendChild(f); setTimeout(function () { f.remove(); }, 2400);
  }
  GS.onReact = floatReact;

  // ── TV / big screen (directed by state.shot, framed by the broadcast set) ──
  function tv() {
    var st = GS.state, shot = (st.shot && st.shot.type) || 'board';
    if (GS.cutaways) GS.cutaways.sync(st);
    var center = GS.el('div', { class: 'gs-col' });
    var mood = '';
    if (st.phase === 'lobby') {
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'gs-center' },
        GS.el('div', { class: 'headline' }, 'JOIN CODE'),
        GS.el('div', { style: 'font-size:56px;font-weight:900;letter-spacing:8px;color:#fbbf24' }, (GS.room && GS.room.joinCode) || '------'),
        GS.qrNode ? GS.qrNode() : null,
        GS.el('p', { class: 'gs-muted' }, 'Open the Game Show app on your phone and enter this code — or scan to join'))));
    } else if (shot === 'celebration') {
      var win = st.board && st.board.winner;
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'headline' },
        win ? (GS.show && GS.show.teams ? ('TEAM ' + win + ' WINS!') : (seatName(win) + ' WINS!')) : 'ROUND OVER')));
      confetti(); center.appendChild(scoresRow()); mood = 'dance';
    } else if (shot === 'interview') {
      var iv = st.interview || {};
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'gs-center' },
        GS.el('div', { class: 'gs-question' }, iv.question || ''),
        iv.answer ? GS.el('div', { class: 'gs-caption' }, '“' + iv.answer + '”') : GS.el('p', { class: 'gs-muted' }, '…'))));
    } else if (shot === 'scoreboard') {
      center.appendChild(GS.el('div', { class: 'gs-shot' }, scoresRow()));
    } else {
      center.appendChild(ui().board());
      mood = shot === 'team-huddle' ? 'huddle' : (shot === 'audience-pan' ? 'pan' : '');
      if (shot === 'buzzer-race' && st.buzz && st.buzz.open) center.appendChild(GS.el('div', { class: 'gs-center headline', style: 'font-size:40px' }, 'BUZZ IN!'));
    }
    // The frame carries the podium characters, the floating big clock, and the
    // lower-third host caption — the caption bar IS the frame's lower third.
    // The broadcast carries no app chrome — the frame's marquee holds the show
    // identity and code; the app lives in a corner channel bug like real TV.
    return GS.el('div', { class: 'gs-col' },
      GS.play.frame(center, { dock: null, mood: mood }),
      GS.el('div', { class: 'gp-bug' }, '★ GAME SHOW'));
  }

  // ── my-seat controls (team + presence chooser) ────────────────────────────
  function seatBar() {
    var seat = GS.mySeat();
    if (!seat) return null;
    function set(patch) { GS.api.post('/seat', Object.assign({ roomId: GS.roomId }, patch)).then(function () { GS.poll(); setTimeout(P.syncCamera, 300); }); }
    function teamBtn(t) { return GS.el('button', { class: 'gs-btn ' + (seat.team === t ? 'gold' : 'ghost'), onclick: function () { set({ team: t }); } }, 'Team ' + t); }
    function presBtn(k, label) { return GS.el('button', { class: 'gs-btn ' + (seat.presenceKind === k ? 'blue' : 'ghost'), onclick: function () { set({ presenceKind: k }); } }, label); }
    var row = GS.el('div', { class: 'gs-row gs-center', style: 'margin-top:10px' }, GS.el('span', { class: 'gs-muted' }, 'You:'));
    if (GS.show && GS.show.teams) { row.appendChild(teamBtn('A')); row.appendChild(teamBtn('B')); }
    row.appendChild(GS.el('span', { class: 'gs-muted', style: 'margin-left:10px' }, 'Show me as:'));
    row.appendChild(presBtn('avatar', '🙂 Avatar')); row.appendChild(presBtn('camera', '📷 Camera')); row.appendChild(presBtn('off', '🔇 Name'));
    return row;
  }

  // ── The answer box: type it, or SAY it (#5) ───────────────────────────────
  function micButton(inp, send) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;   // typed input stays the fallback everywhere
    var btn = GS.el('button', { class: 'gs-btn ghost', title: 'Say your answer' }, '🎤');
    btn.addEventListener('click', function () {
      var rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = false; rec.maxAlternatives = 1;
      btn.textContent = '⏺'; btn.classList.add('gold');
      rec.onresult = function (e) {
        var text = String(e.results[0][0].transcript || '').trim();
        if (text) { inp.value = text; send(); }
      };
      rec.onerror = function () { GS.toast('Could not hear you — type it instead.'); };
      rec.onend = function () { btn.textContent = '🎤'; btn.classList.remove('gold'); };
      try { rec.start(); } catch (_e) { btn.textContent = '🎤'; }
    });
    return btn;
  }

  function answerBox(actorSeatId, placeholder) {
    var inp = GS.el('input', { class: 'gs-input', placeholder: placeholder || 'Type or say your answer…', maxlength: '120' });
    function send() { if (inp.value.trim()) { GS.answer(inp.value.trim(), actorSeatId); inp.value = ''; } }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    return GS.el('div', { class: 'gs-row', style: 'justify-content:center' }, inp,
      micButton(inp, send),
      GS.el('button', { class: 'gs-btn blue', onclick: send }, 'Answer'));
  }

  function wagerBox(phase) {
    var isFinal = phase === 'final-wager';
    var inp = GS.el('input', { class: 'gs-input', type: 'number', min: '0', placeholder: isFinal ? 'Your final wager' : 'Daily Double wager' });
    function send() { GS.act({ type: isFinal ? 'finalWager' : 'wager', amount: Number(inp.value) || 0 }, GS.actAs); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    return GS.el('div', { class: 'gs-row', style: 'justify-content:center' }, inp, GS.el('button', { class: 'gs-btn gold', onclick: send }, 'Wager'));
  }

  function interviewBox(root) {
    var iv = GS.state.interview;
    var mine = iv && iv.active && iv.status === 'asked' && iv.seatId === GS.actingSeat();
    if (!mine) return;
    var ai = GS.el('input', { class: 'gs-input', placeholder: 'Answer the host…' });
    root.appendChild(GS.el('div', { class: 'gs-caption' }, iv.question));
    root.appendChild(ai);
    root.appendChild(GS.el('button', { class: 'gs-btn', onclick: function () { GS.act({ type: 'answerInterview', text: ai.value }, GS.actAs); } }, 'Tell the host'));
  }

  function playerControls() {
    var st = GS.state, buzz = st.buzz || {};
    var box = GS.el('div', { class: 'gs-col gs-center' });
    if (buzz.open) {
      var locked = buzz.lockedBy === GS.actingSeat();
      box.appendChild(GS.el('button', { class: 'gs-dockbuzz' + (locked ? ' locked' : ''), onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, GS.actAs); } }, locked ? '✋ YOU\'RE IN — ANSWER!' : '🔔 BUZZ IN'));
    } else if (buzz.lockedBy && buzz.lockedBy !== GS.actingSeat()) {
      box.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, '👀 ' + seatName(buzz.lockedBy) + ' buzzed first…'));
    }
    var extra = ui().controls && ui().controls(GS.actAs);
    if (extra) box.appendChild(extra);
    if (isAnswerPhase() && ui().canType(GS.actingSeat())) box.appendChild(answerBox(GS.actAs));
    if (isWagerPhase()) box.appendChild(wagerBox(st.phase));
    interviewBox(box);
    return box;
  }

  // ── stage (desktop / solo: the broadcast frame, controls in the dock) ──────
  // Team/presence switching stays reachable, folded into a 🙂 You popover whose
  // open state lives module-level so the ~1.4s re-render cannot slam it shut.
  var youOpen = false;
  function youPopover() {
    var bar = seatBar();
    if (!bar) return null;
    var body = GS.el('div', { class: 'gp-you-body', style: 'display:' + (youOpen ? 'block' : 'none') }, bar);
    return GS.el('div', { class: 'gp-you' },
      GS.el('button', { class: 'gs-btn ghost', style: 'padding:6px 10px', onclick: function () {
        youOpen = !youOpen; body.style.display = youOpen ? 'block' : 'none';
      } }, '🙂 You'),
      body);
  }

  function stageDock() {
    var st = GS.state;
    var dock = GS.el('div', { class: 'gs-col gs-center', style: 'gap:8px' }, playerControls());
    var strip = GS.el('div', { class: 'gs-row gs-center gp-owner-strip' });
    if (GS.isOwner()) {
      strip.appendChild(GS.el('button', { class: 'gs-btn gold', disabled: !canStartNow(), onclick: function () { GS.hostCmd(st.phase === 'lobby' ? 'start' : 'continue'); } },
        st.phase === 'lobby' ? '▶ Start the show' : '▶ Next round'));
      var solo = soloNightButton();
      if (solo) strip.appendChild(solo);
      strip.appendChild(GS.el('a', { class: 'gs-btn ghost', href: '?view=host&room=' + GS.roomId, title: 'Host desk' }, '⚙'));
    }
    var you = youPopover();
    if (you) strip.appendChild(you);
    if (strip.childNodes.length) dock.appendChild(strip);
    return dock;
  }

  function stage() {
    var root = GS.el('div', { class: 'gs-col' }, header());
    if (needLobby()) { root.appendChild(lobby()); return root; }
    root.appendChild(GS.play.frame(ui().board(), { dock: stageDock() }));
    return root;
  }

  // One-person game night: seat the host as a playable ⭐ podium and fill the
  // rest of the stage with AI players (a good one on your side too).
  function soloNight() {
    var teams = GS.show && GS.show.teams;
    var plan = teams
      ? [{ team: 'A', mine: true }, { team: 'A', npc: 'sharp' }, { team: 'A', npc: 'casual' },
         { team: 'B', npc: 'sharp' }, { team: 'B', npc: 'casual' }, { team: 'B', npc: 'wild' }]
      : [{ mine: true }, { npc: 'sharp' }, { npc: 'casual' }, { npc: 'wild' }];
    var myName = '⭐ ' + (((GS.mySeat() || {}).name) || 'You');
    var chain = Promise.resolve(), mySeatId = null;
    plan.forEach(function (spec) {
      chain = chain.then(function () {
        return GS.api.post('/podium', { roomId: GS.roomId, team: spec.team || null, npc: spec.npc || null, name: spec.mine ? myName : undefined })
          .then(function (r) { if (spec.mine && r.body && r.body.seatId) mySeatId = r.body.seatId; });
      });
    });
    chain.then(function () {
      if (mySeatId) GS.actAs = mySeatId;
      GS.toast('Stage filled — you play as ' + myName);
      GS.poll().then(function () { if (GS.render) GS.render(); });
    });
  }

  function soloNightButton() {
    if (!GS.isOwner() || GS.players().length) return null;
    return GS.el('button', { class: 'gs-btn blue', onclick: soloNight }, '🤖 Solo night (play vs AI)');
  }

  // ── clicker (phone companion; honors ?as= hotseat pinning) ────────────────
  function clicker() {
    var root = GS.el('div', { class: 'gs-col', style: 'padding:16px' }, header());
    if (needLobby()) { root.appendChild(lobby()); return root; }
    var st = GS.state, buzz = st.buzz || {};
    var acting = GS.actingSeat();
    var label = GS.actAs ? (seatName(GS.actAs) + ' (hotseat)') : ((GS.mySeat() || {}).name || 'Spectator');
    var team = (GS.seats.filter(function (s) { return s.seatId === acting; })[0] || {}).team;
    root.appendChild(GS.el('div', { class: 'gs-center' }, GS.el('span', { class: 'gs-chip' }, label + (team ? ' · Team ' + team : ''))));
    root.appendChild(captionBar());
    var locked = buzz.lockedBy === acting;
    root.appendChild(GS.el('div', { class: 'gs-buzzer' },
      GS.el('button', { class: 'gs-buzz-btn' + (locked ? ' locked' : ''), disabled: !buzz.open, onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, GS.actAs); } }, locked ? '✋' : 'BUZZ')));
    if (!buzz.open && buzz.lockedBy && buzz.lockedBy !== acting) {
      root.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, seatName(buzz.lockedBy) + ' buzzed first.'));
    }
    // The clicker's action region is the phone's dock — the playthrough types
    // answers into '#gs-dock input.gs-input'.
    var dock = GS.el('div', { id: 'gs-dock', class: 'gs-col gs-center' });
    var extra = ui().controls && ui().controls(GS.actAs);
    if (extra) dock.appendChild(extra);
    if (isAnswerPhase() && ui().canType(GS.actingSeat())) dock.appendChild(answerBox(GS.actAs));
    if (isWagerPhase()) dock.appendChild(wagerBox(st.phase));
    interviewBox(dock);
    root.appendChild(dock);
    if (!GS.actAs) root.appendChild(seatBar());
    return root;
  }

  // ── host desk (the MC) ────────────────────────────────────────────────────
  var lastCostAt = 0;
  function costChip() {
    var chip = GS.el('span', { class: 'gs-pill', id: 'gs-cost' }, 'AI spend …');
    if (Date.now() - lastCostAt > 15000) {
      lastCostAt = Date.now();
      GS.api.get('/cost?roomId=' + GS.roomId).then(function (r) {
        if (!r.body || r.body.ok === false) return;
        GS._costText = 'AI spend $' + (Number(r.body.spend) || 0).toFixed(2) + ' · ' + r.body.calls + ' calls';
        var node = document.getElementById('gs-cost');
        if (node) node.textContent = GS._costText;
      }).catch(function () {});
    }
    if (GS._costText) chip.textContent = GS._costText;
    return chip;
  }

  // The host can play THEIR OWN questions — no AI required. Feud takes a friendly
  // plain-text format; every show accepts its raw generated-JSON shape.
  function parseManual(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    if (raw.charAt(0) === '{') { try { return JSON.parse(raw); } catch (_e) { return null; } }
    if (showId() !== 'family-feud') return null;   // structured shows take JSON
    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 4) return null;
    var answers = lines.slice(1).map(function (line) {
      var parts = line.split('|').map(function (p) { return p.trim(); });
      return {
        text: parts[0],
        points: Number(parts[1]) || 0,
        aliases: parts[2] ? parts[2].split(',').map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean) : [],
      };
    }).filter(function (a) { return a.text; });
    return { question: lines[0], answers: answers };
  }

  function manualPanel() {
    if (!canStartNow()) return null;
    var open = GS.el('div', { style: 'display:none' });
    var ta = GS.el('textarea', { class: 'gs-input', rows: '6', placeholder: showId() === 'family-feud'
      ? 'Name something you find in a kitchen?\nRefrigerator | 40 | fridge\nStove | 30 | oven\nSink | 20\nToaster | 10'
      : 'Paste this show\'s generated-JSON shape here.' });
    open.appendChild(ta);
    open.appendChild(GS.el('button', { class: 'gs-btn blue', style: 'margin-top:6px', onclick: function () {
      var content = parseManual(ta.value);
      if (!content) { GS.toast('Could not read that — check the format.'); return; }
      GS.hostCmd('manual', { content: content }).then(function (r) { if (r.body && r.body.ok) { ta.value = ''; open.style.display = 'none'; } });
    } }, 'Play my questions'));
    var toggle = GS.el('button', { class: 'gs-btn ghost', onclick: function () {
      open.style.display = open.style.display === 'none' ? 'block' : 'none';
    } }, '✍ Use my own questions');
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px;margin:12px 0' }, toggle, open);
  }

  // The Show-tools drawer folds the deep controls (clock fixes, hotseat,
  // interview, cutaways) behind one toggle. Open state lives module-level so
  // the ~1.4s re-render cannot slam it shut mid-recovery.
  var toolsOpen = false;
  function toolsDrawer(children) {
    var body = GS.el('div', { style: 'display:' + (toolsOpen ? 'block' : 'none') });
    children.forEach(function (child) { if (child) body.appendChild(child); });
    var toggle = GS.el('button', { class: 'gs-btn ghost', onclick: function () {
      toolsOpen = !toolsOpen; body.style.display = toolsOpen ? 'block' : 'none';
    } }, '🔧 Show tools — clock, fixes, interview, cutaways');
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px;margin:12px 0' }, toggle, body);
  }

  function hostDesk() {
    var st = GS.state, board = st.board || {};
    var root = GS.el('div', { class: 'gs-wrap gs-col' }, header());
    root.appendChild(GS.el('div', { class: 'gs-panel', style: 'padding:12px' }, GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-pill' }, 'Phase: ' + (st.phase || 'lobby')),
      board.control ? GS.el('span', { class: 'gs-pill' }, 'Control: ' + (GS.show && GS.show.teams ? 'Team ' + board.control : seatName(board.control))) : null,
      showId() === 'family-feud' ? GS.el('span', { class: 'gs-pill' }, 'Strikes: ' + (board.strikes || 0)) : null,
      GS.el('span', { class: 'gs-pill' }, 'Round ' + (st.round || 0)),
      costChip())));
    var canStart = canStartNow();
    root.appendChild(GS.el('div', { class: 'gs-row', style: 'margin:12px 0' },
      GS.el('button', { class: 'gs-btn gold', disabled: !canStart, onclick: function () { GS.hostCmd(st.phase === 'lobby' ? 'start' : 'continue'); } }, st.phase === 'lobby' ? '▶ Start round' : '▶ Next round'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('intro'); } }, '🎤 Intro'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('reveal'); } }, '💬 React'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('recap'); } }, '↺ Recap'),
      GS.el('a', { class: 'gs-btn ghost', href: '?view=rehearsal&room=' + GS.roomId }, '🎬 Rehearsal'),
      GS.el('a', { class: 'gs-btn ghost', href: '?view=tv&room=' + GS.roomId, target: '_blank' }, '📺 Big Screen')));
    var extras = ui().hostExtras && ui().hostExtras();
    if (extras) root.appendChild(extras);
    var manual = manualPanel();
    if (manual) root.appendChild(manual);
    var key = ui().hostKey();
    if (key) root.appendChild(key);
    var preview = null;
    if (GS.cutaways) {
      preview = GS.el('div', { class: 'gs-panel gs-cutaway-preview' },
        GS.el('span', { class: 'gs-muted' }, 'Broadcast cutaways:'));
      GS.cutaways.items.forEach(function (entry) {
        preview.appendChild(GS.el('button', {
          class: 'gs-btn ghost',
          onclick: function () { GS.cutaways.preview(entry.id); },
        }, entry.label));
      });
    }
    root.appendChild(toolsDrawer([
      GS.controls.hostPanel(showId()),
      actingAsRow(),
      interviewControls(),
      preview,
    ]));
    root.appendChild(podiumAdmin());
    root.appendChild(captionBar());
    return root;
  }

  // Hotseat: let the host drive any podium (buzz/answer/pick/wager) from the desk.
  function actingAsRow() {
    var sel = GS.el('select', { class: 'gs-input', style: 'max-width:240px',
      onchange: function (e) { GS.actAs = e.target.value || null; GS.render(); } });
    sel.appendChild(GS.el('option', { value: '' }, 'myself'));
    GS.players().forEach(function (s) {
      var opt = GS.el('option', { value: s.seatId }, s.name);
      if (GS.actAs === s.seatId) opt.setAttribute('selected', 'selected');
      sel.appendChild(opt);
    });
    return GS.el('div', { class: 'gs-row', style: 'margin:12px 0' }, GS.el('span', { class: 'gs-muted' }, 'Hotseat — acting as:'), sel);
  }

  function interviewControls() {
    var iv = GS.state.interview, box = GS.el('div', { class: 'gs-row', style: 'margin:12px 0' });
    if (iv && iv.active) {
      box.appendChild(GS.el('span', { class: 'gs-muted' }, 'Interview: ' + iv.status));
      if (iv.status === 'answered') box.appendChild(GS.el('button', { class: 'gs-btn blue', onclick: function () { GS.hostCmd('interview-react'); } }, 'React to answer'));
      box.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.act({ type: 'endInterview' }); } }, 'End interview'));
    } else {
      var sel = GS.el('select', { class: 'gs-input', style: 'max-width:220px' });
      GS.players().forEach(function (s) { sel.appendChild(GS.el('option', { value: s.seatId }, s.name)); });
      box.appendChild(GS.el('span', { class: 'gs-muted' }, 'Interview:'));
      box.appendChild(sel);
      box.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { if (sel.value) GS.hostCmd('interview-ask', { seatId: sel.value }); } }, 'Ask'));
    }
    return box;
  }

  function podiumAdmin() {
    function addPodium(team) {
      var count = team ? GS.teamSeats(team).length : GS.players().length;
      GS.api.post('/podium', { roomId: GS.roomId, team: team, name: (team ? 'Team ' + team + ' ' : 'Player ') + (count + 1) }).then(function () { GS.poll(); });
    }
    function addNpc(team, skill) {
      GS.api.post('/podium', { roomId: GS.roomId, team: team, npc: skill }).then(function () { GS.poll(); });
    }
    var addRow = GS.el('div', { class: 'gs-row' }, GS.el('span', { class: 'gs-muted' }, 'Add hotseat podium:'));
    var skillSel = GS.el('select', { class: 'gs-input', style: 'max-width:170px' });
    [['sharp', '🎯 Sharp (good)'], ['casual', '🙂 Casual'], ['wild', '🎲 Wildcard']].forEach(function (opt) {
      skillSel.appendChild(GS.el('option', { value: opt[0] }, opt[1]));
    });
    var npcRow = GS.el('div', { class: 'gs-row', style: 'margin-top:6px' }, GS.el('span', { class: 'gs-muted' }, 'Add AI player:'), skillSel);
    if (GS.show && GS.show.teams) {
      addRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addPodium('A'); } }, '+ Team A'));
      addRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addPodium('B'); } }, '+ Team B'));
      npcRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addNpc('A', skillSel.value); } }, '+ 🤖 Team A'));
      npcRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addNpc('B', skillSel.value); } }, '+ 🤖 Team B'));
    } else {
      addRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addPodium(null); } }, '+ Podium'));
      npcRow.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { addNpc(null, skillSel.value); } }, '+ 🤖 AI player'));
    }
    var soloBtn = soloNightButton();
    if (soloBtn) npcRow.appendChild(soloBtn);
    var box = GS.el('div', { class: 'gs-panel', style: 'padding:12px' }, addRow, npcRow);
    var grid = GS.el('div', { class: 'gs-podiums' });
    var st = GS.state, buzz = st.buzz || {};
    GS.players().forEach(function (s) {
      var col = GS.el('div', { class: 'gs-podium' }, P.tile(s), GS.el('div', { class: 'plabel' }, s.name + (s.team ? ' (' + s.team + ')' : '')));
      if (buzz.open) col.appendChild(GS.el('button', { class: 'gs-btn gold', style: 'padding:6px 10px;margin-top:4px', onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, s.seatId); } }, 'Buzz'));
      if (isAnswerPhase()) {
        var inp = GS.el('input', { class: 'gs-input', placeholder: 'answer', style: 'font-size:13px;padding:6px;margin-top:4px' });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && inp.value.trim()) { GS.answer(inp.value.trim(), s.seatId); inp.value = ''; } });
        col.appendChild(inp);
      }
      grid.appendChild(col);
    });
    box.appendChild(grid);
    return box;
  }

  // ── audience (watch + react — reactions BROADCAST now, #16) ───────────────
  function audience() {
    var root = tv();
    var box = GS.el('div', { class: 'gs-reacts' });
    ['👏', '😂', '😮', '🔥', '❤️'].forEach(function (e) {
      box.appendChild(GS.el('button', { onclick: function () {
        floatReact(e);
        GS.api.post('/react', { roomId: GS.roomId, emoji: e }).catch(function () {});
      } }, e));
    });
    root.appendChild(box);
    return root;
  }

  // ── rehearsal: EVERY surface in one window against one room ───────────────
  // The P0 browser playthrough needs no TV and no phones: the host desk, the big
  // screen, one pinned clicker per podium, and the audience all run as live
  // iframes over the SAME room. Iframes self-poll, so this shell re-renders only
  // when the seat roster changes — never on every state tick.
  var rehearsalSig = null;
  function frame(title, view, asSeat, tall) {
    var src = location.pathname + '?view=' + view + '&room=' + GS.roomId + (asSeat ? '&as=' + asSeat : '');
    return GS.el('div', { class: 'gs-panel', style: 'padding:6px;display:flex;flex-direction:column;min-width:0' },
      GS.el('div', { class: 'gs-muted', style: 'font-size:12px;margin:2px 4px' }, title),
      GS.el('iframe', { src: src, style: 'border:0;width:100%;height:' + (tall ? '46vh' : '38vh') + ';border-radius:8px;background:var(--bg-card)' }));
  }

  function renderRehearsal() {
    if (!GS.roomId) { GS.mount(lobby()); rehearsalSig = null; return; }
    if (!GS.isOwner()) { GS.mount(stage()); return; }
    var players = GS.players();
    var sig = GS.roomId + '|' + players.map(function (s) { return s.seatId; }).join(',');
    if (sig === rehearsalSig && document.getElementById('gs-rehearsal')) return;   // iframes live on
    rehearsalSig = sig;
    var root = GS.el('div', { class: 'gs-wrap gs-col', id: 'gs-rehearsal' }, header());
    var bar = GS.el('div', { class: 'gs-row', style: 'margin:8px 0' },
      GS.el('span', { class: 'gs-muted' }, '🎬 Rehearsal — the whole studio in one window. Add podiums, then play every role from here.'));
    function add(team) {
      GS.api.post('/podium', { roomId: GS.roomId, team: team, name: (team ? 'Team ' + team + ' ' : 'Player ') + (players.length + 1) }).then(function () { GS.poll(); });
    }
    if (GS.show && GS.show.teams) {
      bar.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { add('A'); } }, '+ Podium A'));
      bar.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { add('B'); } }, '+ Podium B'));
    } else {
      bar.appendChild(GS.el('button', { class: 'gs-btn ghost', onclick: function () { add(null); } }, '+ Podium'));
    }
    bar.appendChild(GS.el('a', { class: 'gs-btn ghost', href: '?view=host&room=' + GS.roomId }, 'Full host desk'));
    root.appendChild(bar);
    var top = GS.el('div', { style: 'display:grid;grid-template-columns:3fr 2fr;gap:10px' },
      frame('📺 Big screen', 'tv', null, true), frame('🎤 Host desk', 'host', null, true));
    root.appendChild(top);
    var cols = Math.max(2, Math.min(players.length + 1, 4));
    var bottom = GS.el('div', { style: 'display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:10px;margin-top:10px' });
    players.forEach(function (s) { bottom.appendChild(frame('📱 ' + s.name, 'clicker', s.seatId, false)); });
    bottom.appendChild(frame('👏 Audience', 'audience', null, false));
    root.appendChild(bottom);
    GS.mount(root);
  }

  // ── lobby (join / host a new game — posters are the show picker) ──────────
  function lobby() {
    var chosen = { t: 'A' };
    var box = GS.el('div', { class: 'gs-panel gp-lobby', style: 'padding:20px;max-width:760px;margin:20px auto' });
    box.appendChild(GS.el('div', { class: 'gs-brand', style: 'text-align:center;font-size:26px;margin-bottom:6px' }, '★ GAME SHOW'));
    box.appendChild(GS.el('p', { class: 'gs-center gs-muted' }, 'Join a game, or start your own show.'));
    var code = GS.el('input', { class: 'gs-input', placeholder: 'Enter join code', maxlength: '6', value: GS.joinCode || '' });
    var teamSel = GS.el('div', { class: 'gs-row', style: 'justify-content:center' });
    ['A', 'B'].forEach(function (t) {
      teamSel.appendChild(GS.el('button', { class: 'gs-btn ' + (chosen.t === t ? 'gold' : 'ghost'), onclick: function () {
        chosen.t = t; Array.prototype.forEach.call(teamSel.children, function (c, i) { c.className = 'gs-btn ' + (['A', 'B'][i] === t ? 'gold' : 'ghost'); });
      } }, 'Team ' + t));
    });
    function join() {
      if (!code.value.trim()) { GS.toast('Enter a code'); return; }
      GS.api.post('/join', { code: code.value.trim(), team: chosen.t }).then(function (r) {
        if (r.body && r.body.ok) GS.boot(r.body.roomId); else GS.toast((r.body && r.body.error) || 'No game found');
      });
    }
    // Poster wall: one card per catalog show — tap a poster to host that show and
    // land straight on the stage (the broadcast), not an admin screen.
    var catalog = (GS.shows && GS.shows.length) ? GS.shows
      : [{ id: 'family-feud', title: 'Family Feud' }, { id: 'jeopardy', title: 'Jeopardy' }];
    var ART = { 'family-feud': '👨‍👩‍👧‍👦', 'jeopardy': '🧠', 'wheel': '🎡', 'whammy': '😈' };
    function hostShow(id) {
      GS.api.post('/rooms', { showId: id }).then(function (r) {
        if (r.body && r.body.room) location.search = '?view=stage&room=' + r.body.room.roomId;
        else GS.toast((r.body && r.body.error) || 'Could not start a game');
      });
    }
    var posters = GS.el('div', { class: 'gp-posters' });
    catalog.forEach(function (s) {
      posters.appendChild(GS.el('div', { class: 'gp-poster', 'data-show': s.id, onclick: function () { hostShow(s.id); } },
        GS.el('div', { class: 'gp-poster-art' }, ART[s.id] || '🎬'),
        GS.el('div', { class: 'gp-poster-title' }, s.title),
        GS.el('div', { class: 'gp-poster-tag' }, s.tagline || ''),
        GS.el('div', { class: 'gp-poster-cta' }, '🎬 Host this show')));
    });
    box.appendChild(GS.el('div', { class: 'gs-col' }, code, GS.el('div', { class: 'gs-center gs-muted' }, 'Pick your team (team games only)'), teamSel,
      GS.el('button', { class: 'gs-btn blue', onclick: join }, 'Join game')));
    box.appendChild(GS.el('hr', { style: 'border-color:rgba(255,255,255,.12);margin:18px 0' }));
    box.appendChild(GS.el('div', { class: 'gs-col' }, GS.el('div', { class: 'gs-center gs-muted' }, 'Pick tonight\'s show'), posters));
    // Your open games: resume one, or end it to clear the stage for a new show.
    var mine = GS.el('div', { class: 'gs-col', style: 'margin-top:14px' });
    box.appendChild(mine);
    GS.api.get('/rooms').then(function (r) {
      var rooms = (r.body && r.body.rooms) || [];
      if (!rooms.length) return;
      mine.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, 'Your open games'));
      rooms.forEach(function (room) {
        var title = ((GS.shows || []).filter(function (s) { return s.id === room.showId; })[0] || {}).title || room.showId;
        var row = GS.el('div', { class: 'gs-row', style: 'justify-content:space-between;align-items:center' },
          GS.el('span', {}, title + ' · ' + (room.phase || 'lobby') + (room.players ? ' · ' + room.players + ' players' : '')),
          GS.el('span', {},
            GS.el('a', { class: 'gs-btn blue', style: 'padding:4px 10px', href: '?view=stage&room=' + room.roomId }, 'Resume'),
            room.isOwner ? GS.el('button', { class: 'gs-btn ghost', style: 'padding:4px 10px;margin-left:6px', onclick: function () {
              GS.api.post('/status', { roomId: room.roomId, status: 'ended' }).then(function () { row.remove(); });
            } }, 'End') : null));
        mine.appendChild(row);
      });
    }).catch(function () {});
    // 🏆 Hall of fame (#11): the end-of-game score snapshots finally have a
    // reader — top scores across YOUR ended games, best first. No history, no panel.
    var fame = GS.el('div', { class: 'gs-col', style: 'margin-top:14px' });
    box.appendChild(fame);
    GS.api.get('/leaderboard').then(function (r) {
      var entries = (r.body && r.body.entries) || [];
      if (!entries.length) return;
      fame.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, '🏆 Hall of fame — your table\'s best'));
      entries.forEach(function (e, i) {
        var title = ((GS.shows || []).filter(function (s) { return s.id === e.showId; })[0] || {}).title || e.showId;
        fame.appendChild(GS.el('div', { class: 'gs-row', style: 'justify-content:space-between;align-items:center' },
          GS.el('span', {}, (i + 1) + '. ' + e.name + (e.team ? ' (Team ' + e.team + ')' : '') + ' · ' + title),
          GS.el('span', { class: 'gs-chip' }, String(e.score))));
      });
    }).catch(function () {});
    return box;
  }

  function help() {
    return GS.el('div', { class: 'gs-wrap gs-panel', style: 'padding:24px;max-width:720px;margin:24px auto' },
      GS.el('h2', { class: 'gs-brand' }, 'How to play'),
      GS.el('p', {}, 'One person hosts (the Host Desk). Everyone else joins from their phone with the 6-letter code.'),
      GS.el('ul', {},
        GS.el('li', {}, 'Put the Big Screen on a TV — it shows the board, the podiums, and the host.'),
        GS.el('li', {}, 'Buzz first, then type — or tap the 🎤 and just say your answer.'),
        GS.el('li', {}, 'Show yourself as a live camera, an avatar, or just your name — your call.'),
        GS.el('li', {}, 'Pick your show in the lobby: Family Feud, Jeopardy, Wheel of Fortune, or Whammy. The ☰ New game button up top always brings the lobby back.'),
        GS.el('li', {}, 'Playing alone? Hit 🤖 Solo night — AI players fill both sides (good ones on your team too). They buzz, answer, spin, wager, and press their luck on their own in every show, Fast Money included.'),
        GS.el('li', {}, 'No TV and no phones handy? Open Rehearsal (?view=rehearsal) — the whole studio plays in one window.')));
  }

  // ── render dispatcher (one synced state → the right layout) ────────────────
  GS.render = function () {
    if (GS.play) GS.play.sync();
    P.syncCamera();
    if (GS.view === 'help') { GS.mount(help()); return; }
    if (GS.view === 'rehearsal') { renderRehearsal(); return; }
    if (!GS.roomId) { GS.mount(lobby()); return; }
    var node;
    if (GS.view === 'tv') node = tv();
    else if (GS.view === 'host') node = GS.isOwner() ? hostDesk() : stage();
    else if (GS.view === 'clicker') node = clicker();
    else if (GS.view === 'audience') node = audience();
    else node = stage();
    GS.mount(node);
  };
})();
