/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show; the family audience expects the same card as the company one. Consumed by the audience-view browser harness in headless Chromium; never by the runtime.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const company = { stats: 3, sections: ['projects'], text: ['Scene Studio', 'Synthetic island', 'Synthetic boat'], statValues: { projects: '3', godot: '2', blender: '1' } };
  return {
    app: 'scene-studio', file: 'scene-studio/tools/scene-studio.html', url: '/api/scene-studio/app', fullMarker: 'body',
    assets: [{ url: '/api/scene-studio/assets/scene-studio.js', file: 'scene-studio/tools/scene-studio.js' }],
    reads: {
      '/api/scene-studio/projects': { projects: [
        { projectId: 'p1', title: 'Synthetic island', kind: 'godot', revision: 4, updatedAt: iso(-1) },
        { projectId: 'p2', title: 'Synthetic boat', kind: 'blender', revision: 2, updatedAt: iso(-30) },
        { projectId: 'p3', title: 'Synthetic level', kind: 'godot', revision: 1, updatedAt: iso(-100) } ] },
    },
    audiences: { company, family: company },
  };
};
