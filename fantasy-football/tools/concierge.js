/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Collapsible right-rail Fantasy Quant Concierge client (F22/F24): surface-bridge context publishing, quick prompt chips, voice/TTS composer controls, inline fantasy-quant bot requests, and approval-card presentation for confirm-gated lineup/waiver actions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.4.2 (Roger, 2026-11-16, "for the last time": every concierge is the core Jarvis chat window, with its model menu). The rail no longer draws a chat of its own (its log, message box, prompt chips, attach, microphone and speaker buttons and fallback approval card are gone): it holds the kernel's one chat window as Fantasy Quant's concierge (/shared/ui/js/jarvis-chat-frame.js), with its model menu, New conversation, Recent conversations, Files, Tap to talk, Keep trying, Read replies aloud and the kernel's own cards. The context the old rail sent as keys the kernel never read (activeView, activeBoard, selectedLeague) now rides on every turn as screen_state, in words: the view (This week or League setup), the board (Lineup, Season, Waivers or Trades), the league on screen with the ids the Fantasy Quant tools take (manualId or leagueId, and the season), the leagues in the League menu, and the board's own words (its headings, figures and table rows; on League setup its sections and the walkthrough's step). After a turn, and after a card the person approves in the window, the board on screen is read again, as an approved card did before. The three starter prompts and the help line are handed to the window; its Close hides the rail and the header's Concierge button brings it back. Under an audience view nothing mounts, as before. The surface context the page publishes to the shell is unchanged.
 */
(function initFantasyQuantConcierge() {
  'use strict';

  if (window.AppView && typeof window.AppView.active === 'function' && window.AppView.active()) return;

  var BOT_NAME = 'fantasy-quant';
  var APP_ID = 'fantasy-football';
  var TITLE = 'Fantasy Quant';
  var HELP = 'Ask Fantasy Quant who to start at flex, best waiver wire upgrades, or your weekly win-probability swing. Lineup and waiver changes require your approval.';
  var PROMPTS = ['Who should I start at flex?', 'Best waiver wire upgrades', 'Matchup win probability breakdown'];
  var BOARDS = { lineup: 'Lineup', season: 'Season', waivers: 'Waivers', trades: 'Trades' };
  /** Characters of the board's own words handed over with a turn (the kernel keeps 10 KiB of a screen). */
  var BOARD_CHARS = 6000;
  var rail = document.getElementById('conciergeRail');
  var toggleBtn = document.getElementById('conciergeToggle');
  if (!rail || !toggleBtn) return;

  var bridgeClient = null;

  function setOpen(open) {
    document.body.setAttribute('data-concierge', open ? 'open' : 'closed');
    toggleBtn.setAttribute('aria-expanded', String(Boolean(open)));
  }

  function activeView() {
    var setup = document.getElementById('setupView');
    return (setup && !setup.hidden) ? 'setup' : 'week';
  }

  function shownBoard() {
    return Object.prototype.hasOwnProperty.call(BOARDS, window.shownKind) ? window.shownKind : 'lineup';
  }

  /** The board as the shell's surface bridge has always received it (ambient state for the shell, not a chat turn). */
  function currentBoardContext() {
    var sel = typeof window.selectedLeague === 'function' ? window.selectedLeague() : null;
    return {
      app: APP_ID,
      activeView: activeView(),
      activeBoard: window.shownKind || 'lineup',
      selectedLeague: sel,
    };
  }

  function squash(words) {
    return String(words == null ? '' : words).replace(/\s+/g, ' ').trim();
  }

  /** The League menu's choice in the words it shows, with the ids the Fantasy Quant tools take. */
  function leagueLine(view) {
    var sel = typeof window.selectedLeague === 'function' ? window.selectedLeague() : null;
    if (!sel) return 'League on screen: none yet (no league is saved; League setup adds one).';
    var menu = document.getElementById('fLeagueSel');
    var option = menu && menu.selectedIndex >= 0 ? menu.options[menu.selectedIndex] : null;
    var how = sel.source === 'manual' ? 'a league typed in by hand, manualId ' : 'an ESPN league, leagueId ';
    return (view === 'setup' ? 'League chosen on This week: ' : 'League on screen: ') + squash(option ? option.textContent : sel.id) +
      '; ' + how + sel.id + ', season ' + sel.season + '.';
  }

  function leaguesLine() {
    var menu = document.getElementById('fLeagueSel');
    var names = menu ? Array.prototype.map.call(menu.options, function (o) { return squash(o.textContent); }).filter(Boolean) : [];
    return names.length ? 'Leagues in the League menu (' + names.length + '): ' + names.join('; ') + '.' : '';
  }

  /** One line of the board: a figure as "label: value", a table row with " / " between its cells, else its words. */
  function boardPart(node) {
    if (node.classList.contains('linebox')) {
      var k = node.querySelector('.k'), v = node.querySelector('.v');
      return squash(k ? k.textContent : '') + ': ' + squash(v ? v.textContent : '');
    }
    if (node.tagName === 'TR') return Array.prototype.map.call(node.children, function (cell) { return squash(cell.textContent); }).filter(Boolean).join(' / ');
    return squash(node.textContent);
  }

  /** The board's own words, as the person reads them: headings, figures, table rows and notes, in page order. */
  function boardWords() {
    var body = document.getElementById('lineupBody');
    if (!body) return 'nothing yet.';
    var lines = Array.prototype.map.call(body.querySelectorAll('h2, h3, .linebox, tr, p'), boardPart).filter(Boolean);
    if (!lines.length) lines = [squash(body.textContent) || 'nothing yet.'];
    var kept = [], used = 0;
    for (var i = 0; i < lines.length; i += 1) {
      if (used + lines[i].length + 1 > BOARD_CHARS) { kept.push('(' + (lines.length - i) + ' more lines of the board are not sent here.)'); break; }
      kept.push(lines[i]);
      used += lines[i].length + 1;
    }
    return kept.join('\n');
  }

  /** League setup in words: its sections and, when the walkthrough is open, which step it is on. */
  function setupLines() {
    var setup = document.getElementById('setupView');
    if (!setup) return [];
    var heads = Array.prototype.map.call(setup.querySelectorAll('.card > h2'), function (h) { return squash(h.textContent); }).filter(Boolean);
    var lines = heads.length ? ['Sections: ' + heads.join('; ') + '.'] : [];
    var wrap = document.getElementById('mFormWrap'), step = document.getElementById('mStepLine'), head = document.querySelector('#mForm .mhead');
    if (wrap && !wrap.hidden && step) lines.push('League walkthrough open: ' + squash(head ? head.textContent : 'Add a league') + ', ' + squash(step.textContent) + '.');
    return lines;
  }

  /** The screen, handed to the window before every turn: the kernel reads it as what the person sees. */
  function screenState() {
    var view = activeView(), board = BOARDS[shownBoard()];
    var lines = [view === 'setup' ? 'Fantasy Football, League setup view.' : 'Fantasy Football, This week view, ' + board + ' board.', leagueLine(view)];
    var menu = leaguesLine();
    if (menu) lines.push(menu);
    lines = lines.concat(view === 'setup' ? setupLines() : ['Board on screen:', boardWords()]);
    var screen = { title: 'Fantasy Football', tab: view === 'setup' ? 'League setup' : board, text: lines.join('\n') };
    try { var zone = Intl.DateTimeFormat().resolvedOptions().timeZone; if (zone) screen.timezone = zone; } catch (_e) { /* no zone known */ }
    return screen;
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

  /** What a turn or an approved card may have changed: the board on screen, read again. */
  function refreshHostBoard() {
    try {
      var l = typeof window.selectedLeague === 'function' ? window.selectedLeague() : null;
      if (l && typeof window.loadBoard === 'function') {
        window.loadBoard(l.source, l.season, l.id, window.shownKind || 'lineup');
      } else if (typeof window.loadManual === 'function') {
        window.loadManual();
      }
    } catch (_e) { /* host refresh optional */ }
  }

  function mountWindow() {
    import('/shared/ui/js/jarvis-chat-frame.js').then(function (mod) {
      if (!mod || typeof mod.mountJarvisChat !== 'function') throw new Error('no chat window here');
      mod.mountJarvisChat(rail, {
        app: APP_ID, bot: BOT_NAME, title: TITLE, lazy: true,
        prompts: PROMPTS.map(function (prompt) { return { label: prompt, prompt: prompt }; }), help: HELP,
        chatHost: {
          prepare: function () { return Promise.resolve({ screen_state: screenState() }); },
          refresh: function () { refreshHostBoard(); return Promise.resolve(); },
        },
        onClose: function () { setOpen(false); },
      });
    }).catch(function () {
      rail.textContent = 'The Fantasy Quant conversation could not be loaded. Reload the page to try again.';
    });
  }

  document.body.classList.add('has-concierge');
  setOpen(window.innerWidth >= 960);
  mountWindow();

  toggleBtn.addEventListener('click', function () {
    setOpen(document.body.getAttribute('data-concierge') !== 'open');
  });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#fBoards, #fToSetup, #fToWeek')) {
      setTimeout(publishBridgeContext, 30);
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'fLeagueSel') setTimeout(publishBridgeContext, 30);
  });
  // An approved card in the window is announced on this page (the mount passes the window's event on).
  window.addEventListener('oshal-package-tool-done', refreshHostBoard);
  connectSurfaceBridge();
})();
