/* Assisted-apply helpers: one-click copy-to-clipboard for the field pack and the
   recruiter intro. Buttons/links opt in with:
     data-copy-text="literal string to copy"      OR
     data-copy-target="#selector of an element whose text/value to copy"
   Optional data-copied-label overrides the brief confirmation shown after copying.
   On an <a> the default navigation is preserved, so "copy note & open profile ↗"
   copies AND opens the LinkedIn tab in a single click.

   navigator.clipboard needs a secure context; http://127.0.0.1 qualifies. A hidden
   <textarea> + execCommand fallback covers the case where the dashboard is opened
   over a plain-http LAN IP instead. */
(function () {
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("execCommand copy failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function textFor(btn) {
    if (btn.dataset.copyText) return btn.dataset.copyText;
    var sel = btn.dataset.copyTarget;
    if (sel) {
      var t = document.querySelector(sel);
      if (t) return (t.tagName === "TEXTAREA" || t.tagName === "INPUT") ? t.value : t.textContent.trim();
    }
    return "";
  }

  function confirmOn(btn, msg) {
    if (btn.dataset.busy) return;          // ignore re-clicks during the flash
    btn.dataset.busy = "1";
    var original = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () {
      btn.textContent = original;
      delete btn.dataset.busy;
    }, 1500);
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy-text],[data-copy-target]");
    if (!btn) return;
    var text = textFor(btn);
    if (!text) return;                     // nothing to copy → let any default happen
    // Do NOT preventDefault: an <a> with target=_blank still opens its tab.
    copy(text).then(
      function () { confirmOn(btn, btn.dataset.copiedLabel || "✓ copied"); },
      function () { confirmOn(btn, "copy failed — select & ⌘/Ctrl-C"); }
    );
  });
})();
