/**
 * LM Mascot + page frame — the shared Little Monsters runtime (served at /api/education/mascot.js).
 *
 * The Little Monster mascot that appears in all education bot UIs, plus window.LM, the page frame
 * every surface uses for navigation, identity, notices and its standalone top bar.
 * Has 4 mood states with contextual quotes. Embedded as a floating
 * companion in the corner of each bot's interface.
 *
 * Usage: Include this script in any bot HTML page, then call:
 *   const mascot = new LMMascot(document.getElementById('mascot-container'));
 *   mascot.setMood('happy');
 *   mascot.showQuote('Great job on that quiz!');
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — mascot component
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Carry the page frame (window.LM) in this already-bound script so the authorization catalog stays at its installed revision; every surface loads it
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The frame renders the profile as served: the server filters tools per caller through the app's tool-keys route, so the client keeps no teacher-only list
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | First visit completes school setup: when /me answers "complete school setup" the frame makes the screen's open-time write (the caller's own reminder check, the one non-GET every school role is bound to), which provisions the learner, then reads /me again. Native reads never provision, so a new person was stuck at that message inside the app
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Keep SAT & ACT visible in the primary school navigation.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | When embedded, the page frame owns the full window (zen-mode; the host header, ribbon, status bar and chat rail hidden, never the Jarvis orb) and navigates its own frame instead of relaying to the host.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | The frame hides the cockpit's menu, so the More menu carries the way back: All applications, top-level, for everyone but a child-safe kiosk (Roger, 2026-11-03: the main menu now opens every Little Monsters screen, and a person who follows one had no way back but the browser's Back button).
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | UX audit LM-FRAME (all 14 screens): on a phone ONE top bar (mascot + name at the left, the Level ring and ⋯ at the right; ⋯ holds All applications first, who is signed in, Voice and Teacher) and a bottom bar of Home, Tutor, Flashcards, Games and More (a sheet with every other section); the nav and its two extra rows are gone there. The host's floating assistant rests above the bottom bar (--oshal-app-bottom-inset) and steps aside on a page that is itself the assistant (body[data-lm-assistant="self"], the Tutor). On a desktop the bar's last links move into More ▾ before any label clips.
 * 9   | maintainer@emeraldcoastsystemsgroup.com     | Planned control (DS-45): 'Parent summary · Not available yet' after the working items of the phone More sheet and the desktop More ▾ (backlog RP-LM-01), greyed and without a handler.
 * 10  | maintainer@emeraldcoastsystemsgroup.com     | The trial check (412x915): the door's floating '← All apps' pill (body > .visitor-back, bottom-left in the host) covered the bottom bar's Home. The host style lifts it by --oshal-app-bottom-inset, the same lift the orb takes.
 * 11  | maintainer@emeraldcoastsystemsgroup.com     | Activate Parent summary in the phone More sheet and desktop More ▾ linking to /api/education/dashboard?view=guardian (RP-LM-01).
 * ---------------------------------------------------------------------------
 *
 * @module lm-mascot
 */

/* global document, window, setTimeout, clearTimeout */

/**
 * Mood definitions with emoji, color, and quote pools.
 * Each mood has contextual quotes that match the student's current activity.
 */
const MOODS = {
  happy: {
    emoji: '\uD83D\uDE0A', // smiling face
    color: '#8b5cf6',
    label: 'Happy',
    quotes: [
      "Hey there! Ready to learn something awesome?",
      "You're doing great! Keep it up!",
      "Every page you read makes you stronger!",
      "I love seeing you study! Let's go!",
      "Knowledge is your superpower!",
      "What are we learning today?",
      "You've got this!",
    ],
  },
  proud: {
    emoji: '\uD83C\uDF1F', // star
    color: '#34d399',
    label: 'Proud',
    quotes: [
      "WOW! You nailed that!",
      "Look at you go! That was impressive!",
      "Your hard work is paying off!",
      "You should be proud of yourself!",
      "That's what I call progress!",
      "You're on fire today!",
      "Keep this up and you'll ace everything!",
    ],
  },
  hyped: {
    emoji: '\uD83D\uDE80', // rocket
    color: '#06b6d4',
    label: 'Hyped',
    quotes: [
      "Let's GOOO! Quiz time!",
      "Streak mode activated! You're unstoppable!",
      "This is going to be amazing!",
      "Level up incoming!",
      "You're building something incredible here!",
      "Three days in a row? Legend!",
      "The momentum is real!",
    ],
  },
  tired: {
    emoji: '\uD83D\uDE34', // sleeping face
    color: '#fbbf24',
    label: 'Tired',
    quotes: [
      "Maybe a quick break? You've earned it.",
      "Even superheroes need rest sometimes.",
      "How about stretching for a minute?",
      "Your brain needs a breather — be right back!",
      "Take 5, then come back stronger.",
      "A short break now = better focus later.",
      "Let's pause. You've been working hard.",
    ],
  },
};

/**
 * LM Mascot component.
 * Renders a floating mascot with mood-based animations and contextual quotes.
 */
class LMMascot {
  /**
   * @param {HTMLElement} container — DOM element to render the mascot into
   * @param {Object} [options]
   * @param {string} [options.initialMood='happy'] — starting mood
   * @param {boolean} [options.showOnLoad=true] — show immediately
   */
  constructor(container, options = {}) {
    this.container = container;
    this.mood = options.initialMood || 'happy';
    // Which monster character to show — defaults to the teal hero; pass
    // `/api/education/mascot.png` for the pink fuzzy monster.
    this.imgSrc = options.imgSrc || LMMascot.IMG_SRC;
    this.quoteTimeout = null;
    this.idleTimeout = null;
    this.render();

    if (options.showOnLoad !== false) {
      this.setMood(this.mood);
      this.startIdleDetection();
    }
  }

  /** Render the mascot HTML structure. */
  render() {
    // When embedded inside the cockpit (an iframe surface), the floating monster
    // concierge bubble is already the single assistant — a second floating mascot
    // here just reads as a stray smiley. Skip rendering the floating mascot in that
    // case (the page still works; lmConfetti and inline use are unaffected).
    try { if (window.top !== window.self) { this.container.innerHTML = ''; this._suppressed = true; return; } } catch (e) { /* cross-origin: treat as embedded */ this.container.innerHTML = ''; this._suppressed = true; return; }
    this.container.innerHTML = `
      <div class="lm-mascot" id="lm-mascot">
        <div class="lm-mascot-body" id="lm-mascot-body">
          <img class="lm-mascot-img" id="lm-mascot-img" src="${this.imgSrc}" alt="Little Monster" draggable="false" />
          <span class="lm-mascot-emoji" id="lm-mascot-emoji"></span>
        </div>
        <div class="lm-mascot-bubble" id="lm-mascot-bubble">
          <span class="lm-mascot-quote" id="lm-mascot-quote"></span>
        </div>
      </div>
    `;

    // Inject styles if not already present
    if (!document.getElementById('lm-mascot-styles')) {
      const style = document.createElement('style');
      style.id = 'lm-mascot-styles';
      style.textContent = LMMascot.CSS;
      document.head.appendChild(style);
    }
  }

  /**
   * Set the mascot's mood. Updates emoji, color, and shows a random quote.
   * @param {string} moodName — one of: happy, proud, hyped, tired
   */
  setMood(moodName) {
    const moodDef = MOODS[moodName] || MOODS.happy;
    this.mood = moodName;

    const emojiEl = document.getElementById('lm-mascot-emoji');
    const bodyEl = document.getElementById('lm-mascot-body');

    if (emojiEl) emojiEl.textContent = moodDef.emoji;
    if (bodyEl) bodyEl.style.borderColor = moodDef.color;

    // Show a random quote from this mood
    const quote = moodDef.quotes[Math.floor(Math.random() * moodDef.quotes.length)];
    this.showQuote(quote);
  }

  /**
   * Show a text quote in the speech bubble. Auto-hides after 5 seconds.
   * @param {string} text — quote to display
   * @param {number} [duration=5000] — ms before auto-hide
   */
  showQuote(text, duration = 5000) {
    const bubbleEl = document.getElementById('lm-mascot-bubble');
    const quoteEl = document.getElementById('lm-mascot-quote');

    if (!bubbleEl || !quoteEl) return;

    quoteEl.textContent = text;
    bubbleEl.classList.add('visible');

    if (this.quoteTimeout) clearTimeout(this.quoteTimeout);
    this.quoteTimeout = setTimeout(() => {
      bubbleEl.classList.remove('visible');
    }, duration);
  }

  /**
   * Start idle detection — if no user activity for 10 minutes, switch to tired mood.
   */
  startIdleDetection() {
    const resetIdle = () => {
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      // If currently tired from idle, wake up
      if (this.mood === 'tired') {
        this.setMood('happy');
      }
      this.idleTimeout = setTimeout(() => {
        this.setMood('tired');
      }, 10 * 60 * 1000); // 10 minutes
    };

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, resetIdle, { passive: true });
    });

    resetIdle();
  }
}

/**
 * The Little Monsters hero mascot art (teal monster with a pencil + book),
 * served small/web-optimized by the education routes. Override per-page with
 * `new LMMascot(el, { imgSrc })` if a different character is wanted.
 */
// The real pink Little Monster character (waving), served small/web-optimized.
LMMascot.IMG_SRC = '/api/education/mascot.png';

/**
 * Mascot CSS — injected into the page on first instantiation.
 * Uses the LM theme tokens when available, falls back to defaults.
 */
LMMascot.CSS = `
  .lm-mascot {
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 999;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .lm-mascot-body {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--lm-mascot-bg, rgba(23, 182, 174, 0.12));
    border: 3px solid var(--accent-primary, #17b6ae);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    pointer-events: auto;
    overflow: visible;
    transition: border-color 0.3s ease, transform 0.2s ease;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .lm-mascot-body:hover {
    transform: scale(1.1) rotate(-3deg);
  }
  .lm-mascot-img {
    width: 86%;
    height: 86%;
    object-fit: contain;
    border-radius: 50%;
    user-select: none;
    -webkit-user-drag: none;
  }
  /* Mood emoji rides as a small badge on the monster's shoulder. */
  .lm-mascot-emoji {
    position: absolute;
    bottom: -4px;
    right: -4px;
    font-size: 20px;
    line-height: 1;
    background: var(--bg-card, rgba(18, 52, 57, 0.95));
    border-radius: 50%;
    padding: 2px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  .lm-mascot-bubble {
    max-width: 220px;
    padding: 10px 14px;
    border-radius: 12px 12px 4px 12px;
    background: var(--bg-card, rgba(38, 26, 72, 0.9));
    border: 1px solid var(--border-color, rgba(139, 92, 246, 0.15));
    color: var(--text-primary, #f0eaff);
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
  }
  .lm-mascot-bubble.visible {
    opacity: 1;
    transform: translateY(0);
  }
`;

/**
 * Confetti burst — lightweight celebration animation.
 * Call lmConfetti() from any education page to shower confetti.
 * Used for: XP gains, quiz completion, streak milestones, level-ups.
 */
function lmConfetti() {
  var colors = ['#8b5cf6', '#06b6d4', '#34d399', '#f59e0b', '#ec4899', '#ef4444'];
  var container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden;';
  document.body.appendChild(container);

  for (var i = 0; i < 40; i++) {
    var piece = document.createElement('div');
    var color = colors[Math.floor(Math.random() * colors.length)];
    var left = Math.random() * 100;
    var delay = Math.random() * 0.5;
    var size = 6 + Math.random() * 6;
    var duration = 1.5 + Math.random() * 1.5;
    piece.style.cssText = 'position:absolute;top:-10px;left:' + left + '%;width:' + size + 'px;height:' + size + 'px;' +
      'background:' + color + ';border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') + ';' +
      'animation:lm-confetti-fall ' + duration + 's ease-in ' + delay + 's forwards;' +
      'transform:rotate(' + (Math.random() * 360) + 'deg);';
    container.appendChild(piece);
  }

  // Inject animation if not already present
  if (!document.getElementById('lm-confetti-style')) {
    var style = document.createElement('style');
    style.id = 'lm-confetti-style';
    style.textContent = '@keyframes lm-confetti-fall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } ' +
      '100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }';
    document.head.appendChild(style);
  }

  // Clean up after animation
  setTimeout(function() { container.remove(); }, 3500);
}


/* ═══════════════════════════════════════════════════════════════════════════
 * Page frame (window.LM) — the shared navigation model for every Little Monsters surface.
 *
 * It lives in this file, not in a file of its own, because this script already has an
 * authorization binding (/mascot.js) and the package's catalog revision must not change for a
 * static asset: a changed catalog needs an operator-reviewed migration before the app activates.
 *
 * Hosted (cockpit or experience shell): the host owns navigation; LM.navigate/openClass/
 * classesChanged relay through the shapes the cockpit ribbon honours. Standalone: a compact
 * top bar is drawn from the caller's ribbon profile, with the level chip for learners. It never
 * reaches into a parent document and never fabricates data.
 * ═══════════════════════════════════════════════════════════════════════════ */
var LM_FRAME = (function () {
  'use strict';

  /** The ribbon profile that lists this package's admitted surfaces for the caller. */
  var PROFILE_PATH = '/api/ui/profile?name=little-monsters';
  var ME_PATH = '/api/education/me';
  /**
   * The open-time write: the caller's own reminder check (POST, bound to app.open + study.change for
   * every school role). The server provisions a new learner only on a non-GET call, so this is what
   * turns a first visit into a student record without a new route or a changed permission catalog.
   */
  var SETUP_PATH = '/api/education/check-reminders';
  var SETUP_REFUSAL = 'Open Little Monsters to complete school setup';
  var REWARDS_PATH = '/api/education/rewards';
  var CLASS_PATH = '/api/education/class?classId=';
  var LOGO_PATH = '/api/education/logo-96.png';
  var TOOL_PREFIX = 'tool-lm-';
  /** Views that stay in the bar; everything else the caller is admitted to sits under More. */
  var PRIMARY = ['dashboard', 'test-prep', 'myday', 'tutor', 'flashcards', 'recorder', 'arcade', 'monsters', 'teacher'];
  /** Phone layout (one top bar + a bottom bar); the same width education.css switches at. */
  var PHONE_QUERY = '(max-width: 720px)';
  /** The phone bottom bar's four sections, then More; their short labels and icons. */
  var BOTTOM = ['dashboard', 'tutor', 'flashcards', 'arcade'];
  var BOTTOM_LABEL = { dashboard: 'Home', tutor: 'Tutor', flashcards: 'Flashcards', arcade: 'Games' };
  var BOTTOM_ICON = { dashboard: '🏠', tutor: '💬', flashcards: '🃏', arcade: '🎮' };
  /** The bottom bar's More sheet order; anything else the caller is admitted to follows. */
  var SHEET_ORDER = ['test-prep', 'myday', 'monsters', 'recorder', 'presentations', 'timelines', 'stem', 'citations', 'files', 'email'];
  /** On a phone these live in the top bar's ⋯ (with All applications and who is signed in), not in the sheet. */
  var PHONE_MORE = ['voice-settings', 'teacher'];
  var GUARDIAN_SUMMARY_HREF = '/api/education/dashboard?view=guardian';

  function isGuardianView(win) {
    try { return new URLSearchParams(String(win && win.location && win.location.search || '')).get('view') === 'guardian'; } catch (_) { return false; }
  }
  function parentSummaryLink(win) {
    return '<a href="' + GUARDIAN_SUMMARY_HREF + '"' + (isGuardianView(win) ? ' aria-current="page"' : '') + '>Parent summary</a>';
  }

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
   * @description Reduce a ribbon profile to the navigation entries a top bar can render.
   * Dynamic class tools (`tool-lm-class-*`) are excluded: classes are reached from the pages. The profile
   * is already filtered per caller by the server (the app's own tool-keys answer), so nothing is hidden here.
   * @param {object|null} profile The `profile` object of the ribbon profile response.
   * @returns {Array<{view:string,id:string,label:string,href:string,icon:string,section:string}>} Ordered entries.
   */
  function navEntries(profile) {
    var items = profile && profile.ribbon && Array.isArray(profile.ribbon.items) ? profile.ribbon.items : [];
    return items.filter(function (item) {
      var id = String(item && item.id || '');
      if (id.indexOf(TOOL_PREFIX) !== 0 || id.indexOf(TOOL_PREFIX + 'class-') === 0) return false;
      return Boolean(item.toolUi && typeof item.toolUi.iframeUrl === 'string');
    }).map(function (item) {
      var id = String(item.id);
      return { view: id.slice(TOOL_PREFIX.length), id: id, label: String(item.label || id), href: item.toolUi.iframeUrl, icon: String(item.icon || ''), section: String(item.section || 'top') };
    });
  }

  /**
   * @description Find the navigation entry that serves the current page.
   * @param {Array<{href:string}>} entries Entries from navEntries.
   * @param {string} pathname The page's location.pathname.
   * @returns {object|null} The matching entry, or null when the page is not a top-level tool.
   */
  function activeEntry(entries, pathname) {
    var path = String(pathname || '').replace(/\/+$/, '');
    for (var i = 0; i < entries.length; i++) {
      var href = String(entries[i].href).split('?')[0].replace(/\/+$/, '');
      if (href === path) return entries[i];
    }
    return null;
  }

  /**
   * @description Resolve a legacy view name (`recorder`, `flashcards`, `class-<id>`) to a URL.
   * @param {string} view The view the page asked for.
   * @param {Array<{view:string,href:string}>} entries Entries from navEntries.
   * @returns {string} The URL to open, or an empty string when the view is unknown.
   */
  function hrefForView(view, entries) {
    var v = String(view || '');
    if (v.indexOf('class-') === 0) return CLASS_PATH + encodeURIComponent(v.slice('class-'.length));
    for (var i = 0; i < entries.length; i++) if (entries[i].view === v) return entries[i].href;
    return '';
  }

  /**
   * @description Level progress for the chip: the rewards route reports xp and level; the level
   * threshold follows the package's own rule (100 × 1.5^(level−1)).
   * @param {{xp?:number,level?:number}|null} rewards The rewards response.
   * @returns {{level:number,pct:number,inLevel:number,needed:number}|null} Progress, or null without data.
   */
  function levelProgress(rewards) {
    if (!rewards || typeof rewards.level !== 'number' || typeof rewards.xp !== 'number') return null;
    var needed = Math.floor(100 * Math.pow(1.5, Math.max(1, rewards.level) - 1));
    var inLevel = needed > 0 ? rewards.xp % needed : 0;
    return { level: rewards.level, pct: needed > 0 ? Math.min(100, Math.round((inLevel / needed) * 100)) : 0, inLevel: inLevel, needed: needed };
  }

  /**
   * @description Whether a refused /me answer is the first-visit "no learner record yet" refusal.
   * @param {number} status The HTTP status of the /me answer.
   * @param {unknown} body Its parsed JSON body (or null).
   * @returns {boolean} True only for the exact 403 school-setup refusal.
   */
  function needsSchoolSetup(status, body) {
    return status === 403 && Boolean(body) && body.error === SETUP_REFUSAL;
  }

  /**
   * @description The link back to every other application, shown because this frame hides the cockpit's own menu.
   * A child-safe kiosk (?student=1, ?kiosk=1 or ?view=student on the top page) stays inside this application.
   * @param {Window} win The page's window.
   * @returns {string} The link's markup, or an empty string in a kiosk or when the top page cannot be read.
   */
  function allApplicationsLink(win) {
    var search = '';
    try { search = win.top.location.search; } catch (_) { return ''; }
    var params = new URLSearchParams(search);
    if (params.get('student') === '1' || params.get('kiosk') === '1' || params.get('view') === 'student') return '';
    return '<a class="lm-all-applications" href="/cockpit/?screen=applications" target="_top">← All applications</a>';
  }

  /** @description True when this page is hosted by another document (cockpit or experience). */
  function isEmbedded(win) {
    try { return win.top !== win.self; } catch (_) { return true; }
  }

  /**
   * @description Create the frame for a page. Safe to call in Node for the pure helpers; the DOM
   * parts run only in a browser.
   * @param {Window} [win] The window to frame (defaults to the global window).
   * @returns {object} The frame API: navigate, openClass, classesChanged, me, entries, toast, esc, isEmbedded.
   */
  function createFrame(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    var embedded = w ? isEmbedded(w) : true;
    var cache = { me: null, profile: null, rewards: null };
    var entriesReady = null;

    function getJson(path) {
      return w.fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
        .catch(function () { return null; });
    }
    /** @description Make the open-time write once, then read the identity it provisioned. */
    function completeSetup() {
      return w.fetch(SETUP_PATH, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? getJson(ME_PATH) : null; })
        .catch(function () { return null; });
    }
    /** @description Read /me; a first visit's school-setup refusal completes setup instead of failing. */
    function readMe() {
      return w.fetch(ME_PATH, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) {
          var body = r.json().catch(function () { return null; });
          if (r.ok) return body;
          return body.then(function (b) { return needsSchoolSetup(r.status, b) ? completeSetup() : null; });
        })
        .catch(function () { return null; });
    }
    /** @description The signed-in person's education identity, fetched once per page. */
    function me() { if (!cache.me) cache.me = readMe(); return cache.me; }
    /** @description Navigation entries admitted for this caller, fetched once per page. */
    function entries() {
      if (!entriesReady) entriesReady = getJson(PROFILE_PATH).then(function (r) { cache.profile = r && r.profile ? r.profile : null; return navEntries(cache.profile); });
      return entriesReady;
    }
    /** @description Hide parent cockpit headers/footers so Little Monsters owns the full window cleanly. The Jarvis orb stays: it is how a person reaches Jarvis inside this app (hiding it left only the Tutor, which cannot add a class or read the person's schedule). */
    function suppressHostCockpitChrome() {
      if (!embedded) return;
      try {
        var pdoc = w.parent && w.parent.document;
        if (!pdoc || !pdoc.head) return;
        pdoc.title = 'Little Monsters';
        if (pdoc.body) pdoc.body.classList.add('zen-mode');
        if (!pdoc.getElementById('lm-immersive-host-style')) {
          var st = pdoc.createElement('style');
          st.id = 'lm-immersive-host-style';
          st.textContent =
            '.header-bar, .status-bar, #ribbonContainer, .ribbon-backdrop, .chat-panel, .panel-resize-handle, ' +
            '.tool-view-header, .zen-exit-btn, #workspaceNavigation, #workspaceNavigationMore { display: none !important; } ' +
            '.cockpit-body { padding: 0 !important; gap: 0 !important; height: 100vh !important; } ' +
            '.main-content, .tool-view-container { border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; } ' +
            // The trial door's floating way out (body > .visitor-back, bottom-left) rests above the phone bottom bar, like the orb.
            'body > .visitor-back { bottom: calc(12px + var(--oshal-app-bottom-inset, 0px) + env(safe-area-inset-bottom, 0px)) !important; }';
          pdoc.head.appendChild(st);
        }
      } catch (_) { /* cross-origin host — ignore */ }
    }
    /**
     * @description Open another Little Monsters view. Hosted without DOM (test double): relay to host.
     * In browser: navigate this frame directly to the view's own URL.
     * @param {string} view The legacy view name (`recorder`, `flashcards`, `monsters`, `class-<id>`).
     */
    function navigate(view) {
      if (embedded && !w.document) { try { w.parent.postMessage({ type: 'lm-navigate', view: String(view) }, '*'); } catch (_) { /* host without a bridge */ } return; }
      entries().then(function (list) { var href = hrefForView(view, list); if (href) w.location.href = href; });
    }
    /** @description Open one class: relay in headless test doubles, or navigate directly in browser. */
    function openClass(classId) {
      if (embedded && !w.document) { try { w.parent.postMessage({ type: 'lm-open-class', classId: String(classId) }, '*'); } catch (_) { /* host without a bridge */ } return; }
      w.location.href = CLASS_PATH + encodeURIComponent(String(classId));
    }
    /** @description Tell the host the caller's class list changed so its class tools refresh. */
    function classesChanged() { try { if (embedded) w.parent.postMessage('lm-classes-changed', '*'); } catch (_) { /* host without a bridge */ } }

    var toastTimer = 0;
    /** @description Show a short, non-blocking notice at the bottom of the page. */
    function toast(text) {
      var el = w.document.getElementById('lm-toast');
      if (!el) { el = w.document.createElement('div'); el.id = 'lm-toast'; el.className = 'lm-toast'; el.setAttribute('role', 'status'); w.document.body.appendChild(el); }
      el.textContent = String(text || ''); el.classList.add('is-visible');
      w.clearTimeout(toastTimer); toastTimer = w.setTimeout(function () { el.classList.remove('is-visible'); }, 3600);
    }

    function navLink(e, active) { return '<a href="' + esc(e.href) + '"' + (active && active.id === e.id ? ' aria-current="page"' : '') + '>' + esc(e.label) + '</a>'; }
    function pillHtml(who) { return who && who.name ? '<span class="lm-pill is-neutral" title="' + esc(who.email || '') + '">' + esc(String(who.name).split(' ')[0]) + (who.role ? ' · ' + esc(who.role) : '') + '</span>' : ''; }
    function levelHtml(progress) { return progress ? '<span class="lm-level" title="' + progress.inLevel + ' / ' + progress.needed + ' XP"><span class="lm-level-ring" style="--pct:' + progress.pct + '"><span>' + progress.level + '</span></span><span class="lm-level-label">Level ' + progress.level + '</span></span>' : ''; }
    /** @description The phone's ⋯ in the top bar: the way back first, then who is signed in, Voice and Teacher. */
    function phoneMoreHtml(list, active, who, back) {
      var items = list.filter(function (e) { return PHONE_MORE.indexOf(e.view) !== -1; });
      var pill = pillHtml(who);
      if (!back && !pill && !items.length) return '';
      var open = Boolean(active && items.some(function (e) { return e.id === active.id; }));
      return '<details class="lm-more lm-more-phone"><summary aria-label="More"' + (open ? ' aria-current="page"' : '') + '>⋯</summary><div class="lm-more-menu">' + back +
        (pill ? '<div class="lm-more-who">' + pill + '</div>' : '') + items.map(function (e) { return navLink(e, active); }).join('') + '</div></details>';
    }
    function topbarHtml(list, active, who, progress) {
      var primary = list.filter(function (e) { return PRIMARY.indexOf(e.view) !== -1; }), more = list.filter(function (e) { return PRIMARY.indexOf(e.view) === -1; });
      var moreOpen = Boolean(isGuardianView(w) || (active && more.some(function (e) { return e.id === active.id; })));
      var back = allApplicationsLink(w);
      var moreHtml = list.length || back ? '<details class="lm-more lm-more-desk"><summary' + (moreOpen ? ' aria-current="page"' : '') + '>More ▾</summary><div class="lm-more-menu">' + back + '<div class="lm-spill"></div>' + more.map(function (e) { return navLink(e, active); }).join('') + parentSummaryLink(w) + '</div></details>' : '';
      return '<a class="lm-brand" href="' + esc(list.length ? list[0].href : '/api/education/dashboard') + '"><img src="' + LOGO_PATH + '" alt="">little monsters</a><nav aria-label="Little Monsters">' + primary.map(function (e) { return navLink(e, active); }).join('') + '</nav><div class="lm-topbar-side">' + moreHtml + levelHtml(progress) + pillHtml(who) + phoneMoreHtml(list, active, who, back) + '</div>';
    }
    /**
     * @description The phone's bottom bar: Home, Tutor, Flashcards, Games, then More, a sheet with every other section.
     * @returns {string} The bar's inner markup, or an empty string when the caller is admitted to none of the four.
     */
    function bottomBarHtml(list, active) {
      var four = BOTTOM.map(function (v) { return list.filter(function (e) { return e.view === v; })[0]; }).filter(Boolean);
      if (!four.length) return '';
      var rest = list.filter(function (e) { return BOTTOM.indexOf(e.view) === -1 && PHONE_MORE.indexOf(e.view) === -1; });
      rest.sort(function (a, b) { return sheetRank(a.view) - sheetRank(b.view); });
      var link = function (e) { var on = active && active.id === e.id; return '<a href="' + esc(e.href) + '"' + (on ? ' aria-current="page"' : '') + '><span class="lm-bottombar-icon" aria-hidden="true">' + (BOTTOM_ICON[e.view] || '•') + '</span><span>' + esc(BOTTOM_LABEL[e.view] || e.label) + '</span></a>'; };
      var moreOn = Boolean(isGuardianView(w) || (active && rest.some(function (e) { return e.id === active.id; })));
      var sheet = rest.length ? '<details class="lm-bottom-more"><summary' + (moreOn ? ' aria-current="page"' : '') + '><span class="lm-bottombar-icon" aria-hidden="true">⋯</span><span>More</span></summary><div class="lm-sheet" role="menu">' +
        rest.map(function (e) { return navLink(e, active); }).join('') + parentSummaryLink(w) + '</div></details>' : '';
      return four.map(link).join('') + sheet;
    }
    function sheetRank(view) { var i = SHEET_ORDER.indexOf(view); return i === -1 ? SHEET_ORDER.length : i; }
    /**
     * @description Desktop: move the last links of the bar into More ▾ until the rest fit, so no label is ever clipped
     * ('Record' was cut at 1440px). On a phone the bar's links are hidden and nothing moves.
     * @param {HTMLElement} bar The mounted top bar.
     */
    function fitNav(bar) {
      var nav = bar.querySelector('nav'), spill = bar.querySelector('.lm-more-desk .lm-spill'), details = bar.querySelector('.lm-more-desk');
      if (!nav || !spill) return;
      while (spill.firstChild) nav.appendChild(spill.firstChild);
      var phone = w.matchMedia && w.matchMedia(PHONE_QUERY).matches, moved = [];
      while (!phone && nav.children.length > 1 && nav.scrollWidth > nav.clientWidth + 1) moved.unshift(nav.removeChild(nav.lastElementChild));
      moved.forEach(function (a) { spill.appendChild(a); });
      var summary = details.querySelector('summary');
      if (details.querySelector('.lm-more-menu a[aria-current]')) summary.setAttribute('aria-current', 'page'); else summary.removeAttribute('aria-current');
      details.hidden = !details.querySelector('.lm-more-menu a');
    }
    /** @description The host document's root, when this page is framed by a same-origin host (cockpit or Today). */
    function hostRoot() { try { return embedded && w.parent && w.parent.document ? w.parent.document.documentElement : null; } catch (_) { return null; } }
    /** @description Tell the host's assistant button that its visibility changed (the event jarvis-orb.js listens for). */
    function announceAssistant(hidden) { try { w.parent.dispatchEvent(new w.parent.CustomEvent('oshal:assistant-visibility', { detail: { hidden: hidden } })); } catch (_) { /* host without the orb */ } }
    /**
     * @description Keep the host's floating assistant off this page's controls: on a phone it rests above the bottom bar
     * (--oshal-app-bottom-inset, read by the host's orb), and a page that IS the assistant (body[data-lm-assistant="self"],
     * the Tutor) hides it while it is open. Only what this frame set is ever undone.
     */
    function syncHost(bottom) {
      var root = hostRoot();
      if (!root) return;
      var phone = w.matchMedia && w.matchMedia(PHONE_QUERY).matches;
      if (phone && bottom && bottom.offsetHeight) { root.style.setProperty('--oshal-app-bottom-inset', bottom.offsetHeight + 'px'); root.setAttribute('data-lm-inset', ''); }
      else if (root.hasAttribute('data-lm-inset')) { root.style.removeProperty('--oshal-app-bottom-inset'); root.removeAttribute('data-lm-inset'); }
      var self = w.document.body.getAttribute('data-lm-assistant') === 'self';
      if (self && root.getAttribute('data-oshal-assistant-hidden') !== 'true') { root.setAttribute('data-oshal-assistant-hidden', 'true'); root.setAttribute('data-lm-hid-assistant', ''); announceAssistant(true); }
      else if (!self) releaseHost(true);
    }
    /** @description Undo what syncHost set on the host (when this page goes away, or on a page that is not the assistant). */
    function releaseHost(assistantOnly) {
      var root = hostRoot();
      if (!root) return;
      if (!assistantOnly && root.hasAttribute('data-lm-inset')) { root.style.removeProperty('--oshal-app-bottom-inset'); root.removeAttribute('data-lm-inset'); }
      if (root.hasAttribute('data-lm-hid-assistant')) { root.removeAttribute('data-oshal-assistant-hidden'); root.removeAttribute('data-lm-hid-assistant'); announceAssistant(false); }
    }
    /** @description One open menu at a time; a tap outside or Escape closes the open menu or sheet. */
    function wireMenus(doc) {
      var all = function () { return doc.querySelectorAll('.lm-topbar details[open], .lm-bottombar details[open]'); };
      doc.addEventListener('click', function (ev) { all().forEach(function (d) { if (!d.contains(ev.target)) d.removeAttribute('open'); }); });
      doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') all().forEach(function (d) { d.removeAttribute('open'); }); });
    }
    /** @description Draw the phone bottom bar (once) and reserve the page's bottom space for it. */
    function mountBottomBar(list, active) {
      var html = bottomBarHtml(list, active);
      if (!html) return null;
      var nav = w.document.createElement('nav'); nav.className = 'lm-bottombar'; nav.setAttribute('aria-label', 'Little Monsters sections'); nav.innerHTML = html;
      w.document.body.appendChild(nav);
      w.document.body.classList.add('lm-has-bottombar');
      return nav;
    }
    /** @description Render the Little Monsters top bar (and the phone bottom bar) once the profile and identity have answered. */
    function mountTopbar() {
      suppressHostCockpitChrome();
      if (!w.document || !w.document.body || w.document.querySelector('.lm-topbar')) return Promise.resolve(null);
      var bar = w.document.createElement('header'); bar.className = 'lm-topbar'; bar.setAttribute('data-lm-topbar', '');
      w.document.body.insertBefore(bar, w.document.body.firstChild);
      return Promise.all([entries(), me()]).then(function (r) {
        var list = r[0], who = r[1], learner = who && who.role === 'student';
        return (learner ? getJson(REWARDS_PATH) : Promise.resolve(null)).then(function (rewards) {
          var active = isGuardianView(w) ? null : activeEntry(list, w.location.pathname);
          cache.rewards = rewards;
          bar.innerHTML = topbarHtml(list, active, who, learner ? levelProgress(rewards) : null);
          var bottom = mountBottomBar(list, active);
          var refit = function () { fitNav(bar); syncHost(bottom); };
          var queued = 0;
          w.addEventListener('resize', function () { if (!queued) queued = w.requestAnimationFrame(function () { queued = 0; refit(); }); });
          w.addEventListener('pagehide', function () { releaseHost(false); });
          wireMenus(w.document);
          refit();
          bar.setAttribute('data-lm-ready', '');
          return bar;
        });
      });
    }

    var api = { esc: esc, isEmbedded: embedded, navigate: navigate, openClass: openClass, classesChanged: classesChanged, me: me, entries: entries, toast: toast, mountTopbar: mountTopbar, cache: cache };
    if (w && w.document) {
      suppressHostCockpitChrome();
      if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', function () { mountTopbar(); });
      else mountTopbar();
    }
    return api;
  }

  var exported = { esc: esc, allApplicationsLink: allApplicationsLink, navEntries: navEntries, activeEntry: activeEntry, hrefForView: hrefForView, levelProgress: levelProgress, isEmbedded: isEmbedded, needsSchoolSetup: needsSchoolSetup, createFrame: createFrame };
  if (typeof window !== 'undefined' && window.document && !window.LM) window.LM = createFrame(window);
  return exported;
})();

// Export for both Node (testing) and browser (inline script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign({ LMMascot: LMMascot, MOODS: MOODS, LM_FRAME: LM_FRAME }, LM_FRAME);
}
