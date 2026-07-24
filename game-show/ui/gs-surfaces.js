/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The surfaces: one synced state rendered as five layouts (tv/stage/clicker/host/audience) plus lobby + help. The big screen is directed by state.shot (board, buzzer race, huddle, audience pan, celebration dance, interview); phones are the buzzer + answer; the host desk drives the show and can run hotseat podiums.
 */

/* global window, document, location */
(function () {
  'use strict';
  var GS = window.GS;
  var P = GS.presence;

  // ── show-aware board renderers ────────────────────────────────────────────
  // Mirrors the server-side show registry: ADD A SHOW = add a renderer here plus
  // its answer/wager phases. Nothing else in the surface knows any show's rules.
  function showId() { return (GS.state && GS.state.showId) || (GS.show && GS.show.id) || 'family-feud'; }
  function actingSeat() { return GS.actAs || ((GS.mySeat() || {}).seatId || null); }

  function feudSlots() {
    var answers = (GS.state.board && GS.state.board.answers) || [];
    var grid = GS.el('div', { class: 'gs-board' + (answers.length <= 5 ? ' one-col' : '') });
    answers.forEach(function (a, i) {
      if (a.revealed) {
        grid.appendChild(GS.el('div', { class: 'gs-slot revealed' + (a.by ? (' by' + a.by) : '') },
          GS.el('div', { class: 'num' }, i + 1), GS.el('div', { class: 'txt' }, a.text), GS.el('div', { class: 'pts' }, a.points)));
      } else {
        grid.appendChild(GS.el('div', { class: 'gs-slot hidden', 'data-n': i + 1 }));
      }
    });
    return grid;
  }

  function feudBoardArea() {
    return GS.el('div', {},
      GS.el('div', { class: 'gs-question' }, (GS.state.board && GS.state.board.question) || 'Get ready…'),
      strikes(), feudSlots());
  }

  function activeClueOf(board) {
    if (!board || !board.pick) return null;
    var category = (board.categories || [])[board.pick.cat];
    return category ? (category.clues || [])[board.pick.row] || null : null;
  }

  function jeopardyRow(grid, cats, row, canPick) {
    cats.forEach(function (category, ci) {
      var clue = category.clues[row];
      var cell = GS.el('div', { class: 'gs-jcell' + (clue.used ? ' used' : (canPick ? '' : ' locked')) }, clue.used ? '' : ('$' + clue.value));
      if (!clue.used && canPick) cell.addEventListener('click', function () { GS.act({ type: 'pick', cat: ci, row: row }, GS.actAs); });
      grid.appendChild(cell);
    });
  }

  function jeopardyGrid() {
    var board = GS.state.board || {}, cats = board.categories || [];
    if (!cats.length) return GS.el('div', { class: 'gs-center gs-muted' }, 'Waiting for the board…');
    var canPick = GS.state.phase === 'board' && (!board.control || board.control === actingSeat());
    var grid = GS.el('div', { class: 'gs-jgrid', style: 'grid-template-columns:repeat(' + cats.length + ',1fr)' });
    cats.forEach(function (c) { grid.appendChild(GS.el('div', { class: 'gs-jcat' }, c.title)); });
    for (var row = 0; row < 5; row++) jeopardyRow(grid, cats, row, canPick);
    return grid;
  }

  function jeopardyBoardArea() {
    var st = GS.state, board = st.board || {}, clue = activeClueOf(board);
    if (['clue', 'answer'].indexOf(st.phase) >= 0 && clue) {
      return GS.el('div', {}, GS.el('div', { class: 'gs-question', style: 'min-height:20vh;display:grid;place-items:center' }, clue.clue));
    }
    if (st.phase === 'daily-wager') return GS.el('div', {}, GS.el('div', { class: 'gs-question' }, 'DAILY DOUBLE — name your wager'));
    if (['final-wager', 'final-answer'].indexOf(st.phase) >= 0 && board.final) {
      return GS.el('div', {},
        GS.el('div', { class: 'gs-question' }, 'FINAL JEOPARDY — ' + board.final.category),
        st.phase === 'final-answer' ? GS.el('div', { class: 'gs-question' }, board.final.clue) : GS.el('p', { class: 'gs-center gs-muted' }, 'Place your wagers…'));
    }
    return GS.el('div', {}, jeopardyGrid());
  }

  var BOARDS = { 'family-feud': feudBoardArea, 'jeopardy': jeopardyBoardArea };
  var ANSWER_PHASES = { 'family-feud': ['faceoff', 'play', 'steal'], 'jeopardy': ['answer', 'final-answer'] };
  var WAGER_PHASES = { 'family-feud': [], 'jeopardy': ['daily-wager', 'final-wager'] };
  var START_PHASES = { 'family-feud': ['lobby', 'round-win', 'scoreboard'], 'jeopardy': ['lobby', 'final-setup'] };
  function canStartNow() { return (START_PHASES[showId()] || ['lobby']).indexOf(GS.state.phase) >= 0; }
  function seatName(seatId) {
    var hit = GS.seats.filter(function (s) { return s.seatId === seatId; })[0];
    return hit ? hit.name : seatId;
  }
  function boardArea() { return (BOARDS[showId()] || feudBoardArea)(); }
  function isAnswerPhase() { return (ANSWER_PHASES[showId()] || []).indexOf(GS.state.phase) >= 0; }
  function isWagerPhase() { return (WAGER_PHASES[showId()] || []).indexOf(GS.state.phase) >= 0; }

  function strikes() {
    var n = (GS.state.board && GS.state.board.strikes) || 0;
    var row = GS.el('div', { class: 'gs-strikes' });
    for (var i = 0; i < n; i++) row.appendChild(GS.el('div', { class: 'gs-x' }, '✗'));
    return row;
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

  // ── TV / big screen (directed by state.shot) ──────────────────────────────
  function tv() {
    var st = GS.state, shot = (st.shot && st.shot.type) || 'board';
    var root = GS.el('div', { class: 'gs-col' }, header());
    var center = GS.el('div', { class: 'gs-wrap' });
    if (st.phase === 'lobby') {
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'gs-center' },
        GS.el('div', { class: 'headline' }, 'JOIN CODE'),
        GS.el('div', { style: 'font-size:56px;font-weight:900;letter-spacing:8px;color:#fbbf24' }, (GS.room && GS.room.joinCode) || '------'),
        GS.el('p', { class: 'gs-muted' }, 'Open the Game Show app on your phone and enter this code'))));
      center.appendChild(P.strip());
    } else if (shot === 'celebration') {
      var win = st.board && st.board.winner;
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'headline' }, win ? ('TEAM ' + win + ' WINS!') : 'ROUND OVER')));
      confetti(); center.appendChild(P.strip('dance')); center.appendChild(scoresRow());
    } else if (shot === 'interview') {
      var iv = st.interview || {};
      center.appendChild(GS.el('div', { class: 'gs-shot' }, GS.el('div', { class: 'gs-center' },
        GS.el('div', { class: 'gs-question' }, iv.question || ''),
        iv.answer ? GS.el('div', { class: 'gs-caption' }, '“' + iv.answer + '”') : GS.el('p', { class: 'gs-muted' }, '…'))));
      center.appendChild(P.strip());
    } else if (shot === 'scoreboard') {
      center.appendChild(GS.el('div', { class: 'gs-shot' }, scoresRow())); center.appendChild(P.strip());
    } else {
      center.appendChild(scoresRow()); center.appendChild(boardArea());
      var extra = shot === 'team-huddle' ? 'huddle' : (shot === 'audience-pan' ? 'pan' : '');
      center.appendChild(P.strip(extra));
      if (shot === 'buzzer-race' && st.buzz && st.buzz.open) center.appendChild(GS.el('div', { class: 'gs-center headline', style: 'font-size:40px' }, 'BUZZ IN!'));
      // The big screen carries the clock large enough to read from a couch.
      if (st.timer) center.appendChild(GS.controls.bigClock());
    }
    root.appendChild(center); root.appendChild(captionBar());
    return root;
  }

  // ── my-seat controls (team + presence chooser) ────────────────────────────
  function seatBar() {
    var seat = GS.mySeat();
    if (!seat) return null;
    function set(patch) { GS.api.post('/seat', Object.assign({ roomId: GS.roomId }, patch)).then(function () { GS.poll(); setTimeout(P.syncCamera, 300); }); }
    function teamBtn(t) { return GS.el('button', { class: 'gs-btn ' + (seat.team === t ? 'gold' : 'ghost'), onclick: function () { set({ team: t }); } }, 'Team ' + t); }
    function presBtn(k, label) { return GS.el('button', { class: 'gs-btn ' + (seat.presenceKind === k ? 'blue' : 'ghost'), onclick: function () { set({ presenceKind: k }); } }, label); }
    return GS.el('div', { class: 'gs-row gs-center', style: 'margin-top:10px' },
      GS.el('span', { class: 'gs-muted' }, 'You:'), teamBtn('A'), teamBtn('B'),
      GS.el('span', { class: 'gs-muted', style: 'margin-left:10px' }, 'Show me as:'),
      presBtn('avatar', '🙂 Avatar'), presBtn('camera', '📷 Camera'), presBtn('off', '🔇 Name'));
  }

  function answerBox(actorSeatId, placeholder) {
    var inp = GS.el('input', { class: 'gs-input', placeholder: placeholder || 'Type your answer…', maxlength: '120' });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && inp.value.trim()) { GS.answer(inp.value.trim(), actorSeatId); inp.value = ''; } });
    return GS.el('div', { class: 'gs-row', style: 'justify-content:center' }, inp,
      GS.el('button', { class: 'gs-btn blue', onclick: function () { if (inp.value.trim()) { GS.answer(inp.value.trim(), actorSeatId); inp.value = ''; } } }, 'Answer'));
  }

  function wagerBox(phase) {
    var isFinal = phase === 'final-wager';
    var inp = GS.el('input', { class: 'gs-input', type: 'number', min: '0', placeholder: isFinal ? 'Your final wager' : 'Daily Double wager' });
    function send() { GS.act({ type: isFinal ? 'finalWager' : 'wager', amount: Number(inp.value) || 0 }, GS.actAs); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    return GS.el('div', { class: 'gs-row', style: 'justify-content:center' }, inp, GS.el('button', { class: 'gs-btn gold', onclick: send }, 'Wager'));
  }

  function playerControls() {
    var st = GS.state, buzz = st.buzz || {}, seat = GS.mySeat();
    var box = GS.el('div', { class: 'gs-col gs-center' });
    if (buzz.open) {
      var locked = buzz.lockedBy === actingSeat();
      box.appendChild(GS.el('button', { class: 'gs-btn gold', style: 'font-size:22px;padding:16px 28px', onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, GS.actAs); } }, locked ? '✋ You buzzed!' : '🔔 BUZZ IN'));
    }
    if (isAnswerPhase()) box.appendChild(answerBox(GS.actAs));
    if (isWagerPhase()) box.appendChild(wagerBox(st.phase));
    var iv = st.interview;
    if (iv && iv.active && iv.status === 'asked' && seat && iv.seatId === seat.seatId) {
      var ai = GS.el('input', { class: 'gs-input', placeholder: 'Answer the host…' });
      box.appendChild(GS.el('div', { class: 'gs-caption' }, iv.question));
      box.appendChild(ai);
      box.appendChild(GS.el('button', { class: 'gs-btn', onclick: function () { GS.act({ type: 'answerInterview', text: ai.value }); } }, 'Tell the host'));
    }
    return box;
  }

  // ── stage (desktop / solo: watch + play) ──────────────────────────────────
  function stage() {
    var root = GS.el('div', { class: 'gs-wrap gs-col' }, header());
    if (needLobby()) { root.appendChild(lobby()); return root; }
    root.appendChild(captionBar());
    root.appendChild(scoresRow()); root.appendChild(boardArea());
    root.appendChild(P.strip()); root.appendChild(playerControls()); root.appendChild(seatBar());
    if (GS.isOwner()) root.appendChild(ownerQuickRow());
    return root;
  }

  function ownerQuickRow() {
    var st = GS.state, canStart = canStartNow();
    return GS.el('div', { class: 'gs-row gs-center', style: 'margin-top:14px' },
      GS.el('span', { class: 'gs-muted' }, 'Host:'),
      GS.el('button', { class: 'gs-btn gold', disabled: !canStart, onclick: function () { GS.hostCmd(st.phase === 'lobby' ? 'start' : 'continue'); } }, st.phase === 'lobby' ? 'Start round' : 'Next round'),
      GS.el('a', { class: 'gs-btn ghost', href: '?view=host&room=' + GS.roomId }, 'Host Desk'),
      GS.el('a', { class: 'gs-btn ghost', href: '?view=tv&room=' + GS.roomId, target: '_blank' }, 'Big Screen'));
  }

  // ── clicker (phone companion) ─────────────────────────────────────────────
  function clicker() {
    var root = GS.el('div', { class: 'gs-col', style: 'padding:16px' }, header());
    if (needLobby()) { root.appendChild(lobby()); return root; }
    var st = GS.state, buzz = st.buzz || {}, seat = GS.mySeat();
    root.appendChild(GS.el('div', { class: 'gs-center' }, GS.el('span', { class: 'gs-chip' }, seat ? (seat.name + ' · Team ' + (seat.team || '—')) : 'Spectator')));
    root.appendChild(captionBar());
    var locked = buzz.lockedBy === (seat && seat.seatId);
    root.appendChild(GS.el('div', { class: 'gs-buzzer' },
      GS.el('button', { class: 'gs-buzz-btn' + (locked ? ' locked' : ''), disabled: !buzz.open, onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }); } }, locked ? '✋' : 'BUZZ')));
    if (isAnswerPhase()) root.appendChild(answerBox(null));
    if (isWagerPhase()) root.appendChild(wagerBox(st.phase));
    var iv = st.interview;
    if (iv && iv.active && iv.status === 'asked' && seat && iv.seatId === seat.seatId) {
      var ai = GS.el('input', { class: 'gs-input', placeholder: 'Answer the host…' });
      root.appendChild(GS.el('div', { class: 'gs-caption' }, iv.question)); root.appendChild(ai);
      root.appendChild(GS.el('button', { class: 'gs-btn', onclick: function () { GS.act({ type: 'answerInterview', text: ai.value }); } }, 'Tell the host'));
    }
    root.appendChild(seatBar());
    return root;
  }

  // ── host desk (the MC) ────────────────────────────────────────────────────
  function hostDesk() {
    var st = GS.state, board = st.board || {};
    var root = GS.el('div', { class: 'gs-wrap gs-col' }, header());
    root.appendChild(GS.el('div', { class: 'gs-panel', style: 'padding:12px' }, GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-pill' }, 'Phase: ' + (st.phase || 'lobby')),
      board.control ? GS.el('span', { class: 'gs-pill' }, 'Control: ' + (showId() === 'family-feud' ? 'Team ' + board.control : seatName(board.control))) : null,
      showId() === 'family-feud' ? GS.el('span', { class: 'gs-pill' }, 'Strikes: ' + (board.strikes || 0)) : null,
      GS.el('span', { class: 'gs-pill' }, 'Round ' + (st.round || 0) + (showId() === 'family-feud' ? '/' + (board.roundsTotal || 3) : '')))));
    var canStart = canStartNow();
    root.appendChild(GS.el('div', { class: 'gs-row', style: 'margin:12px 0' },
      GS.el('button', { class: 'gs-btn gold', disabled: !canStart, onclick: function () { GS.hostCmd(st.phase === 'lobby' ? 'start' : 'continue'); } }, st.phase === 'lobby' ? '▶ Start round' : '▶ Next round'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('intro'); } }, '🎤 Intro'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('reveal'); } }, '💬 React'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { GS.hostCmd('recap'); } }, '↺ Recap'),
      GS.el('a', { class: 'gs-btn ghost', href: '?view=tv&room=' + GS.roomId, target: '_blank' }, '📺 Big Screen')));
    var key = hostKey();
    if (key) root.appendChild(key);
    root.appendChild(actingAsRow());
    root.appendChild(interviewControls());
    root.appendChild(GS.controls.hostPanel(showId()));
    root.appendChild(podiumAdmin());
    root.appendChild(captionBar());
    return root;
  }

  function hostKey() {
    var board = GS.state.board || {};
    var list = GS.el('div', { class: 'gs-hostlist' });
    if (showId() === 'jeopardy') {
      var clue = activeClueOf(board);
      if (clue) list.appendChild(GS.el('div', { class: 'a up' }, GS.el('span', {}, clue.clue), GS.el('span', {}, clue.answer)));
      if (board.final) list.appendChild(GS.el('div', { class: 'a' }, GS.el('span', {}, 'FINAL: ' + board.final.clue), GS.el('span', {}, board.final.answer)));
      if (!clue && !board.final) return null;
    } else {
      if (!(board.answers || []).length) return null;
      board.answers.forEach(function (a, i) {
        list.appendChild(GS.el('div', { class: 'a' + (a.revealed ? ' up' : '') },
          GS.el('span', {}, (i + 1) + '. ' + a.text), GS.el('span', {}, a.points + (a.revealed ? ' ✓' : ''))));
      });
    }
    return GS.el('div', { class: 'gs-panel', style: 'padding:12px' },
      GS.el('div', { class: 'gs-muted', style: 'margin-bottom:6px' }, 'Answer key (host eyes only)'), list);
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
    function addPodium(team) { GS.api.post('/podium', { roomId: GS.roomId, team: team, name: 'Team ' + team + ' ' + (GS.teamSeats(team).length + 1) }).then(function () { GS.poll(); }); }
    var box = GS.el('div', { class: 'gs-panel', style: 'padding:12px' }, GS.el('div', { class: 'gs-row' },
      GS.el('span', { class: 'gs-muted' }, 'Add hotseat podium:'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { addPodium('A'); } }, '+ Team A'),
      GS.el('button', { class: 'gs-btn ghost', onclick: function () { addPodium('B'); } }, '+ Team B')));
    var grid = GS.el('div', { class: 'gs-podiums' });
    var st = GS.state, buzz = st.buzz || {};
    GS.players().forEach(function (s) {
      var col = GS.el('div', { class: 'gs-podium' }, P.tile(s), GS.el('div', { class: 'plabel' }, s.name + ' (' + (s.team || '?') + ')'));
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

  // ── audience (watch + react) ──────────────────────────────────────────────
  function audience() {
    var root = tv();
    var box = GS.el('div', { class: 'gs-reacts' });
    ['👏', '😂', '😮', '🔥', '❤️'].forEach(function (e) { box.appendChild(GS.el('button', { onclick: function () { floatEmoji(e); } }, e)); });
    root.appendChild(box);
    return root;
  }

  function floatEmoji(e) {
    var f = GS.el('div', { class: 'gs-float', style: 'left:' + (20 + Math.random() * 60) + '%;bottom:80px' }, e);
    document.body.appendChild(f); setTimeout(function () { f.remove(); }, 2400);
  }

  // ── lobby (join / host a new game) ────────────────────────────────────────
  function lobby() {
    var chosen = { t: 'A' };
    var box = GS.el('div', { class: 'gs-panel', style: 'padding:20px;max-width:520px;margin:20px auto' });
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
    // Show picker comes from the server catalog — a new show appears here automatically.
    var catalog = (GS.shows && GS.shows.length) ? GS.shows
      : [{ id: 'family-feud', title: 'Family Feud' }, { id: 'jeopardy', title: 'Jeopardy' }];
    var showSel = GS.el('select', { class: 'gs-input' });
    catalog.forEach(function (s) { showSel.appendChild(GS.el('option', { value: s.id }, s.title + (s.tagline ? ' — ' + s.tagline : ''))); });
    function host() {
      GS.api.post('/rooms', { showId: showSel.value }).then(function (r) {
        if (r.body && r.body.room) location.search = '?view=host&room=' + r.body.room.roomId;
        else GS.toast((r.body && r.body.error) || 'Could not start a game');
      });
    }
    box.appendChild(GS.el('div', { class: 'gs-col' }, code, GS.el('div', { class: 'gs-center gs-muted' }, 'Pick your team (team games only)'), teamSel,
      GS.el('button', { class: 'gs-btn blue', onclick: join }, 'Join game')));
    box.appendChild(GS.el('hr', { style: 'border-color:rgba(255,255,255,.12);margin:18px 0' }));
    box.appendChild(GS.el('div', { class: 'gs-col' }, GS.el('div', { class: 'gs-center gs-muted' }, 'Choose a show'), showSel,
      GS.el('button', { class: 'gs-btn gold', style: 'width:100%', onclick: host }, '🎬 Host a new game')));
    return box;
  }

  function help() {
    return GS.el('div', { class: 'gs-wrap gs-panel', style: 'padding:24px;max-width:720px;margin:24px auto' },
      GS.el('h2', { class: 'gs-brand' }, 'How to play'),
      GS.el('p', {}, 'One person hosts (the Host Desk). Everyone else joins from their phone with the 6-letter code and picks a team.'),
      GS.el('ul', {},
        GS.el('li', {}, 'Put the Big Screen on a TV — it shows the board, the podiums, and the host.'),
        GS.el('li', {}, 'Face-off: first to BUZZ answers. The top answer (or the higher one) wins control.'),
        GS.el('li', {}, 'Your team calls out answers. Three strikes and the other team can steal.'),
        GS.el('li', {}, 'Show yourself as a live camera, an avatar, or just your name — your call.'),
        GS.el('li', {}, 'Watch on the TV and use your phone as the clicker, or play it all on one screen.')));
  }

  // ── render dispatcher (one synced state → the right layout) ────────────────
  GS.render = function () {
    P.syncCamera();
    if (GS.view === 'help') { GS.mount(help()); return; }
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
