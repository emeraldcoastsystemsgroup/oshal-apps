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
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation — mascot component
 * 2026-09-27     | maintainer@emeraldcoastsystemsgroup.com     | Carry the page frame (window.LM) in this already-bound script so the authorization catalog stays at its installed revision; every surface loads it
 * 2026-09-27     | maintainer@emeraldcoastsystemsgroup.com     | The frame renders the profile as served: the server filters tools per caller through the app's tool-keys route, so the client keeps no teacher-only list
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
  var REWARDS_PATH = '/api/education/rewards';
  var CLASS_PATH = '/api/education/class?classId=';
  var LOGO_PATH = '/api/education/logo-96.png';
  var TOOL_PREFIX = 'tool-lm-';
  /** Views that stay in the bar; everything else the caller is admitted to sits under More. */
  var PRIMARY = ['dashboard', 'myday', 'tutor', 'flashcards', 'recorder', 'arcade', 'monsters', 'teacher'];

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
    /** @description The signed-in person's education identity, fetched once per page. */
    function me() { if (!cache.me) cache.me = getJson(ME_PATH); return cache.me; }
    /** @description Navigation entries admitted for this caller, fetched once per page. */
    function entries() {
      if (!entriesReady) entriesReady = getJson(PROFILE_PATH).then(function (r) { cache.profile = r && r.profile ? r.profile : null; return navEntries(cache.profile); });
      return entriesReady;
    }
    /**
     * @description Open another Little Monsters view. Hosted: ask the host through the shapes the
     * cockpit ribbon honours. Standalone: navigate this window to the view's own URL.
     * @param {string} view The legacy view name (`recorder`, `flashcards`, `monsters`, `class-<id>`).
     */
    function navigate(view) {
      if (embedded) { try { w.parent.postMessage({ type: 'lm-navigate', view: String(view) }, '*'); } catch (_) { /* host without a bridge */ } return; }
      entries().then(function (list) { var href = hrefForView(view, list); if (href) w.location.href = href; });
    }
    /** @description Open one class: the host's dynamic class tool, or the class page standalone. */
    function openClass(classId) {
      if (embedded) { try { w.parent.postMessage({ type: 'lm-open-class', classId: String(classId) }, '*'); } catch (_) { /* host without a bridge */ } return; }
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
    function topbarHtml(list, active, who, progress) {
      var primary = list.filter(function (e) { return PRIMARY.indexOf(e.view) !== -1; }), more = list.filter(function (e) { return PRIMARY.indexOf(e.view) === -1; });
      var moreOpen = Boolean(active && more.some(function (e) { return e.id === active.id; }));
      var moreHtml = more.length ? '<details class="lm-more"><summary' + (moreOpen ? ' aria-current="page"' : '') + '>More ▾</summary><div class="lm-more-menu">' + more.map(function (e) { return navLink(e, active); }).join('') + '</div></details>' : '';
      var name = who && who.name ? '<span class="lm-pill is-neutral" title="' + esc(who.email || '') + '">' + esc(String(who.name).split(' ')[0]) + (who.role ? ' · ' + esc(who.role) : '') + '</span>' : '';
      var level = progress ? '<span class="lm-level" title="' + progress.inLevel + ' / ' + progress.needed + ' XP"><span class="lm-level-ring" style="--pct:' + progress.pct + '"><span>' + progress.level + '</span></span>Level ' + progress.level + '</span>' : '';
      return '<a class="lm-brand" href="' + esc(list.length ? list[0].href : '/api/education/dashboard') + '"><img src="' + LOGO_PATH + '" alt="">little monsters</a><nav aria-label="Little Monsters">' + primary.map(function (e) { return navLink(e, active); }).join('') + '</nav><div class="lm-topbar-side">' + moreHtml + level + name + '</div>';
    }
    /** @description Render the standalone top bar once the profile and identity have answered. */
    function mountTopbar() {
      if (embedded || !w.document.body || w.document.querySelector('.lm-topbar')) return Promise.resolve(null);
      var bar = w.document.createElement('header'); bar.className = 'lm-topbar'; bar.setAttribute('data-lm-topbar', '');
      w.document.body.insertBefore(bar, w.document.body.firstChild);
      return Promise.all([entries(), me()]).then(function (r) {
        var list = r[0], who = r[1], learner = who && who.role === 'student';
        return (learner ? getJson(REWARDS_PATH) : Promise.resolve(null)).then(function (rewards) {
          cache.rewards = rewards;
          bar.innerHTML = topbarHtml(list, activeEntry(list, w.location.pathname), who, learner ? levelProgress(rewards) : null);
          return bar;
        });
      });
    }

    var api = { esc: esc, isEmbedded: embedded, navigate: navigate, openClass: openClass, classesChanged: classesChanged, me: me, entries: entries, toast: toast, mountTopbar: mountTopbar, cache: cache };
    if (w && w.document) {
      if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', function () { mountTopbar(); });
      else mountTopbar();
    }
    return api;
  }

  var exported = { esc: esc, navEntries: navEntries, activeEntry: activeEntry, hrefForView: hrefForView, levelProgress: levelProgress, isEmbedded: isEmbedded, createFrame: createFrame };
  if (typeof window !== 'undefined' && window.document && !window.LM) window.LM = createFrame(window);
  return exported;
})();

// Export for both Node (testing) and browser (inline script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign({ LMMascot: LMMascot, MOODS: MOODS, LM_FRAME: LM_FRAME }, LM_FRAME);
}
