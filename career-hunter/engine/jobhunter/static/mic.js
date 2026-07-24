/* Speech-to-text dictation for textareas.
 *
 * Uses the browser's built-in Web Speech API (Chrome/Edge) — no key, no server,
 * no cost. Auto-attaches a mic button to every <textarea> on the page; click to
 * dictate, click again (or stop talking) to finish. Transcribed text is appended
 * at the end of whatever is already in the box. Add data-nomic to a textarea to
 * opt it out. Requires a secure context — works on localhost / 127.0.0.1.
 */
(function () {
  "use strict";
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>' +
    '<line x1="8" y1="23" x2="16" y2="23"/></svg>';

  var active = null;   // the recognizer currently listening (only one at a time)

  function attach(ta) {
    if (ta.dataset.micAttached || ta.dataset.nomic !== undefined) return;
    ta.dataset.micAttached = "1";

    // Wrap the textarea so the button can sit in its corner without touching markup.
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

    if (!SR) {
      btn.classList.add("mic-unsupported");
      btn.disabled = true;
      btn.title = "Speech-to-text needs Chrome or Edge";
      return;
    }
    btn.title = "Dictate (speech to text)";

    var rec = null, listening = false, base = "";

    function stop() { if (rec) { try { rec.stop(); } catch (e) {} } }
    function reset() {
      listening = false;
      btn.classList.remove("listening");
      if (active === rec) active = null;
    }

    btn.addEventListener("click", function () {
      if (listening) { stop(); return; }
      if (active) { try { active.stop(); } catch (e) {} }  // stop any other box first

      rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;

      base = ta.value;
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
      rec.onerror = function () { reset(); };
      rec.onend = function () { ta.value = base; reset(); };

      try {
        rec.start();
        listening = true; active = rec;
        btn.classList.add("listening");
        ta.focus();
      } catch (e) { reset(); }
    });
  }

  function init() {
    var tas = document.querySelectorAll("textarea");
    for (var i = 0; i < tas.length; i++) attach(tas[i]);
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
