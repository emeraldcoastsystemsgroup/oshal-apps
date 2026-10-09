/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The classroom audience: the starter catalog now answers in its real shape (kinds with groups, starters with icon, kind and outline; one id the classroom does not offer), and the list carries an outside link and a store file with no table row (createdAt null, how /list reports it), so the classroom view's allowlist, newest-first order and null dates run in the browser. The company expectation counts that spreadsheet.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (Home shell) over the same synthetic list: four documents saved, newest first, plain kind words, "Saved 2 h ago" / "3 days ago" / "10 days ago" from the kit's relative form (deterministic in any zone, unlike a calendar day computed in Node against one painted by Chromium), the undated store file last without a date, the Open badge and its note, and the four stats.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const KINDS = [
  { id: 'pptx', name: 'Presentation', noun: 'deck', opens: 'PowerPoint', groups: [{ id: 'story', label: 'Tell a story' }, { id: 'explain', label: 'Explain a topic' }] },
  { id: 'docx', name: 'Document', noun: 'document', opens: 'Word', groups: [{ id: 'marketing', label: 'Marketing' }] },
  { id: 'xlsx', name: 'Spreadsheet', noun: 'workbook', opens: 'Excel', groups: [{ id: 'plans', label: 'Plans & schedules' }, { id: 'tracking', label: 'Tracking' }] },
];
const starter = (id, kind, group, icon, name) => ({ id, kind, group, icon, name, desc: 'Synthetic ' + name.toLowerCase() + ' starter.', title: name, theme: 'paper', outline: 'Synthetic ' + name + '\nfirst point\nsecond point' });

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'presentations', file: 'presentations/tools/presentations.html', url: '/api/presentations/sections/ui', fullMarker: '#chatIn',
    reads: {
      '/api/presentations/sections/list': { decks: [
        { title: 'Synthetic board update', fileName: 'synthetic-board.pptx', provider: 'workspace', slides: 12, format: 'pptx', createdAt: iso(-72) },
        { title: 'Synthetic class schedule', fileName: 'synthetic-schedule.xlsx', provider: 'workspace', downloadUrl: '/api/presentations/sections/file?name=synthetic-schedule.xlsx', slides: null, format: 'xlsx', createdAt: null },
        { title: 'Synthetic pitch deck', fileName: 'synthetic-pitch.pptx', provider: 'workspace', downloadUrl: '/api/presentations/sections/file?name=synthetic-pitch.pptx', slides: 8, theme: 'paper', format: 'pptx', createdAt: iso(-2) },
        { title: 'Synthetic report', fileName: 'synthetic-report.docx', provider: 'drive', url: 'https://example.com/synthetic-report', format: 'docx', createdAt: iso(-240) } ] },
      '/api/presentations/sections/themes': { themes: [], layouts: [], defaultTheme: 'paper' },
      '/api/presentations/sections/starters': { kinds: KINDS, starters: [
        starter('pitch', 'pptx', 'story', '🚀', 'Pitch'), starter('teach', 'pptx', 'explain', '🎓', 'Explainer'),
        starter('newsletter', 'docx', 'marketing', '📰', 'Newsletter'), starter('flyer', 'docx', 'marketing', '📣', 'Flyer / advertisement'),
        starter('schedule', 'xlsx', 'plans', '📆', 'Schedule'), starter('tracker', 'xlsx', 'tracking', '✅', 'Task tracker') ] },
      '/api/presentations/sections/destination': { provider: 'workspace', folder: 'Synthetic', isDefault: true },
    },
    audiences: {
      company: { stats: 5, sections: ['start', 'documents'], text: ['AI Office', 'Synthetic pitch deck', 'Spreadsheet', 'Synthetic report'], statValues: { 'saved-24h': '1', 'saved-5d': '2', decks: '2', documents: '1', sheets: '1' } },
      classroom: { stats: 4, sections: ['starters', 'work'], text: ['AI Office', 'Your slides and papers', '4 things saved', 'Teach a topic', 'To-do tracker', 'Synthetic pitch deck', 'Synthetic class schedule'], statValues: { 'made-7d': '2', slides: '2', papers: '1', sheets: '1' } },
      family: { stats: 4, sections: ['documents'], text: ['Our documents', 'Recent documents', '4 documents saved', 'Saved lately', 'Synthetic pitch deck', 'Slide deck · 8 slides', 'Saved 2 h ago', 'Synthetic board update', 'Saved 3 days ago', 'Synthetic report', 'Saved 10 days ago', 'Synthetic class schedule', 'Spreadsheet', 'Open', 'Tap Open to see a document in a new tab.', 'Make something new'], statValues: { 'saved-7d': '2', decks: '2', documents: '1', sheets: '1' } },
    },
  });
