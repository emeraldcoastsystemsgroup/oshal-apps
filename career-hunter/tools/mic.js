/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Port the engine's per-textarea speech dictation into the cockpit surface asset directory: the native surfaces have no shared base template, so nothing loaded the Flask-served copy and the audio box every input field used to carry disappeared. Adds self-injected theme-token styling (the Flask stylesheet is not served here) and a MutationObserver so dynamically rendered cards get a mic without the surface calling anything.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Surface recognition errors instead of swallowing them: onerror discarded the SpeechRecognitionErrorEvent, so a permission denial reset the button with no signal — exactly the silent failure the header promises not to have. not-allowed/service-not-allowed now set an actionable button title; no-speech and aborted stay quiet by design.
 */

/**
 * Speech-to-text dictation for textareas on a Career Hunter cockpit surface.
 *
 * Uses the browser's built-in Web Speech API (Chrome/Edge) — no key, no server call, no cost.
 * Every `<textarea>` gets a mic button in its corner; click to dictate, click again (or stop
 * talking) to finish. Transcribed text is appended after whatever is already in the box.
 * Add `data-nomic` to a textarea to opt it out.
 *
 * Differences from the Flask original (`engine/jobhunter/static/mic.js`):
 *  1. The button styling is injected here instead of living in the engine's `style.css`, which the
 *     cockpit never serves, and it is derived from the framework theme tokens so the control
 *     follows the operator's theme instead of hardcoding the Flask palette.
 *  2. Surfaces render their cards AFTER a fetch, so a load-time-only attach would find zero
 *     textareas. A MutationObserver attaches to nodes added later; `attach()` is idempotent
 *     (`data-mic-attached`), so a textarea can never collect two mic buttons.
 *
 * Requires a secure context (https or localhost); the button is shown disabled with the reason
 * when the API is unavailable, rather than silently doing nothing.
 */
(function () {
  "use strict";
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SUPPORTED = !!SR && (window.isSecureContext !== false);

  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>' +
    '<line x1="8" y1="23" x2="16" y2="23"/></svg>';

  var CSS = '.mic-wrap{position:relative;display:block}' +
    '.mic-btn{position:absolute;top:8px;right:8px;width:31px;height:31px;border-radius:50%;' +
    'border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--accent-primary);' +
    'cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;z-index:3;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .12s,filter .12s}' +
    '.mic-btn svg{width:16px;height:16px}' +
    '.mic-btn:hover{filter:brightness(1.15);transform:scale(1.05)}' +
    '.mic-btn.listening{background:var(--status-error);color:#fff;border-color:var(--status-error);' +
    'animation:micpulse 1.15s infinite}' +
    '.mic-btn.mic-unsupported{opacity:.35;cursor:not-allowed}' +
    '@keyframes micpulse{0%{box-shadow:0 0 0 0 rgba(217,54,54,.55)}' +
    '70%{box-shadow:0 0 0 8px rgba(217,54,54,0)}100%{box-shadow:0 0 0 0 rgba(217,54,54,0)}}';

  var active = null;   // the recognizer currently listening (only one at a time)

  /** Inject the mic button styling once, before the first button is created. */
  function injectStyle() {
    if (document.getElementById("mic-js-style")) return;
    var el = document.createElement("style");
    el.id = "mic-js-style";
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /** Wire one recognizer to a textarea, committing finals and previewing interim speech. */
  function listen(ta, btn, reset) {
    var rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    var base = ta.value;
    if (base && !/\s$/.test(base)) base += " ";   // keep a space before new speech
    rec.onresult = function (e) {
      var finalText = "", interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      if (finalText) base += finalText;            // commit finals into the base
      ta.value = base + interim;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    rec.onerror = function (e) {
      // The dominant real failures pass the SUPPORTED gate and land here: 'not-allowed'
      // (mic permission denied) and 'no-speech'. Silently resetting made the button look
      // broken; surface the reason on the button so the user knows what to fix.
      var code = (e && e.error) || "error";
      if (code === "not-allowed" || code === "service-not-allowed") {
        btn.title = "Microphone blocked — allow mic access in your browser and try again";
      } else if (code !== "no-speech" && code !== "aborted") {
        btn.title = "Dictation failed (" + code + ") — click to retry";
      }
      reset(rec);
    };
    rec.onend = function () { ta.value = base; reset(rec); };
    rec.start();
    btn.classList.add("listening");
    ta.focus();
    return rec;
  }

  /** Attach exactly one mic button to a textarea; a second call on the same box is a no-op. */
  function attach(ta) {
    if (ta.dataset.micAttached || ta.dataset.nomic !== undefined) return;
    ta.dataset.micAttached = "1";
    injectStyle();

    // Wrap the textarea so the button can sit in its corner without touching the surface markup.
    var wrap = document.createElement("div");
    wrap.className = "mic-wrap";
    ta.parentNode.insertBefore(wrap, ta);
    wrap.appendChild(ta);

    var btn = document.createElement("button");
    btn.type = "button";                 // never submits the form
    btn.className = "mic-btn";
    btn.innerHTML = MIC;
    btn.setAttribute("aria-label", "Dictate with your voice");
    wrap.appendChild(btn);

    if (!SUPPORTED) {
      btn.classList.add("mic-unsupported");
      btn.disabled = true;
      btn.title = SR ? "Dictation needs a secure (https) page" : "Speech-to-text needs Chrome or Edge";
      return;
    }
    btn.title = "Dictate (speech to text)";

    var rec = null;
    function reset(which) {
      if (which && which !== rec) return;
      btn.classList.remove("listening");
      if (active === rec) active = null;
      rec = null;
    }
    btn.addEventListener("click", function () {
      if (rec) { try { rec.stop(); } catch (e) { reset(rec); } return; }
      if (active) { try { active.stop(); } catch (e) { active = null; } }  // one box at a time
      try { rec = listen(ta, btn, reset); active = rec; }
      catch (e) { reset(rec); }
    });
  }

  /**
   * @description Attach a mic to every textarea currently in the document that lacks one.
   * @returns {void}
   */
  function attachAll() {
    var tas = document.querySelectorAll("textarea");
    for (var i = 0; i < tas.length; i++) attach(tas[i]);
  }

  /** Follow surfaces that render their cards after a fetch; attach() keeps this idempotent. */
  function observe() {
    if (!window.MutationObserver || !document.body) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === "TEXTAREA") attach(node);
          else if (node.querySelectorAll) {
            var inner = node.querySelectorAll("textarea");
            for (var k = 0; k < inner.length; k++) attach(inner[k]);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() { attachAll(); observe(); }

  window.OshalMic = { attachAll: attachAll, supported: SUPPORTED };

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
