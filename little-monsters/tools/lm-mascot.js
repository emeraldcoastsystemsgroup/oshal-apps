/**
 * LM Mascot — Shared UI Component for Little Monsters
 *
 * The Little Monster mascot that appears in all education bot UIs.
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

// Export for both Node (testing) and browser (inline script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LMMascot, MOODS };
}
