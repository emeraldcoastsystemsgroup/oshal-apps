/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (game-show-host, SPLIT). The Host Desk was 37 controls in one 2,000px column, so opening question authoring or Show tools pushed Next round 900px away mid-round. It is now two parts in this file (moved out of gs-surfaces.js, which neared its line budget). The live desk: one header row (? and ⋯ More with Show setup, Rehearsal, Big Screen), the status pills (with a quiet "Voice off, captions only" when the host voice returned no audio, DS-41), one primary Next round with Intro, React and Recap beside it, then the answer key on the left (its rows force-reveal through the existing override) and Clock, Board fixes, Cutaways and the Show tools drawer (hotseat, interview) on the right; on a phone a bottom bar switches Board, Clock, Cutaways and More. Show setup is a full sheet opened from the desk: the show, your own questions as one row per answer (Answer, Points, Also accept), the podiums and the computer players. "+ Team A" adds the podium directly with an automatic name, as before (no prompt).
 */

/* global window, document */
(function () {
  'use strict';
  var GS = window.GS;
  var U = function () { return GS.surf; };
  var deskTab = 'board';

  // ── status ────────────────────────────────────────────────────────────────
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

  function statusRow() {
    var st = GS.state, board = st.board || {};
    return GS.el('div', { class: 'gs-row gs-desk-status' },
      GS.el('span', { class: 'gs-pill' }, 'Phase: ' + (st.phase || 'lobby')),
      board.control ? GS.el('span', { class: 'gs-pill' }, 'Control: ' + (GS.show && GS.show.teams ? 'Team ' + board.control : U().seatName(board.control))) : null,
      U().showId() === 'family-feud' ? GS.el('span', { class: 'gs-pill' }, 'Strikes: ' + (board.strikes || 0)) : null,
      costChip(),
      GS.voiceOff ? GS.el('span', { class: 'gs-pill gs-voice-off', role: 'status' }, 'Voice off, captions only') : null);
  }

  function deskHeader() {
    var room = GS.roomId;
    return U().header({ code: true, more: [
      { label: 'Show setup', act: openSetup },
      { label: 'Rehearsal', act: function () { window.location.search = '?view=rehearsal&room=' + room; } },
      { label: 'Big Screen (new tab)', act: function () { window.open('?view=tv&room=' + room, '_blank'); } },
    ] });
  }

  /** @description One primary (Start or Next round) in the flat accent; the host's cues beside it. */
  function cueRow() {
    var st = GS.state, canStart = U().canStartNow();
    return GS.el('div', { class: 'gs-row gs-desk-cues' },
      GS.el('button', { type: 'button', class: 'gs-btn primary gs-desk-next', disabled: !canStart, onclick: function () { GS.hostCmd(st.phase === 'lobby' ? 'start' : 'continue'); } },
        st.phase === 'lobby' ? '▶ Start round' : '▶ Next round'),
      GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.hostCmd('intro'); } }, '🎤 Intro'),
      GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.hostCmd('reveal'); } }, '💬 React'),
      GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.hostCmd('recap'); } }, '↺ Recap'));
  }

  function panel(tab, title, children) {
    var box = GS.el('section', { class: 'gs-panel gs-desk-panel', 'data-tab': tab }, title ? GS.el('h3', {}, title) : null);
    children.forEach(function (c) { if (c) box.appendChild(c); });
    return box;
  }

  // ── the hotseat podiums the host drives from the desk while a race is on ──
  function drivePodiums() {
    var st = GS.state, buzz = st.buzz || {};
    if (!buzz.open && !U().isAnswerPhase()) return null;
    var grid = GS.el('div', { class: 'gs-podiums' });
    GS.players().forEach(function (s) {
      if (s.npc || s.me) return;
      var col = GS.el('div', { class: 'gs-podium' }, GS.presence.tile(s), GS.el('div', { class: 'plabel' }, s.name + (s.team ? ' (' + s.team + ')' : '')));
      if (buzz.open) col.appendChild(GS.el('button', { type: 'button', class: 'gs-btn gold', onclick: function () { GS.act({ type: 'buzz', serial: buzz.serial }, s.seatId); } }, 'Buzz'));
      if (U().isAnswerPhase()) {
        var inp = GS.el('input', { class: 'gs-input', placeholder: 'answer', 'aria-label': 'Answer for ' + s.name });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && inp.value.trim()) { GS.answer(inp.value.trim(), s.seatId); inp.value = ''; } });
        col.appendChild(inp);
      }
      grid.appendChild(col);
    });
    return grid.childNodes.length ? grid : null;
  }

  // ── Show tools: hotseat and interview ─────────────────────────────────────
  var toolsOpen = false;
  function actingAsRow() {
    var sel = GS.el('select', { class: 'gs-input', id: 'gs-actas', onchange: function (e) { GS.actAs = e.target.value || null; GS.render(); } });
    sel.appendChild(GS.el('option', { value: '' }, 'myself'));
    GS.players().forEach(function (s) {
      var opt = GS.el('option', { value: s.seatId }, s.name);
      if (GS.actAs === s.seatId) opt.setAttribute('selected', 'selected');
      sel.appendChild(opt);
    });
    return GS.el('div', { class: 'gs-row' }, GS.el('label', { for: 'gs-actas', class: 'gs-muted' }, 'Hotseat — acting as'), sel);
  }

  function interviewControls() {
    var iv = GS.state.interview, box = GS.el('div', { class: 'gs-row' });
    if (iv && iv.active) {
      box.appendChild(GS.el('span', { class: 'gs-muted' }, 'Interview: ' + iv.status));
      if (iv.status === 'answered') box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn blue', onclick: function () { GS.hostCmd('interview-react'); } }, 'React to answer'));
      box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.act({ type: 'endInterview' }); } }, 'End interview'));
      return box;
    }
    var sel = GS.el('select', { class: 'gs-input', id: 'gs-interview' });
    GS.players().forEach(function (s) { sel.appendChild(GS.el('option', { value: s.seatId }, s.name)); });
    box.appendChild(GS.el('label', { for: 'gs-interview', class: 'gs-muted' }, 'Interview'));
    box.appendChild(sel);
    box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { if (sel.value) GS.hostCmd('interview-ask', { seatId: sel.value }); } }, 'Ask'));
    return box;
  }

  function toolsDrawer() {
    var body = GS.el('div', { class: 'gs-col', style: 'display:' + (toolsOpen ? 'flex' : 'none') }, actingAsRow(), interviewControls());
    var toggle = GS.el('button', { type: 'button', class: 'gs-btn ghost', 'aria-expanded': toolsOpen ? 'true' : 'false', onclick: function () {
      toolsOpen = !toolsOpen; body.style.display = toolsOpen ? 'flex' : 'none'; toggle.setAttribute('aria-expanded', toolsOpen ? 'true' : 'false');
    } }, '🔧 Show tools — hotseat, interview');
    return GS.el('div', { class: 'gs-col gs-desk-tools' }, toggle, body);
  }

  function cutaways() {
    if (!GS.cutaways) return null;
    var row = GS.el('div', { class: 'gs-row gs-cutaway-preview' });
    GS.cutaways.items.forEach(function (entry) {
      row.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.cutaways.preview(entry.id); } }, entry.label));
    });
    return row;
  }

  function phoneBar() {
    var bar = GS.el('nav', { class: 'gs-desk-bar', 'aria-label': 'Host Desk sections' });
    [['board', 'Board'], ['clock', 'Clock'], ['cutaways', 'Cutaways'], ['more', 'More']].forEach(function (t) {
      bar.appendChild(GS.el('button', { type: 'button', 'aria-pressed': deskTab === t[0] ? 'true' : 'false', onclick: function () { deskTab = t[0]; GS.render(); } }, t[1]));
    });
    return bar;
  }

  /**
   * @description The live Host Desk: a console that fits one screen, the answer key on the left and the controls on the right.
   * @returns {HTMLElement} The desk.
   */
  GS.hostDesk = function () {
    var showId = U().showId();
    var root = GS.el('div', { class: 'gs-wrap gs-col gs-desk', 'data-tab': deskTab }, deskHeader(), statusRow(), cueRow());
    var left = GS.el('div', { class: 'gs-col' }), right = GS.el('div', { class: 'gs-col' });
    var extras = GS.activeShowUi().hostExtras && GS.activeShowUi().hostExtras();
    left.appendChild(panel('board', null, [GS.activeShowUi().hostKey() || GS.el('p', { class: 'gs-muted' }, 'The answer key shows here once a round is on the board.'), extras, drivePodiums()]));
    right.appendChild(panel('clock', 'Clock and fixes', [GS.controls.hostPanel(showId)]));
    right.appendChild(panel('cutaways', 'Cutaways', [cutaways()]));
    right.appendChild(panel('more', 'More', [toolsDrawer(),
      GS.el('div', { class: 'gs-row' }, GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: openSetup }, '⚙ Show setup'),
        GS.el('a', { class: 'gs-btn ghost', href: '?view=tv&room=' + GS.roomId, target: '_blank' }, '📺 Big Screen'))]));
    root.appendChild(GS.el('div', { class: 'gs-desk-grid' }, left, right));
    root.appendChild(U().captionBar());
    root.appendChild(phoneBar());
    return root;
  };

  // ── Show setup (a full sheet, before the show) ────────────────────────────
  var draft = { question: '', rows: [{}, {}, {}, {}], json: '' };
  function field(attrs, key, row) {
    var inp = GS.el('input', Object.assign({ class: 'gs-input' }, attrs));
    inp.value = row ? (row[key] || '') : (draft[key] || '');
    inp.addEventListener('input', function () { if (row) row[key] = inp.value; else draft[key] = inp.value; });
    return inp;
  }

  /** @description Feud: one row per answer. Other shows: their generated-JSON shape. @returns {?object} The content, or null. */
  function manualContent() {
    if (U().showId() !== 'family-feud') { try { return draft.json.trim() ? JSON.parse(draft.json) : null; } catch (_e) { return null; } }
    var answers = draft.rows.map(function (r) {
      return { text: String(r.text || '').trim(), points: Number(r.points) || 0,
        aliases: String(r.aliases || '').split(',').map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean) };
    }).filter(function (a) { return a.text; });
    if (!draft.question.trim() || answers.length < 3) return null;
    return { question: draft.question.trim(), answers: answers };
  }

  function questionsSection() {
    var box = GS.el('section', { class: 'gs-setup-part' }, GS.el('h3', {}, '✍ Use my own questions'));
    if (U().showId() !== 'family-feud') {
      var ta = GS.el('textarea', { class: 'gs-input', rows: '6', 'aria-label': 'This show\'s questions as JSON', placeholder: 'Paste this show\'s generated-JSON shape here.' });
      ta.value = draft.json; ta.addEventListener('input', function () { draft.json = ta.value; });
      box.appendChild(ta);
    } else {
      box.appendChild(GS.el('label', { class: 'gs-muted', for: 'gs-own-q' }, 'Question'));
      box.appendChild(field({ id: 'gs-own-q', placeholder: 'Name something you find in a kitchen', maxlength: '200' }, 'question'));
      var grid = GS.el('div', { class: 'gs-answer-rows' },
        GS.el('span', { class: 'gs-muted' }, 'Answer'), GS.el('span', { class: 'gs-muted' }, 'Points'), GS.el('span', { class: 'gs-muted' }, 'Also accept'));
      draft.rows.forEach(function (row, i) {
        grid.appendChild(field({ placeholder: i === 0 ? 'Refrigerator' : 'Answer ' + (i + 1), 'aria-label': 'Answer ' + (i + 1) }, 'text', row));
        grid.appendChild(field({ type: 'number', min: '0', placeholder: i === 0 ? '40' : '', 'aria-label': 'Points for answer ' + (i + 1) }, 'points', row));
        grid.appendChild(field({ placeholder: i === 0 ? 'fridge' : '', 'aria-label': 'Also accept for answer ' + (i + 1) }, 'aliases', row));
      });
      box.appendChild(grid);
      if (draft.rows.length < 8) box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { draft.rows.push({}); GS.sheets.refresh(); } }, '+ Add an answer'));
    }
    var can = U().canStartNow();
    box.appendChild(GS.el('button', { type: 'button', class: 'gs-btn primary', disabled: !can, onclick: function () {
      var content = manualContent();
      if (!content) { GS.toast(U().showId() === 'family-feud' ? 'Add the question and at least three answers.' : 'Could not read that — check the format.'); return; }
      GS.hostCmd('manual', { content: content }).then(function (r) {
        if (r.body && r.body.ok) { draft = { question: '', rows: [{}, {}, {}, {}], json: '' }; GS.sheets.close(); }
      });
    } }, 'Play my questions'));
    if (!can) box.appendChild(GS.el('p', { class: 'gs-muted' }, 'You can play your own questions before the show and between rounds.'));
    return box;
  }

  function addPodium(team) {
    var count = team ? GS.teamSeats(team).length : GS.players().length;
    return GS.api.post('/podium', { roomId: GS.roomId, team: team, name: (team ? 'Team ' + team + ' ' : 'Player ') + (count + 1) })
      .then(function () { return GS.poll(); }).then(GS.sheets.refresh);
  }
  function addNpc(team, skill) {
    return GS.api.post('/podium', { roomId: GS.roomId, team: team, npc: skill }).then(function () { return GS.poll(); }).then(GS.sheets.refresh);
  }
  function removePodium(seatId) {
    return GS.api.post('/podium/remove', { roomId: GS.roomId, seatId: seatId }).then(function (r) {
      if (r.body && r.body.ok === false) GS.toast(r.body.error || 'Could not remove that podium.');
      return GS.poll();
    }).then(GS.sheets.refresh);
  }

  function podiumsSection() {
    var teams = !!(GS.show && GS.show.teams);
    var box = GS.el('section', { class: 'gs-setup-part' }, GS.el('h3', {}, 'Podiums and computer players'));
    var list = GS.el('div', { class: 'gs-col' });
    GS.players().forEach(function (s) {
      list.appendChild(GS.el('div', { class: 'gs-row gs-setup-seat' }, GS.el('span', {}, s.name + (s.team ? ' · Team ' + s.team : '') + (s.npc ? ' · computer' : '')),
        s.me ? null : GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { removePodium(s.seatId); } }, 'Remove')));
    });
    if (!GS.players().length) list.appendChild(GS.el('p', { class: 'gs-muted' }, 'Nobody is at a podium yet.'));
    box.appendChild(list);
    var add = GS.el('div', { class: 'gs-row' }, GS.el('span', { class: 'gs-muted' }, 'Add a hotseat podium'));
    (teams ? ['A', 'B'] : [null]).forEach(function (t) {
      add.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { addPodium(t); } }, t ? '+ Team ' + t : '+ Podium'));
    });
    box.appendChild(add);
    var skill = GS.el('select', { class: 'gs-input', id: 'gs-npc-skill' });
    [['sharp', '🎯 Sharp (good)'], ['casual', '🙂 Casual'], ['wild', '🎲 Wildcard']].forEach(function (o) { skill.appendChild(GS.el('option', { value: o[0] }, o[1])); });
    var npc = GS.el('div', { class: 'gs-row' }, GS.el('label', { for: 'gs-npc-skill', class: 'gs-muted' }, 'Computer player'), skill);
    (teams ? ['A', 'B'] : [null]).forEach(function (t) {
      npc.appendChild(GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { addNpc(t, skill.value); } }, t ? '+ 🤖 Team ' + t : '+ 🤖 AI player'));
    });
    var solo = U().soloNightButton();
    if (solo) npc.appendChild(solo);
    box.appendChild(npc);
    box.appendChild(actingAsRow());
    return box;
  }

  function setupBody() {
    var title = (GS.show && GS.show.title) || 'Game Show';
    return GS.el('div', { class: 'gs-col gs-setup' },
      GS.el('section', { class: 'gs-setup-part' }, GS.el('h3', {}, 'The show'),
        GS.el('div', { class: 'gs-row' }, GS.el('b', {}, title), GS.el('span', { class: 'gs-muted' }, 'Round ' + (GS.state.round || 0) + ' · code ' + ((GS.room && GS.room.joinCode) || '')),
          GS.el('button', { type: 'button', class: 'gs-btn ghost', onclick: function () { GS.newGameItem().act(); } }, 'Pick another show'))),
      questionsSection(), podiumsSection());
  }

  /** @description Show setup: the full sheet the host fills in before the show. @returns {void} */
  function openSetup() { GS.sheets.custom({ title: 'Show setup', body: setupBody, full: true }); }
  GS.openShowSetup = openSetup;
})();
