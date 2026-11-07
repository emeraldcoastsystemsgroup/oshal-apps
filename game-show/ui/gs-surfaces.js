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
 * 2026-10-12 21:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 9: each show poster is a real button (type=button) whose text names the show and 'Host this show', not a clickable div: a keyboard, a screen reader and the concierge's screen snapshot could not tell 'Host this show' was something to press.
 * 2026-10-30 22:30:00 | maintainer@emeraldcoastsystemsgroup.com    | Roger never got a game started against the computer, so the front door is rebuilt around that. A poster is one press: it opens the room, seats you, fills the podiums with computer players and starts (GS.startSolo). You play at your own seat instead of a second podium held in the page's memory, which removes both freezes: pressing Start before Solo night, and any Reload or Resume. The dock always says what just happened, whose move it is and what to do, shows progress while the host writes the board, offers only buttons that do something, and ends the game with the winner and Play again. The broadcast set stays a dark studio under every theme, because its text followed a light theme onto a dark set.
 * 2026-10-30 23:10:00 | maintainer@emeraldcoastsystemsgroup.com    | From the live test of the first build: the keyboard is in the answer box when it appears (not on a touch screen, where the on-screen keyboard would cover the board), and a phone clicker waits while the host judges, because a second answer sent meanwhile was silently dropped.
 * 2026-11-06 08:40:00 | maintainer@emeraldcoastsystemsgroup.com    | UX audit 2026-11-06 (stage, clicker, review). Stage: the duplicate chip header is gone (show, round and code are on the set's marquee once), the marquee carries a 44px ? (How to play, a sheet) and ⋯ More with New game (it asks in the page first), the dock's ⚙ is 44px, the host's line is the dock's first line rather than a lower third under the dock, 🙂 You opens the You sheet, and a viewer without a podium gets one Join this game while a buzzer is open. Clicker: one header row (show, round, clock, ?), no New game, Team and Show me as are in the You sheet, the dome steps aside while the answer box (field plus a full-width 52px Answer) sits at the top. Lobby: a Recent games row (last three ended games: when, winner, top score, Play again) above the Hall of fame, from the same /leaderboard read. The game views keep the zoom lock and are marked data-ds-game; the lobby, Host Desk, Help and Rehearsal unlock it (DS-42). The Host Desk moved to gs-host-desk.js.
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

  /**
   * @description One header row: the show, the round and the clock, then the 44px ? (How to play, a sheet) and an
   *   optional ⋯ More menu. A contestant's clicker carries no New game (only the stage and the host leave a room).
   * @param {{brand:boolean, more:Array, code:boolean}} [opts] - The app name, More rows, the join code chip.
   * @returns {HTMLElement} The header row.
   */
  function header(opts) {
    opts = opts || {};
    return GS.el('div', { class: 'gs-top' },
      opts.brand === false ? null : GS.el('div', { class: 'gs-brand' }, '★ GAME SHOW'),
      GS.roomId ? GS.el('span', { class: 'gs-chip' }, (GS.show && GS.show.title) || 'Family Feud') : null,
      GS.state.round ? GS.el('span', { class: 'gs-chip' }, 'Round ' + GS.state.round) : null,
      GS.controls.countdown(),
      GS.el('div', { class: 'gs-grow' }),
      opts.code && GS.room ? GS.el('span', { class: 'gs-chip' }, 'Code ' + (GS.room.joinCode || '')) : null,
      GS.helpButton(),
      opts.more ? GS.moreMenu(opts.more) : null);
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
    return GS.el('div', { class: 'gs-col gp-studio', 'data-ds-game': '' },
      GS.play.frame(center, { dock: null, mood: mood }),
      GS.el('div', { class: 'gp-bug' }, '★ GAME SHOW'));
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

  // The guess the host is judging right now: typed answers can take a few seconds to rule on.
  var judging = null;
  function answerBox(actorSeatId, placeholder, big) {
    var inp = GS.el('input', { class: 'gs-input', placeholder: placeholder || ui().answerPlaceholder || 'Type or say your answer…', maxlength: '120' });
    function send() {
      var guess = inp.value.trim();
      if (!guess || judging) return;
      judging = guess;
      inp.value = '';
      GS.render();
      var done = function () { judging = null; GS.render(); };
      GS.answer(guess, actorSeatId).then(done, done);
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    // The phone clicker's answer: the field on its own line, then one 52px Answer across the screen.
    if (big) {
      return GS.el('div', { class: 'gs-col gs-answer big' }, inp,
        GS.el('div', { class: 'gs-row' }, micButton(inp, send), GS.el('button', { class: 'gs-btn primary gs-answer-go', onclick: send }, 'Answer')));
    }
    return GS.el('div', { class: 'gs-row gs-answer', style: 'justify-content:center' }, inp,
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
    var box = GS.el('div', { class: 'gs-col gs-center gp-play' });
    if (!GS.canPlay()) {
      // A viewer with no podium is never shown a race with nothing to press: one way in, the You sheet.
      if (buzz.open && !isOver()) box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn primary gp-join', onclick: function () { GS.sheets.open('you'); } }, 'Join this game'));
      return box;
    }
    var seat = GS.actingSeat();
    if (buzz.open && (st.board && (st.board.missed || []).indexOf(seat) < 0)) {
      var locked = buzz.lockedBy === seat;
      box.appendChild(GS.el('button', { class: 'gs-dockbuzz' + (locked ? ' locked' : ''), onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, GS.actAs); } }, locked ? '✋ YOU\'RE IN — ANSWER!' : '🔔 BUZZ IN'));
    }
    var extra = ui().controls && ui().controls(GS.actAs);
    if (extra) box.appendChild(extra);
    if (isAnswerPhase() && ui().canType(seat) && !judging) box.appendChild(answerBox(GS.actAs));
    if (isWagerPhase() && ui().canWager(seat)) box.appendChild(wagerBox(st.phase));
    interviewBox(box);
    return box;
  }

  // ── stage (desktop / solo: the broadcast frame, controls in the dock) ──────
  // Your team and how you are shown live in the You sheet (gs-sheets.js), outside the re-rendered page.
  function youButton() {
    if (!GS.mySeat() || GS.actAs) return null;
    return GS.el('button', { type: 'button', class: 'gs-btn ghost gp-you-btn', onclick: function () { GS.sheets.open('you'); } }, '🙂 You');
  }

  // What the owner is waiting on (the host writing a board can take 20 seconds), so a press never looks ignored.
  var busyNote = null;
  function setBusy(note) { busyNote = note; if (GS.render) GS.render(); }

  function runHost(mode, note) {
    setBusy(note);
    var done = function () { setBusy(null); };
    return GS.hostCmd(mode).then(done, done);
  }

  /** @description The show has ended and its room is closed. */
  function isOver() { return GS.state.phase === 'outro' || !!(GS.room && GS.room.status === 'ended'); }

  /** @description The result in words, from the same standings the podiums show. */
  function resultLine() {
    var rows = (GS.scoreboard || []).slice().sort(function (a, b) { return (Number(b.score) || 0) - (Number(a.score) || 0); });
    if (!rows.length) return 'That\'s the show!';
    var top = rows[0], second = rows[1];
    if (second && Number(second.score) === Number(top.score)) return 'It\'s a tie at ' + top.score + '!';
    if (top.team) return top.name + ' wins, ' + top.score + ' to ' + (second ? second.score : 0) + '!';
    var mine = top.seatId === GS.actingSeat();
    return (mine ? 'You win' : top.name + ' wins') + ' with $' + top.score + '!';
  }

  /** @description Open a fresh room for a show and let it seat the computer players and start itself. */
  function playAgainst(showIdToPlay) {
    return GS.api.post('/rooms', { showId: showIdToPlay }).then(function (r) {
      if (r.body && r.body.room) location.search = '?view=stage&room=' + r.body.room.roomId + '&solo=1';
      else GS.toast((r.body && r.body.error) || 'Could not start a game');
    });
  }

  /** @description The dock's top: what just happened, then whose move it is and what to do. */
  function coachBlock() {
    var box = GS.el('div', { class: 'gp-coachbox' });
    // The host's line lives here on the stage (the set draws no separate lower third under the dock); otherwise the news.
    var said = GS.play.hostLine(), news = GS.play.news();
    if (said && !busyNote) box.appendChild(GS.el('div', { class: 'gp-news gp-hostline' }, GS.el('span', { class: 'mc' }, 'HOST'), said));
    else if (news && !busyNote) box.appendChild(GS.el('div', { class: 'gp-news' }, news));
    else box.appendChild(GS.el('div', { class: 'gp-news', 'aria-hidden': 'true' }));   // keeps the tools' row
    var now = busyNote ? { wait: busyNote } : (judging ? { wait: '⏳ The host is checking “' + judging + '”…' } : promptNow());
    if (now) box.appendChild(GS.el('div', { class: 'gp-coach' + (now.you ? ' you' : '') }, now.you || now.wait));
    return box;
  }

  /** @description This seat's prompt, or the show's between-rounds word. */
  function promptNow() {
    var st = GS.state;
    if (isOver()) return { you: '🏆 ' + resultLine() };
    if (GS.gameOver) return { you: '🏁 ' + resultLine() };
    if ((st.phase || 'lobby') === 'lobby') {
      if (!GS.players().length && GS.isOwner()) return { wait: 'Nobody is at a podium yet.' };
      return GS.isOwner() ? { you: 'Everyone is seated. Start the show when you are ready.' } : { wait: 'You are in. Waiting for the host to start the show…' };
    }
    var said = ui().prompt(GS.canPlay() ? GS.actingSeat() : null);
    if (said) return said;
    return canStartNow() ? (GS.isOwner() ? { you: 'Round over. Press the button when you are ready for the next one.' } : { wait: 'Round over. Waiting for the host…' }) : null;
  }

  /** @description The owner's one next step, and only when it does something: no dead Next round mid-game. */
  function ownerActions() {
    var st = GS.state, row = GS.el('div', { class: 'gs-row gs-center gp-owner-strip' });
    if (!GS.isOwner() || busyNote) return null;
    if (isOver()) {
      if (GS.players().some(function (s) { return s.npc; })) {
        row.appendChild(GS.el('button', { class: 'gs-btn gold', onclick: function () { playAgainst(showId()); } }, '▶ Play again'));
      }
      row.appendChild(GS.el('a', { class: 'gs-btn ghost', href: '?view=stage&lobby=1' }, '☰ Pick another game'));
      return row;
    }
    if (GS.gameOver) {
      row.appendChild(GS.el('button', { class: 'gs-btn gold', onclick: function () { runHost('continue', 'The host is closing the show…'); } }, '🏁 Finish the show'));
      var more = ui().stageExtras && ui().stageExtras();
      if (more) row.appendChild(more);
      return row;
    }
    if ((st.phase || 'lobby') === 'lobby') {
      if (!GS.players().length) row.appendChild(soloNightButton());
      else row.appendChild(GS.el('button', { class: 'gs-btn gold', onclick: function () { runHost('start', STARTING); } }, '▶ Start the show'));
      return row;
    }
    if (!canStartNow()) return null;
    row.appendChild(GS.el('button', { class: 'gs-btn gold', onclick: function () { runHost('continue', 'The host is writing the next round…'); } },
      '▶ ' + (ui().nextLabel(st.phase) || 'Next round')));
    return row;
  }

  var STARTING = 'The host is writing tonight\'s game. This can take about 20 seconds…';

  /** @description The lobby's other road: friends join on their own phones with the code. */
  function friendsHint() {
    if ((GS.state.phase || 'lobby') !== 'lobby' || GS.players().length || !GS.isOwner() || busyNote) return null;
    return GS.el('div', { class: 'gp-hint' }, 'Playing with friends instead? They open Game Show on their phone and enter code ',
      GS.el('b', {}, (GS.room && GS.room.joinCode) || ''), '. The Start button appears when someone joins.');
  }

  function stageDock() {
    var dock = GS.el('div', { class: 'gs-col gs-center gp-dockcol' });
    var tools = GS.el('div', { class: 'gp-tools' });
    if (GS.isOwner()) tools.appendChild(GS.el('a', { class: 'gs-icon', href: '?view=host&room=' + GS.roomId, title: 'Host desk', 'aria-label': 'Host desk' }, '⚙'));
    var you = youButton();
    if (you) tools.appendChild(you);
    dock.appendChild(tools);
    dock.appendChild(coachBlock());
    dock.appendChild(playerControls());
    var actions = ownerActions();
    if (actions) dock.appendChild(actions);
    var hint = friendsHint();
    if (hint) dock.appendChild(hint);
    return dock;
  }

  function stage() {
    if (needLobby()) return GS.el('div', { class: 'gs-col' }, header(), lobby());
    // The show, round and code are drawn once, on the set's marquee; its ? and ⋯ More sit there too.
    var root = GS.el('div', { class: 'gs-col gp-studio', 'data-ds-game': '' });
    if (isOver()) confetti();
    var tools = GS.el('div', { class: 'gp-marquee-tools' }, GS.helpButton(), GS.moreMenu([GS.newGameItem()]));
    root.appendChild(GS.play.frame(ui().board(), { dock: stageDock(), tools: tools }));
    return root;
  }

  // Playing alone: you step up to your own seat (on Team A in a team show, with a good
  // player beside you) and computer players fill the rest of the stage. Your own seat, not
  // a second podium: a second one lived only in this page's memory, so a reload lost it.
  function soloNight() {
    var teams = GS.show && GS.show.teams;
    var bots = teams
      ? [{ team: 'A', npc: 'sharp' }, { team: 'A', npc: 'casual' },
         { team: 'B', npc: 'sharp' }, { team: 'B', npc: 'casual' }, { team: 'B', npc: 'wild' }]
      : [{ npc: 'sharp' }, { npc: 'casual' }, { npc: 'wild' }];
    var must = function (r) {
      if (!r.body || r.body.ok === false) throw new Error((r.body && r.body.error) || 'Could not set up the game.');
      return r;
    };
    var chain = GS.api.post('/seat', { roomId: GS.roomId, role: 'player', team: teams ? 'A' : null }).then(must);
    bots.forEach(function (spec) {
      chain = chain.then(function () { return GS.api.post('/podium', { roomId: GS.roomId, team: spec.team || null, npc: spec.npc }).then(must); });
    });
    return chain.then(function () { return GS.poll(); }).then(function () { if (GS.render) GS.render(); });
  }

  /**
   * @description One press to a running game against the computer: seat everyone, then start.
   *   ?solo=1 only ever acts on the owner's still-empty room, so a reload cannot seat anyone twice.
   * @returns {Promise<void>}
   */
  GS.startSolo = function () {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', location.pathname + '?view=stage&room=' + GS.roomId);
    }
    if (busyNote || !GS.isOwner() || (GS.state.phase || 'lobby') !== 'lobby' || GS.players().length) return Promise.resolve();
    setBusy('Setting up your podium and the computer players…');
    return soloNight().then(function () { return runHost('start', STARTING); }).catch(function (err) {
      setBusy(null);
      GS.toast(err.message || 'Could not set up the game.');
    });
  };

  function soloNightButton() {
    if (!GS.isOwner() || GS.players().length) return null;
    return GS.el('button', { class: 'gs-btn gold', onclick: function () { GS.startSolo(); } }, '🤖 Play against the computer');
  }

  // ── clicker (phone companion; honors ?as= hotseat pinning) ────────────────
  // A phone shows status, the buzzer and the answer: team and presence are in the You sheet. While the answer
  // box is open the dome steps aside and the field with a full-width Answer sits at the top.
  function clicker() {
    var root = GS.el('div', { class: 'gs-col gs-clickroot', 'data-ds-game': '' }, header({ brand: false }));
    if (needLobby()) { root.appendChild(lobby()); return root; }
    var st = GS.state, buzz = st.buzz || {};
    var acting = GS.actingSeat();
    var label = GS.actAs ? (seatName(GS.actAs) + ' (hotseat)') : ((GS.mySeat() || {}).name || 'Spectator');
    var team = (GS.seats.filter(function (s) { return s.seatId === acting; })[0] || {}).team;
    root.appendChild(GS.el('div', { class: 'gs-row gs-center gs-clickwho' }, GS.el('span', { class: 'gs-chip' }, label + (team ? ' · Team ' + team : '')), youButton()));
    root.appendChild(captionBar());
    var answering = !!judging || (isAnswerPhase() && ui().canType(acting));
    // The clicker's action region is the phone's dock: the playthrough types answers into '#gs-dock input.gs-input'.
    var dock = GS.el('div', { id: 'gs-dock', class: 'gs-col gs-center' });
    if (judging) dock.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, '⏳ The host is checking “' + judging + '”…'));
    else if (answering) dock.appendChild(answerBox(GS.actAs, null, true));
    var extra = ui().controls && ui().controls(GS.actAs);
    if (extra) dock.appendChild(extra);
    if (isWagerPhase() && ui().canWager(acting)) dock.appendChild(wagerBox(st.phase));
    interviewBox(dock);
    if (answering) root.appendChild(dock);
    var locked = buzz.lockedBy === acting;
    root.appendChild(GS.el('div', { class: 'gs-buzzer' + (answering ? ' collapsed' : '') },
      GS.el('button', { class: 'gs-buzz-btn' + (locked ? ' locked' : ''), disabled: !buzz.open, onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, GS.actAs); } }, locked ? '✋' : 'BUZZ')));
    if (!buzz.open && buzz.lockedBy && buzz.lockedBy !== acting) {
      root.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, seatName(buzz.lockedBy) + ' buzzed first.'));
    }
    if (!answering) root.appendChild(dock);
    return root;
  }

  // ── host desk (the MC): gs-host-desk.js draws it, with these helpers ──────
  GS.surf = { header: header, captionBar: captionBar, canStartNow: canStartNow, showId: showId, seatName: seatName,
    isAnswerPhase: isAnswerPhase, soloNightButton: function () { return soloNightButton(); } };

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
    var root = GS.el('div', { class: 'gs-wrap gs-col', id: 'gs-rehearsal' }, header({ code: true }));
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
  var ART = { 'family-feud': '👨‍👩‍👧‍👦', 'jeopardy': '🧠', 'wheel': '🎡', 'whammy': '😈' };
  function posterWall() {
    // One card per catalog show. The card is one press to a running game against the
    // computer; hosting for friends is the smaller road beside it.
    var catalog = (GS.shows && GS.shows.length) ? GS.shows
      : [{ id: 'family-feud', title: 'Family Feud' }, { id: 'jeopardy', title: 'Jeopardy' }];
    function hostShow(id) {
      GS.api.post('/rooms', { showId: id }).then(function (r) {
        if (r.body && r.body.room) location.search = '?view=stage&room=' + r.body.room.roomId;
        else GS.toast((r.body && r.body.error) || 'Could not start a game');
      });
    }
    var posters = GS.el('div', { class: 'gp-posters' });
    catalog.forEach(function (s) {
      posters.appendChild(GS.el('div', { class: 'gp-poster-wrap', 'data-show': s.id },
        GS.el('button', { type: 'button', class: 'gp-poster', 'data-show': s.id, onclick: function () { playAgainst(s.id); } },
          GS.el('span', { class: 'gp-poster-art', 'aria-hidden': 'true' }, ART[s.id] || '🎬'),
          GS.el('span', { class: 'gp-poster-title' }, s.title),
          GS.el('span', { class: 'gp-poster-tag' }, s.tagline || ''),
          GS.el('span', { class: 'gp-poster-cta' }, '▶ Play against the computer')),
        GS.el('button', { type: 'button', class: 'gp-poster-friends', onclick: function () { hostShow(s.id); } }, '👥 Host for friends instead')));
    });
    return posters;
  }

  function joinPanel() {
    var chosen = { t: 'A' };
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
    return GS.el('div', { class: 'gs-col' },
      GS.el('div', { class: 'gs-center gs-muted' }, 'A friend is hosting? Enter their code.'), code,
      GS.el('div', { class: 'gs-center gs-muted' }, 'Pick your team (team games only)'), teamSel,
      GS.el('button', { class: 'gs-btn blue', onclick: join }, 'Join game'));
  }

  function openGames() {
    // Your open games: resume one, or end it to clear the stage for a new show.
    var mine = GS.el('div', { class: 'gs-col', style: 'margin-top:14px' });
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
    return mine;
  }

  function showTitle(id) { return ((GS.shows || []).filter(function (s) { return s.id === id; })[0] || {}).title || id; }

  /**
   * @description The lobby's two rows over the end-of-game score snapshots (GET /leaderboard): Recent games, the
   *   last three ended games as posters (when, who won, the top score) each with one Play again, and the Hall of
   *   fame (#11), the best scores across your ended games. No history, no rows.
   * @returns {{recent:HTMLElement, fame:HTMLElement}} The two containers, filled when the read answers.
   */
  function scoreRows() {
    var recent = GS.el('div', { class: 'gs-col gp-recent-wrap' }), fame = GS.el('div', { class: 'gs-col', style: 'margin-top:14px' });
    GS.api.get('/leaderboard').then(function (r) {
      var entries = (r.body && r.body.entries) || [];
      if (!entries.length) return;
      var games = {};
      entries.forEach(function (e) {
        var key = e.showId + '|' + e.endedAt, g = games[key];
        if (!g || (Number(e.score) || 0) > g.top.score) games[key] = { showId: e.showId, endedAt: e.endedAt, top: { name: e.name, team: e.team, score: Number(e.score) || 0 } };
      });
      var last = Object.keys(games).map(function (k) { return games[k]; })
        .sort(function (a, b) { return (Date.parse(b.endedAt) || 0) - (Date.parse(a.endedAt) || 0); }).slice(0, 3);
      recent.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, 'Recent games'));
      var row = GS.el('div', { class: 'gp-recent' });
      last.forEach(function (g) {
        var when = new Date(g.endedAt);
        row.appendChild(GS.el('div', { class: 'gp-recent-card', 'data-show': g.showId },
          GS.el('span', { class: 'gp-poster-art', 'aria-hidden': 'true' }, ART[g.showId] || '🎬'),
          GS.el('b', {}, showTitle(g.showId)),
          GS.el('span', { class: 'gs-muted' }, Number.isFinite(when.getTime()) ? when.toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''),
          GS.el('span', {}, '🏆 ' + (g.top.team ? 'Team ' + g.top.team : g.top.name) + ' · ' + g.top.score),
          GS.el('button', { type: 'button', class: 'gs-btn primary', onclick: function () { playAgainst(g.showId); } }, 'Play again')));
      });
      recent.appendChild(row);
      fame.appendChild(GS.el('div', { class: 'gs-center gs-muted' }, '🏆 Hall of fame — your table\'s best'));
      entries.forEach(function (e, i) {
        fame.appendChild(GS.el('div', { class: 'gs-row', style: 'justify-content:space-between;align-items:center' },
          GS.el('span', {}, (i + 1) + '. ' + e.name + (e.team ? ' (Team ' + e.team + ')' : '') + ' · ' + showTitle(e.showId)),
          GS.el('span', { class: 'gs-chip' }, String(e.score))));
      });
    }).catch(function () {});
    return { recent: recent, fame: fame };
  }

  function lobby() {
    var box = GS.el('div', { class: 'gs-panel gp-lobby', style: 'padding:20px;max-width:760px;margin:20px auto' });
    box.appendChild(GS.el('div', { class: 'gs-brand', style: 'text-align:center;font-size:26px;margin-bottom:6px' }, '★ GAME SHOW'));
    box.appendChild(GS.el('p', { class: 'gs-center gs-muted' }, 'Pick a game. The computer plays the other podiums, so you can start right now.'));
    box.appendChild(posterWall());
    box.appendChild(openGames());
    box.appendChild(GS.el('hr', { style: 'border-color:var(--gs-line);margin:18px 0' }));
    box.appendChild(joinPanel());
    var scores = scoreRows();
    box.appendChild(scores.recent);
    box.appendChild(scores.fame);
    return box;
  }

  function help() {
    return GS.el('div', { class: 'gs-wrap gs-panel', style: 'padding:24px;max-width:720px;margin:24px auto' },
      GS.el('a', { class: 'gs-btn ghost', style: 'padding:4px 10px', href: '?view=stage' }, '← Back to the games'),
      GS.el('h2', { class: 'gs-brand' }, 'How to play'), GS.helpContent(null));
  }

  // The full-screen game keeps the zoom lock (design standard DS-42, [data-ds-game]); the lobby, the Host Desk,
  // Help and Rehearsal are pages a person may zoom.
  var VIEWPORT_OPEN = 'width=device-width, initial-scale=1', VIEWPORT_GAME = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
  function syncZoom(game) {
    var meta = document.querySelector('meta[name="viewport"]');
    var want = game ? VIEWPORT_GAME : VIEWPORT_OPEN;
    if (meta && meta.getAttribute('content') !== want) meta.setAttribute('content', want);
  }

  // When a box to type in appears, the keyboard should already be in it, so buzzing in and typing is
  // one motion. Not with a touch screen, where it would throw the on-screen keyboard over the board.
  var hadAnswerBox = false;
  function focusNewAnswerBox() {
    var box = document.querySelector('.gp-dock .gp-play input.gs-input');
    var fresh = !!box && !hadAnswerBox;
    hadAnswerBox = !!box;
    var typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (fresh && !typing && window.matchMedia && window.matchMedia('(pointer: fine)').matches) box.focus({ preventScroll: true });
  }

  // ── render dispatcher (one synced state → the right layout) ────────────────
  GS.render = function () {
    if (GS.play) GS.play.sync();
    P.syncCamera();
    if (GS.sheets) GS.sheets.sync();
    if (GS.view === 'help') { syncZoom(false); GS.mount(help()); return; }
    if (GS.view === 'rehearsal') { syncZoom(false); renderRehearsal(); return; }
    if (!GS.roomId) { syncZoom(false); GS.mount(lobby()); return; }
    var node;
    if (GS.view === 'tv') node = tv();
    else if (GS.view === 'host') node = GS.isOwner() && GS.hostDesk ? GS.hostDesk() : stage();
    else if (GS.view === 'clicker') node = clicker();
    else if (GS.view === 'audience') node = audience();
    else node = stage();
    syncZoom(!!(node.hasAttribute && node.hasAttribute('data-ds-game')) || GS.view === 'tv' || GS.view === 'audience');
    GS.mount(node);
    if (GS.play) GS.play.fit();
    focusNewAnswerBox();
  };
})();
