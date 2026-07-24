/*
 * lm-voice.js — shared read-aloud helper for Little Monsters pages.
 *
 * Routes text through the server-side neural TTS endpoint (/api/voice/synthesize,
 * Gemini/Google Cloud voices) and plays the returned audio. Falls back to the
 * browser's robotic speechSynthesis only when the server returns a browser
 * directive or errors — so a missing key degrades gracefully instead of silently
 * failing. Exposes window.lmSpeak(text) and window.lmStopSpeak().
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * 2026-06-13 19:00:00 | roger.murphy@agenticfederal.us | Initial neural read-aloud helper (replaces per-page browser speechSynthesis)
 * 2026-07-12 03:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Send the saved voice as `voice` (the key SynthesizeRequestSchema actually reads) — as `voiceId` alone the user's chosen voice was silently ignored and every read-aloud used the server default. voiceId kept for older deployments.
 */
(function () {
  var current = null; // the in-flight <audio> element, so a new call cancels it

  /**
   * Clean text before speaking. Strips any stray HTML, removes emoji/pictographs
   * (so screen-reader-style "Waving hand" glyph names are never read aloud), drops
   * control chars, and collapses whitespace. This is the fix for read-aloud
   * announcing icon titles and leftover markup from the chat surface.
   */
  function sanitize(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/<[^>]*>/g, ' '); // strip any HTML tags
    // Remove emoji / symbol / pictographic code points (common BMP symbol ranges +
    // surrogate-pair emoji + variation selector + zero-width joiner).
    s = s.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, ' '); // surrogate-pair emoji
    s = s.replace(/[←-⇿⌀-➿⬀-⯿️‍☀-⛿]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  /** Read user voice preferences saved by the Voice Settings page (localStorage). */
  function prefs() {
    try {
      return {
        enabled: localStorage.getItem('lm-tts-enabled') !== '0',
        voice: localStorage.getItem('lm-tts-voice') || '',
        rate: parseFloat(localStorage.getItem('lm-tts-rate') || '1') || 1,
      };
    } catch (e) {
      return { enabled: true, voice: '', rate: 1 };
    }
  }

  function browserFallback(text, rate) {
    try {
      if ('speechSynthesis' in window && text) {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = rate || 0.95;
        window.speechSynthesis.speak(u);
      }
    } catch (e) { /* no speech support — silent */ }
  }

  /** Stop any read-aloud in progress (neural audio or browser speech) and fully
   *  release the audio element so nothing lingers/leaks between messages. */
  window.lmStopSpeak = function () {
    try {
      if (current) {
        current.pause();
        current.removeAttribute('src');
        try { current.load(); } catch (e2) { /* ignore */ }
        current = null;
      }
    } catch (e) { /* ignore */ }
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  };

  /**
   * Speak text aloud with a neural voice (server) and a browser fallback.
   * @param {string} text
   * @returns {Promise<void>}
   */
  window.lmSpeak = async function (text) {
    if (!text) return;
    var p = prefs();
    if (!p.enabled) return; // read-aloud turned off in Voice Settings
    window.lmStopSpeak();
    text = sanitize(text).slice(0, 4500); // clean (no emoji/markup) + keep within TTS limits
    if (!text) return; // nothing speakable after cleaning
    try {
      var body = { text: text };
      // Server schema reads `voice`; `voiceId` kept for older deployments that read it.
      if (p.voice) { body.voice = p.voice; body.voiceId = p.voice; }
      var resp = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) { browserFallback(text, p.rate); return; }
      var json = await resp.json();
      var d = json && json.data ? json.data : json;
      if (d && d.audioData && d.fallback !== 'browser') {
        current = new Audio('data:' + (d.format || 'audio/mpeg') + ';base64,' + d.audioData);
        current.playbackRate = p.rate || 1;
        current.play().catch(function () { browserFallback(text, p.rate); });
      } else {
        browserFallback(text, p.rate);
      }
    } catch (e) {
      browserFallback(text, p.rate);
    }
  };
})();
