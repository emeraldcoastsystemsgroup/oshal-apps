/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve the application viewer API through the shared OSHAL STL viewer v1; report an incompatible core explicitly.
 */
(function () {
  'use strict';
  function viewer() {
    const shared = window.OSHALStlViewer;
    if (!shared || shared.apiVersion !== 1 || typeof shared.mount !== 'function' || typeof shared.parseStl !== 'function') {
      throw new Error('3D preview requires an updated OSHAL core with the shared STL viewer v1.');
    }
    return shared;
  }
  window.CadStudioViewer = {
    mount: (canvas) => viewer().mount(canvas),
    parseStl: (buffer) => viewer().parseStl(buffer),
  };
})();
