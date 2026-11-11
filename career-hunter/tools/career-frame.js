/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career opens as its own application (Roger, 2026-11-10: "a full application by itself ... full screen, custom navigation, thoughtful layout", in the Little Monsters format). Loaded by every Career page. When the page is the top window, or the cockpit frames it, this frame takes the whole window (the cockpit's header, rail, status bar and chat rail are hidden; the floating assistant stays), wears Career's own skin, and draws one top bar: the brand, a link for each section the person is admitted to, More, their saved-jobs chip and their name. A section with several pages shows them in a row under the bar; a phone gets a bottom bar of Home, Search, Job Board, Resume and More. Every link comes from the person's own ribbon profile (the Intelligent Career front door when the cockpit has it open or the person can open it, else Career's own), so nothing appears that they cannot open. The cockpit is asked to change screens (app-navigate), so its own record of the open screen, its address and the assistant's view of it stay true. A Career page hosted by anything else (an experience home, another Career page) is left exactly as it was.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The bar follows a job search, in a job seeker's words: Home, Find jobs, My jobs, Applications, Résumé, Profile & contacts, then More. An independent judge found the first bar (Job Search, Resume, Presence, Submission activity, Recruiters, Insights, taken from the manifest's groups) was a list of tools with internal names. The sections are now named here, in order; a section shows when the person can open one of its pages, and any page not in a section is under More. The phone's bottom bar is Home, Find jobs, My jobs, Applications and More.
 */
(function (root) {
  'use strict';

  var BRAND = 'Intelligent Career';
  /** The profiles whose bar this frame draws: the front door that borrows Career's pages, then Career by itself. */
  var PROFILES = ['intelligent-career', 'career-hunter'];
  var PROFILE_PATH = '/api/ui/profile?name=';
  var USER_PATH = '/api/auth/user';
  var STATS_PATH = '/api/career-hunter/jobs/stats';
  var HOME_PATH = '/api/career-hunter/home';
  var MARK_PATH = '/api/career-hunter/static/career-mark.svg';
  var CSS_PATH = '/api/career-hunter/static/career-frame.css';
  var TOOL_PREFIX = 'tool-';
  var PHONE_QUERY = '(max-width: 720px)';
  var CACHE_KEY = 'career-frame-v1';
  var HOST_STYLE_ID = 'career-frame-host-style';
  /** A page's own path prefix; anything else in the profile (Portrait Studio) is another application's page. */
  var OWN_PREFIX = '/api/career-hunter/';
  /**
   * The bar, in the order of a job search and in a job seeker's words. Each section lists the pages it holds by their
   * short names, lead page first; a section appears when the person can open at least one of its pages. Any other page
   * the person's profile lists is under More, so a tile the manifest adds later is never lost.
   */
  var SECTIONS = [
    ['Home', ['home']],
    ['Find jobs', ['search']],
    ['My jobs', ['board']],
    ['Applications', ['submission-activity']],
    ['Résumé', ['resume-studio', 'experience-library', 'strengthen']],
    ['Profile & contacts', ['profile-studio', 'portrait-studio', 'social-workspace', 'recruiters']],
  ];
  /** The phone's bottom bar: view and the word under its icon. */
  var BOTTOM = [['home', 'Home'], ['search', 'Find jobs'], ['board', 'My jobs'], ['submission-activity', 'Applications']];
  /** Addresses that are a page of a section without being its tile. */
  /** The query shape the cockpit passes on to a screen it opens (its sanitizeToolQuery). */
  var HOST_QUERY = /^[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*(?:&[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*)*$/;
  var ALIASES = { '/api/career-hunter': 'board', '/api/career-hunter/approvals': 'board', '/api/career-hunter/board': 'board' };
  var ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
    board: '<rect x="4" y="5" width="4.5" height="14" rx="1.2"/><rect x="9.75" y="5" width="4.5" height="9" rx="1.2"/><rect x="15.5" y="5" width="4.5" height="11.5" rx="1.2"/>',
    'resume-studio': '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
    'submission-activity': '<path d="M4 12.5 9 17 20 6.5"/><path d="M4 6.5h9M4 9.5h5"/>',
    more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  };

  /**
   * @description Escape text for safe insertion into HTML.
   * @param {unknown} value Any value; null and undefined become an empty string.
   * @returns {string} The escaped string.
   */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * @description Reduce the person's ribbon profile to the pages the frame can link. Only same-origin API paths are
   * kept: the profile is the server's own answer, already filtered to what this person may open.
   * @param {object|null} profile The `profile` object of the ribbon profile answer.
   * @returns {Array<{view:string,id:string,label:string,href:string,group:string,section:string,own:boolean}>} Ordered entries.
   */
  function navEntries(profile) {
    var items = profile && profile.ribbon && Array.isArray(profile.ribbon.items) ? profile.ribbon.items : [];
    return items.filter(function (item) {
      var id = String(item && item.id || ''), href = item && item.toolUi && item.toolUi.iframeUrl;
      return id.indexOf(TOOL_PREFIX) === 0 && typeof href === 'string' && /^\/(?!\/)[A-Za-z0-9/_.?=&%-]+$/.test(href);
    }).map(function (item) {
      var id = String(item.id), href = String(item.toolUi.iframeUrl);
      return { view: viewOf(id, item.toolUi.visibilityToolName), id: id, label: String(item.label || id), href: href, group: String(item.group || ''),
        section: String(item.section || 'top'), own: href.indexOf(OWN_PREFIX) === 0 };
    });
  }

  /**
   * @description A page's short name, the same whichever profile lists it: `tool-career-search` and
   * `tool-career-hunter--career-search` are both `search`; `tool-social--social-workspace` is `social-workspace`.
   * @param {string} id The ribbon item's id.
   * @param {string} [toolName] The member's own name for the tool, when the profile gives it.
   * @returns {string} The view name.
   */
  function viewOf(id, toolName) {
    var name = String(toolName || String(id).slice(TOOL_PREFIX.length).split('--').pop());
    return name.indexOf('career-') === 0 ? name.slice('career-'.length) : name;
  }

  /**
   * @description A query string in the strict shape the cockpit passes on: every value percent-encoded, no plus signs.
   * @param {Array<[string, string]>} pairs Names and values; empty values are left out.
   * @returns {string} The query, without a question mark.
   */
  function strictQuery(pairs) {
    return pairs.filter(function (pair) { return String(pair[1] || '').length; }).map(function (pair) {
      return pair[0] + '=' + encodeURIComponent(String(pair[1])).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
    }).join('&');
  }

  /**
   * @description Arrange the person's pages as the bar shows them: the sections of a job search in order, each opening
   * on its lead page, and every other page under More.
   * @param {Array<object>} entries Entries from navEntries.
   * @returns {{primary:Array<{key:string,label:string,lead:object,pages:Array<object>}>,more:Array<object>}} The layout.
   */
  function sections(entries) {
    var placed = {}, primary = [];
    SECTIONS.forEach(function (section) {
      var pages = section[1].map(function (view) { return entries.filter(function (entry) { return entry.view === view; })[0]; }).filter(Boolean);
      if (!pages.length) return;
      pages.forEach(function (page) { placed[page.view] = true; });
      primary.push({ key: section[0], label: section[0], lead: pages[0], pages: pages });
    });
    return { primary: primary, more: entries.filter(function (entry) { return !placed[entry.view]; }) };
  }

  /**
   * @description The entry that serves the page being shown.
   * @param {Array<object>} entries Entries from navEntries.
   * @param {string} pathname The page's location.pathname.
   * @param {string} [search] The page's location.search.
   * @returns {object|null} The entry, or null when the page belongs to no tile.
   */
  function activeEntry(entries, pathname, search) {
    var path = String(pathname || '').replace(/\/+$/, ''), params = new URLSearchParams(String(search || ''));
    var view = path === HOME_PATH && params.get('open') ? params.get('open') : ALIASES[path] || '';
    if (path === '/api/career-hunter/search-ui' && params.get('view') === 'matches') view = 'board';
    for (var i = 0; i < entries.length; i++) {
      if (view ? entries[i].view === view : String(entries[i].href).split('?')[0].replace(/\/+$/, '') === path) return entries[i];
    }
    return null;
  }

  /**
   * @description Who frames this page: nothing ('top'), the cockpit ('cockpit'), or something else ('other').
   * @param {Window} win The page's window.
   * @returns {'top'|'cockpit'|'other'} The host.
   */
  function hostKind(win) {
    try {
      if (win.top === win.self) return 'top';
      return win.parent.document.querySelector('.cockpit-body, #ribbonContainer') ? 'cockpit' : 'other';
    } catch (_) { return 'other'; }
  }

  /**
   * @description The first name to show for the signed-in person.
   * @param {object|null} user The /api/auth/user answer.
   * @returns {string} A first name, or an empty string.
   */
  function firstName(user) {
    var name = user && (user.displayName || (user.user && (user.user.displayName || user.user.name))) || '';
    return String(name).trim().split(/\s+/)[0] || '';
  }

  /**
   * @description The one count the bar carries: interviews under way when there are any, else saved jobs.
   * @param {object|null} stats The /jobs/stats answer.
   * @returns {{count:number,label:string,query:string}|null} The chip, or null when there is nothing to count.
   */
  function stageChip(stats) {
    var n = function (value) { return Number.isFinite(Number(value)) ? Number(value) : 0; };
    if (!stats) return null;
    if (n(stats.interviewing) > 0) return { count: n(stats.interviewing), label: 'interviewing', query: 'view=interviewing' };
    if (n(stats.saved) > 0) return { count: n(stats.saved), label: 'saved', query: 'view=saved' };
    return null;
  }

  /**
   * @description The rule that gives a Career page the cockpit's whole window. It holds only while the cockpit is
   * showing a Career page, so a page of another application gets the cockpit's own header and rail back by itself.
   * @returns {string} The stylesheet text.
   */
  function hostStyle() {
    var showing = 'body:has(.tool-view-container > iframe[src^="' + OWN_PREFIX + '"])';
    var hidden = ['.header-bar', '.status-bar', '#ribbonContainer', '.ribbon-backdrop', '.chat-panel', '.panel-resize-handle', '.tool-view-header',
      '.zen-exit-btn', '#workspaceNavigation', '#workspaceNavigationMore'];
    return hidden.map(function (selector) { return showing + ' ' + selector; }).join(', ') + ' { display: none !important; } ' +
      showing + ' .cockpit-body { padding: 0 !important; gap: 0 !important; height: 100vh !important; height: 100dvh !important; } ' +
      showing + ' :is(.main-content, .tool-view-container) { border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; } ' +
      showing + ' > .visitor-back { bottom: calc(12px + var(--oshal-app-bottom-inset, 0px) + env(safe-area-inset-bottom, 0px)) !important; }';
  }

  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.more) + '</svg>'; }

  /**
   * @description Create the frame for a page. The pure helpers above run anywhere; this needs a browser window.
   * @param {Window} win The window to frame.
   * @returns {object} The frame: kind, entries, navigate, mount.
   */
  function createFrame(win) {
    var w = win, doc = w.document, kind = hostKind(w), cache = { app: '', entries: null, user: null, stats: null }, loading = null;
    var off = doc.documentElement.getAttribute('data-career-frame') === 'off' || new URLSearchParams(w.location.search).get('frame') === 'off';
    var on = !off && kind !== 'other';

    function getJson(path) {
      return w.fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
        .catch(function () { return null; });
    }
    function remembered() { try { return JSON.parse(w.sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } }
    function remember() { try { w.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ app: cache.app, entries: cache.entries, name: firstName(cache.user) })); } catch (_) { /* storage is a convenience */ } }
    /** @description The application the cockpit has open (its address says), when it is one this frame draws. */
    function hostApp() {
      if (kind !== 'cockpit') return '';
      try { var params = new URLSearchParams(w.parent.location.search), app = params.get('app') || params.get('profile') || ''; return PROFILES.indexOf(app) !== -1 ? app : ''; }
      catch (_) { return ''; }
    }
    /** @description The person's entries from the open application's profile, or from the first of the frame's profiles they can open. */
    function readProfile() {
      var named = hostApp() || (remembered() || {}).app || '';
      var order = named ? [named].concat(PROFILES.filter(function (name) { return name !== named; })) : PROFILES.slice();
      var next = function (index) {
        if (index >= order.length) return Promise.resolve({ app: '', entries: [] });
        return getJson(PROFILE_PATH + encodeURIComponent(order[index])).then(function (answer) {
          var entries = navEntries(answer && answer.profile ? answer.profile : null);
          return entries.length ? { app: order[index], entries: entries } : next(index + 1);
        });
      };
      return next(0);
    }
    /** @description The person's entries, name and counts, read once for the page. */
    function load() {
      if (!loading) loading = Promise.all([readProfile(), getJson(USER_PATH), getJson(STATS_PATH)]).then(function (answers) {
        cache.app = answers[0].app; cache.entries = answers[0].entries;
        cache.user = answers[1]; cache.stats = answers[2];
        if (cache.entries.length) remember();
        return cache;
      });
      return loading;
    }

    /** @description Give this page the cockpit's whole window (see hostStyle). */
    function takeWindow() {
      if (kind !== 'cockpit') return;
      try {
        var host = w.parent.document;
        host.title = BRAND;
        if (host.getElementById(HOST_STYLE_ID) || !host.head) return;
        var style = host.createElement('style');
        style.id = HOST_STYLE_ID; style.textContent = hostStyle();
        host.head.appendChild(style);
      } catch (_) { /* a host this page cannot read keeps its own chrome */ }
    }

    /**
     * @description Open one of the person's pages. The cockpit is asked to change screens so its own state follows;
     * another application's page opens inside Career's host page, so the bar stays.
     * @param {object} entry The entry to open.
     * @param {string} [query] A query string for the page, without the question mark.
     * @returns {void}
     */
    function open(entry, query) {
      if (!entry) return;
      if (!entry.own) { w.location.href = HOME_PATH + '?open=' + encodeURIComponent(entry.view); return; }
      // The cockpit carries a query only in its own strict shape; any other query loads the page here instead.
      if (kind === 'cockpit' && (!query || HOST_QUERY.test(query) && query.length <= 512)) {
        var message = { type: 'app-navigate', tool: entry.id.slice('tool-'.length) };
        if (query) message.query = query;
        try { w.parent.postMessage(message, w.location.origin); return; } catch (_) { /* fall through to a plain load */ }
      }
      w.location.href = entry.href + (query ? (entry.href.indexOf('?') === -1 ? '?' : '&') + query : '');
    }
    /** @description Open a page by its view name; unknown or unadmitted names do nothing. */
    function navigate(view, query) {
      return load().then(function (state) { open(state.entries.filter(function (entry) { return entry.view === view; })[0], query); });
    }

    function hrefOf(entry) { return entry.own ? entry.href : HOME_PATH + '?open=' + encodeURIComponent(entry.view); }
    function link(entry, active, label) {
      return '<a href="' + esc(hrefOf(entry)) + '" data-cf-view="' + esc(entry.view) + '"' + (active && active.view === entry.view ? ' aria-current="page"' : '') + '>' + esc(label || entry.label) + '</a>';
    }
    function backLink() { return '<a class="cf-all-applications" href="/cockpit/?screen=applications" target="_top">← All applications</a>'; }
    /** @description The More menu: pages of sections that did not fit, each section's other pages, then the rest. */
    function menuHtml(layout, active) {
      var groups = layout.primary.filter(function (part) { return part.pages.length > 1; }).map(function (part) {
        return '<div class="cf-menu-label">' + esc(part.label) + '</div>' + part.pages.map(function (page) { return link(page, active); }).join('');
      }).join('');
      var rest = layout.more.length ? '<div class="cf-menu-label">More</div>' + layout.more.map(function (entry) { return link(entry, active); }).join('') : '';
      return backLink() + '<div class="cf-spill"></div>' + groups + rest;
    }
    function sideHtml(state, layout, active) {
      var chip = stageChip(state.stats), board = state.entries.filter(function (entry) { return entry.view === 'board'; })[0];
      var name = firstName(state.user) || state.name || '';
      var inMore = Boolean(active && layout.more.some(function (entry) { return entry.view === active.view; }));
      var menu = menuHtml(layout, active);
      return '<details class="cf-more cf-more-desk"><summary' + (inMore ? ' aria-current="page"' : '') + '>More ▾</summary><div class="cf-menu">' + menu + '</div></details>' +
        (chip && board ? '<a class="cf-chip" href="' + esc(board.href + '?' + chip.query) + '" data-cf-view="board" data-cf-query="' + esc(chip.query) + '"><b>' + chip.count + '</b> ' + esc(chip.label) + '</a>' : '') +
        (name ? '<span class="cf-pill">' + esc(name) + '</span>' : '') +
        '<details class="cf-more cf-more-phone"><summary aria-label="More">⋯</summary><div class="cf-menu">' + (name ? '<div class="cf-menu-label">' + esc(name) + '</div>' : '') + backLink() + '</div></details>';
    }
    function barHtml(state, layout, active) {
      var home = state.entries.filter(function (entry) { return entry.view === 'home'; })[0] || (layout.primary[0] && layout.primary[0].lead);
      var current = function (part) { return active && part.pages.some(function (page) { return page.view === active.view; }); };
      return '<a class="cf-brand" href="' + esc(home ? hrefOf(home) : HOME_PATH) + '"' + (home ? ' data-cf-view="' + esc(home.view) + '"' : '') + '><img src="' + MARK_PATH + '" alt=""><span>' + BRAND + '</span></a>' +
        '<nav aria-label="' + BRAND + '">' + layout.primary.map(function (part) {
          return '<a href="' + esc(hrefOf(part.lead)) + '" data-cf-view="' + esc(part.lead.view) + '"' + (current(part) ? ' aria-current="page"' : '') + '>' + esc(part.label) + '</a>';
        }).join('') + '</nav><div class="cf-side">' + sideHtml(state, layout, active) + '</div>';
    }
    /** @description The row of the current section's pages, or an empty string when the section is one page. */
    function subnavHtml(layout, active) {
      var part = active ? layout.primary.filter(function (candidate) { return candidate.pages.some(function (page) { return page.view === active.view; }); })[0] : null;
      if (!part || part.pages.length < 2) return '';
      return '<span class="cf-subnav-label">' + esc(part.label) + '</span>' + part.pages.map(function (page) { return link(page, active); }).join('');
    }
    function bottomHtml(state, layout, active) {
      var four = BOTTOM.map(function (pair) { var entry = state.entries.filter(function (candidate) { return candidate.view === pair[0]; })[0]; return entry ? [entry, pair[1]] : null; }).filter(Boolean);
      if (!four.length) return '';
      var shown = four.map(function (pair) { return pair[0].view; });
      var links = four.map(function (pair) {
        return '<a href="' + esc(hrefOf(pair[0])) + '" data-cf-view="' + esc(pair[0].view) + '"' + (active && active.view === pair[0].view ? ' aria-current="page"' : '') + '>' + icon(pair[0].view) + '<span>' + esc(pair[1]) + '</span></a>';
      }).join('');
      var parts = layout.primary.map(function (part) { return { label: part.label, pages: part.pages.filter(function (page) { return shown.indexOf(page.view) === -1; }) }; })
        .filter(function (part) { return part.pages.length; });
      var rest = layout.more.filter(function (entry) { return shown.indexOf(entry.view) === -1; });
      var sheet = parts.map(function (part) { return (part.pages.length > 1 ? '<div class="cf-menu-label">' + esc(part.label) + '</div>' : '') + part.pages.map(function (page) { return link(page, active); }).join(''); }).join('') +
        (rest.length ? '<div class="cf-menu-label">More</div>' + rest.map(function (entry) { return link(entry, active); }).join('') : '') + backLink();
      var inSheet = Boolean(active && shown.indexOf(active.view) === -1);
      return links + '<details class="cf-bottom-more"><summary' + (inSheet ? ' aria-current="page"' : '') + '>' + icon('more') + '<span>More</span></summary><div class="cf-sheet" role="menu">' + sheet + '</div></details>';
    }

    /** @description Move the bar's last links into More until the rest fit, so no label is ever clipped. */
    function fit(bar) {
      var nav = bar.querySelector('nav'), spill = bar.querySelector('.cf-more-desk .cf-spill');
      if (!nav || !spill) return;
      while (spill.firstChild) nav.appendChild(spill.firstChild);
      var phone = w.matchMedia && w.matchMedia(PHONE_QUERY).matches, moved = [];
      while (!phone && nav.children.length > 1 && nav.scrollWidth > nav.clientWidth + 1) moved.unshift(nav.removeChild(nav.lastElementChild));
      moved.forEach(function (a) { spill.appendChild(a); });
      var summary = bar.querySelector('.cf-more-desk > summary');
      if (spill.querySelector('a[aria-current]')) summary.setAttribute('aria-current', 'page');
    }
    /** @description Keep the frame's measures true for the page's own layout, and the host's assistant above the phone bar. */
    function measure(bar, sub, bottom) {
      var phone = w.matchMedia && w.matchMedia(PHONE_QUERY).matches, style = doc.documentElement.style;
      style.setProperty('--cf-top', (bar.offsetHeight + (sub && !sub.hidden ? sub.offsetHeight : 0)) + 'px');
      style.setProperty('--cf-bottom', (phone && bottom ? bottom.offsetHeight : 0) + 'px');
      if (kind !== 'cockpit') return;
      try {
        var host = w.parent.document.documentElement;
        if (phone && bottom && bottom.offsetHeight) { host.style.setProperty('--oshal-app-bottom-inset', bottom.offsetHeight + 'px'); host.setAttribute('data-career-inset', ''); }
        else if (host.hasAttribute('data-career-inset')) { host.style.removeProperty('--oshal-app-bottom-inset'); host.removeAttribute('data-career-inset'); }
      } catch (_) { /* a host this page cannot read */ }
    }
    function releaseHost() {
      if (kind !== 'cockpit') return;
      try {
        var host = w.parent.document.documentElement;
        if (host.hasAttribute('data-career-inset')) { host.style.removeProperty('--oshal-app-bottom-inset'); host.removeAttribute('data-career-inset'); }
      } catch (_) { /* nothing was set */ }
    }
    /** @description One open menu at a time; a tap outside or Escape closes it; a frame link opens through open(). */
    function wire() {
      var menus = function () { return doc.querySelectorAll('.cf-topbar details[open], .cf-bottombar details[open]'); };
      doc.addEventListener('click', function (event) {
        menus().forEach(function (menu) { if (!menu.contains(event.target)) menu.removeAttribute('open'); });
        var a = event.target.closest ? event.target.closest('a[data-cf-view]') : null;
        if (!a || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        var entry = (cache.entries || []).filter(function (candidate) { return candidate.view === a.getAttribute('data-cf-view'); })[0];
        if (!entry || !entry.own || kind !== 'cockpit') return;
        event.preventDefault();
        open(entry, a.getAttribute('data-cf-query') || '');
      });
      doc.addEventListener('keydown', function (event) { if (event.key === 'Escape') menus().forEach(function (menu) { menu.removeAttribute('open'); }); });
    }

    function draw(parts, state) {
      var active = activeEntry(state.entries, w.location.pathname, w.location.search), layout = sections(state.entries);
      parts.bar.innerHTML = barHtml(state, layout, active);
      var sub = subnavHtml(layout, active);
      parts.sub.innerHTML = sub; parts.sub.hidden = !sub;
      if (sub) parts.sub.setAttribute('aria-label', layout.primary.filter(function (part) { return part.pages.some(function (page) { return active && page.view === active.view; }); })[0].label);
      var bottom = bottomHtml(state, layout, active);
      parts.bottom.innerHTML = bottom; parts.bottom.hidden = !bottom;
      doc.body.classList.toggle('cf-has-bottombar', Boolean(bottom));
      fit(parts.bar); measure(parts.bar, parts.sub, bottom ? parts.bottom : null);
    }
    /** @description Draw the frame: at once from what this tab last saw, then from the person's fresh profile. */
    function mount() {
      if (!on || !doc.body || doc.querySelector('.cf-topbar')) return Promise.resolve(null);
      takeWindow();
      var parts = { bar: doc.createElement('header'), sub: doc.createElement('nav'), bottom: doc.createElement('nav') };
      parts.bar.className = 'cf-topbar'; parts.sub.className = 'cf-subnav'; parts.sub.hidden = true;
      parts.bottom.className = 'cf-bottombar'; parts.bottom.setAttribute('aria-label', BRAND + ' sections'); parts.bottom.hidden = true;
      doc.body.insertBefore(parts.sub, doc.body.firstChild); doc.body.insertBefore(parts.bar, parts.sub); doc.body.appendChild(parts.bottom);
      var before = remembered();
      if (before && Array.isArray(before.entries)) { cache.entries = before.entries; draw(parts, { entries: before.entries, user: null, stats: null, name: before.name }); }
      else parts.bar.innerHTML = '<a class="cf-brand" href="' + HOME_PATH + '"><img src="' + MARK_PATH + '" alt=""><span>' + BRAND + '</span></a>';
      wire();
      var queued = 0;
      w.addEventListener('resize', function () { if (!queued) queued = w.requestAnimationFrame(function () { queued = 0; fit(parts.bar); measure(parts.bar, parts.sub, parts.bottom.hidden ? null : parts.bottom); }); });
      w.addEventListener('pagehide', releaseHost);
      return load().then(function (state) { draw(parts, state); parts.bar.setAttribute('data-cf-ready', ''); return parts.bar; });
    }

    if (on) {
      doc.documentElement.setAttribute('data-career-frame', kind);
      if (!doc.querySelector('link[href="' + CSS_PATH + '"]')) { var sheet = doc.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = CSS_PATH; (doc.head || doc.documentElement).appendChild(sheet); }
      takeWindow();
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { mount(); }); else mount();
    }
    return { kind: kind, on: on, load: load, navigate: navigate, open: open, mount: mount, entries: function () { return load().then(function (state) { return state.entries; }); } };
  }

  var exported = { esc: esc, strictQuery: strictQuery, viewOf: viewOf, navEntries: navEntries, sections: sections, activeEntry: activeEntry, hostKind: hostKind, firstName: firstName, stageChip: stageChip, hostStyle: hostStyle, createFrame: createFrame };
  if (root && root.document && !root.CareerFrame) root.CareerFrame = Object.assign(createFrame(root), exported);
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : null);
