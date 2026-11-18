/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Collapsible right-rail Sports Quant Concierge client (F22/F24): surface-bridge context publishing, quick prompt chips, voice/TTS composer controls, inline sports-quant bot requests, and approval-card presentation for confirm-gated actions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.12.2 (Roger, 2026-11-16, "for the last time": every concierge is the core Jarvis chat window, with its model menu). The rail no longer draws a chat of its own (its log, message box, prompt chips, microphone and speaker buttons and fallback approval card are gone): it holds the kernel's one chat window as Sports Quant's concierge (/shared/ui/js/jarvis-chat-frame.js), with its model menu, New conversation, Recent conversations, Files, Tap to talk, Keep trying, Read replies aloud and the kernel's own cards. The board the old rail sent as context keys the kernel never read (activeTab, followedTeams, currentEventId, upcomingGamesCount) now rides on every turn as screen_state, in words: the tab, the followed teams, the game in the Preview tab with its event id, and the games the Games tab lists. After a turn, and after a card the person approves in the window, the Games or Record tab on screen is read again, as before. The three starter prompts and the help line are handed to the window; its Close hides the rail and the header's Concierge button brings it back. The surface context the page publishes to the shell is unchanged.
 */
(function initSportsQuantConcierge() {
  'use strict';

  if (window.AppView && typeof window.AppView.active === 'function' && window.AppView.active()) return;

  var BOT_NAME = 'sports-quant';
  var APP_ID = 'sports-edge';
  var TITLE = 'Sports Quant';
  var HELP = 'Ask Sports Quant about tonight’s lines, model vs book edge, closing-line value, or outlier-trimmed ROI. Pick actions require your approval.';
  var PROMPTS = ['Which games have edge tonight?', 'Does the model hold up without top winners?', 'Summarize recent pick ROI'];
  var TABS = { teams: 'My Teams', games: 'Games', preview: 'Preview', fantasy: 'Fantasy', record: 'Record' };
  var rail = document.getElementById('conciergeRail');
  var toggleBtn = document.getElementById('conciergeToggle');
  if (!rail || !toggleBtn) return;

  var bridgeClient = null;

  function setOpen(open) {
    document.body.setAttribute('data-concierge', open ? 'open' : 'closed');
    toggleBtn.setAttribute('aria-expanded', String(Boolean(open)));
  }

  function activeTab() {
    var activeTabBtn = document.querySelector('nav button[aria-selected="true"]');
    return activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'games';
  }

  /** The board as the shell's surface bridge has always received it (ambient state for the shell, not a chat turn). */
  function currentBoardContext() {
    var st = window.state || {};
    var followed = Array.isArray(st.followed) ? st.followed.map(function (f) { return f.league + ':' + f.team; }) : [];
    return {
      app: APP_ID,
      activeTab: activeTab(),
      followedTeams: followed,
      currentEventId: st.currentEvent || null,
      upcomingGamesCount: Array.isArray(st.games) ? st.games.length : 0,
    };
  }

  function followedLine(st) {
    var teams = Array.isArray(st.followed) ? st.followed : [];
    if (!teams.length) return 'Followed teams: none yet.';
    return 'Followed teams (' + teams.length + '): ' + teams.slice(0, 60).map(function (f) {
      var name = f.displayName && f.displayName !== f.team ? ' (' + f.displayName + ')' : '';
      return String(f.league || '').toUpperCase() + ' ' + f.team + name;
    }).join('; ') + '.';
  }

  /** What the Games tab lists: its games, or the words it shows in their place (never a count it did not read). */
  function gamesLine() {
    var list = document.getElementById('gamelist');
    var rows = list ? list.querySelectorAll('.gamerow').length : 0;
    if (rows) return 'Games tab: ' + rows + ' upcoming game' + (rows === 1 ? '' : 's') + ' for the followed teams.';
    var words = list ? String(list.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!words || /^loading/i.test(words)) return 'Games tab: the upcoming games are not read yet.';
    return 'Games tab: no upcoming games listed. It says: ' + words.slice(0, 400);
  }

  function eventLine(st) {
    var g = st.currentEvent;
    if (!g || typeof g !== 'object') return 'Game in the Preview tab: none yet (a game opens there from the Games tab).';
    var when = g.date ? new Date(g.date) : null;
    var day = when && isFinite(when.getTime())
      ? when.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return 'Game in the Preview tab: ' + [g.awayTeam + ' @ ' + g.homeTeam, String(g.league || 'nfl').toUpperCase(),
      'event ' + g.eventId, day, g.venue].filter(Boolean).join(', ') + '.';
  }

  /** The board on screen, handed to the window before every turn: the kernel reads it as what the person sees. */
  function screenState() {
    var st = window.state || {};
    var tab = TABS[activeTab()] || activeTab();
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_e) { zone = ''; }
    var screen = { title: 'Sports Edge', tab: tab, text: ['Sports Edge, ' + tab + ' tab.', followedLine(st), gamesLine(), eventLine(st)].join('\n') };
    if (zone) screen.timezone = zone;
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

  /** What a turn or an approved card may have changed: the Games or Record tab the person is looking at. */
  function refreshHostBoard() {
    try {
      if (typeof window.loadGames === 'function' && !document.getElementById('tab-games').hidden) window.loadGames();
      if (typeof window.loadRecord === 'function' && !document.getElementById('tab-record').hidden) window.loadRecord();
    } catch (_e) { /* host refresh optional */ }
  }

  function mountWindow() {
    import('/shared/ui/js/jarvis-chat-frame.js').then(function (mod) {
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
      rail.textContent = 'The Sports Quant conversation could not be loaded. Reload the page to try again.';
    });
  }

  document.body.classList.add('has-concierge');
  setOpen(window.innerWidth >= 960);
  mountWindow();

  toggleBtn.addEventListener('click', function () {
    setOpen(document.body.getAttribute('data-concierge') !== 'open');
  });
  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {
    b.addEventListener('click', function () { setTimeout(publishBridgeContext, 20); });
  });
  // An approved card in the window is announced on this page (the mount passes the window's event on).
  window.addEventListener('oshal-package-tool-done', refreshHostBoard);
  connectSurfaceBridge();
})();
