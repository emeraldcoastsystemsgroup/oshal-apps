/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.4: claim Today's concierge entry synchronously as soon as Video's editor HTML parses inside a same-origin Today frame so Create's floating ball steps aside at once instead of remaining visible while the editor's 15 ES modules load, and record any early Concierge press before bindVideoFoundation finishes so Video's own concierge opens instead of being collapsed into zero windows.
 */
(function () {
  'use strict';
  if (window.parent === window) return;

  function findOuterShellFrame(win) {
    var frames = [];
    for (var view = win; view.parent !== view; view = view.parent) {
      var frame = view.frameElement;
      if (!frame || view.parent.location.origin !== win.location.origin) break;
      frames.push(frame);
    }
    return frames[frames.length - 1] || null;
  }

  try {
    var outerFrame = findOuterShellFrame(window);
    if (!outerFrame) return;
    var outerDoc = outerFrame.ownerDocument;
    var outerWin = outerDoc.defaultView;
    var container = outerFrame.parentElement && outerFrame.parentElement.closest('.tool-view-container');
    var button = container && container.querySelector(':scope > .tool-view-header [data-tool-view-concierge]');
    if (!button) return;

    var outerHtml = outerDoc.documentElement;
    var chatPanel = outerDoc.getElementById('chatPanel');
    if (chatPanel && !chatPanel.classList.contains('collapsed')) {
      document.documentElement.dataset.videoConcierge = 'wanted';
      if (outerWin.__cockpit && typeof outerWin.__cockpit.toggleChatPanel === 'function') {
        outerWin.__cockpit.toggleChatPanel(false);
      }
    }

    outerHtml.setAttribute('data-ef-concierge', 'closed');
    if (window.matchMedia('(max-width:800px)').matches) {
      outerHtml.removeAttribute('data-ef-concierge-pane');
    }

    var active = true;
    var onEarlyClick = function (event) {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.documentElement.dataset.videoConcierge = 'wanted';
      button.setAttribute('aria-busy', 'true');
    };
    var release = function (clearMark) {
      if (!active) return;
      active = false;
      button.removeEventListener('click', onEarlyClick, true);
      button.removeAttribute('aria-busy');
      if (clearMark) outerHtml.removeAttribute('data-ef-concierge');
    };

    button.addEventListener('click', onEarlyClick, true);
    window.addEventListener('pagehide', function () { release(true); }, { once: true });
    window.__videoConciergeEarly = { release: release, outerDoc: outerDoc };
  } catch (_) {
    /* Cross-origin or standalone frame: no outer Today bar to claim. */
  }
})();
