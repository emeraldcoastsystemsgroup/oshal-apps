/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Create audience views (ADR-164 D6): the purpose-first front door, its declared URL, one synthetic read-only answer in the shape routes/create-project-routes.js builds for GET /home-summary (two layered-image projects with their update time and editor action, the project count), and what the family view and its company alias must show.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One saved project exactly as the route builds it from a metadata row: the title as the text,
 * 'Layered image · updated <ISO>' as the detail and one image-editor action.
 * @param {string} id The project id.
 * @param {string} title The project title.
 * @param {string} updated ISO instant of updated_at.
 * @returns {object} The item.
 */
function project(id, title, updated) {
  return { text: title, detail: 'Layered image · updated ' + updated, actions: [{ tool: 'create-editor', query: 'project=' + id }] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const expect = {
    stats: 1, sections: ['projects', 'studios'],
    text: ['Creative · Create', '2 image projects', 'looking starts nothing', 'Open Create', 'Your image projects', 'Newest first. Each opens in the image editor.',
      'Synthetic autumn poster', 'Layered image', 'Updated 3 h ago', 'Synthetic bake sale flyer', 'Updated yesterday',
      'What Create can open', 'AI Office', 'Portrait Studio', 'Video Studio', 'Vids Studio', 'Stories', '3D Scan-to-Print', 'Image editor', 'Open Create in the cockpit'],
    statValues: { 'image-projects': '2' },
  };
  return {
    app: 'create', file: 'create/tools/create-new.html', url: '/api/create/new', fullMarker: '#sections .grid',
    reads: {
      '/api/create/home-summary': { items: [project('00000000-0000-4000-8000-00000000000a', 'Synthetic autumn poster', iso(-3)), project('00000000-0000-4000-8000-00000000000b', 'Synthetic bake sale flyer', iso(-27))],
        metrics: [{ label: 'Image projects', value: '2' }] },
    },
    // ADR-164 D6: the company audience paints the same account-scoped card, so it expects the same text, stats and sections.
    audiences: { family: expect, company: expect },
  };
};
