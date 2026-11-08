/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Starter publication templates (flyer, newsletter, booklet) producing validated editable copies (RP-PUB-01).
 */
import {fail,title,validate} from './model.mjs';

export const TEMPLATES = Object.freeze([
  {
    id: 'event-flyer',
    name: 'Event flyer',
    category: 'Flyer',
    size: 'letter',
    pageCount: 1,
    summary: 'Single-page Letter flyer with banner, bold headline, date strip, and details frame.',
  },
  {
    id: 'newsletter',
    name: 'Community newsletter',
    category: 'Newsletter',
    size: 'letter',
    pageCount: 2,
    summary: 'Two-page Letter dispatch with masthead, running folio, and linked lead story frames.',
  },
  {
    id: 'booklet',
    name: 'Four-page booklet',
    category: 'Booklet',
    size: 'a5',
    pageCount: 4,
    summary: 'Facing A5 booklet with cover title block, page folios, and three-page linked interior story.',
  },
]);

function eventFlyer(name) {
  return validate({
    version: 1,
    title: name,
    pageView: 'single',
    characterStyles: {
      default: { font: 'Libertinus Serif', size: 13, weight: 400, style: 'normal', color: [28, 32, 38] },
      header: { font: 'Liberation Sans', size: 28, weight: 700, style: 'normal', color: [255, 255, 255] },
      kicker: { font: 'Liberation Sans', size: 12, weight: 700, style: 'normal', color: [255, 255, 255] },
    },
    paragraphStyles: {
      body: { leading: 5, spaceAfter: 10, indent: 0, align: 'left' },
      center: { leading: 4, spaceAfter: 6, indent: 0, align: 'center' },
    },
    assets: [],
    masters: [],
    pages: [{
      id: 'page1', width: 612, height: 792, bleed: 9, margin: 54,
      guides: { x: [54, 558], y: [54, 738] }, masterId: null,
      objects: [
        { id: 'hero_band', kind: 'rect', x: 54, y: 54, width: 504, height: 156, color: [20, 48, 96] },
        { id: 'accent_bar', kind: 'rect', x: 54, y: 210, width: 504, height: 28, color: [217, 119, 6] },
        { id: 'hero_title', kind: 'text', x: 72, y: 92, width: 468, height: 84, paragraph: { style: 'center', runs: [{ text: name, style: 'header' }] } },
        { id: 'date_line', kind: 'text', x: 72, y: 216, width: 468, height: 20, paragraph: { style: 'center', runs: [{ text: 'SATURDAY 6 PM  |  MAIN HALL  |  DOORS OPEN AT 5:30 PM', style: 'kicker' }] } },
      ],
      frames: [{ id: 'frame1', storyId: 'story1', nextFrame: null, x: 54, y: 264, width: 504, height: 450 }],
    }],
    stories: [{
      id: 'story1', firstFrame: 'frame1',
      paragraphs: [
        { style: 'body', runs: [{ text: 'Join neighbours, speakers, and live musicians for an evening showcase. Edit this frame with event highlights, guest speakers, and RSVP instructions.' }] },
        { style: 'body', runs: [{ text: 'Admission details, accessibility notes, and contact address go right here.' }] },
      ],
    }],
  });
}

function newsletter(name) {
  return validate({
    version: 1,
    title: name,
    pageView: 'single',
    characterStyles: {
      default: { font: 'Libertinus Serif', size: 12, weight: 400, style: 'normal', color: [24, 28, 34] },
      header: { font: 'Liberation Sans', size: 22, weight: 700, style: 'normal', color: [18, 42, 84] },
      folio: { font: 'Liberation Mono', size: 9, weight: 400, style: 'normal', color: [90, 98, 110] },
    },
    paragraphStyles: {
      body: { leading: 4, spaceAfter: 8, indent: 0, align: 'left' },
    },
    assets: [],
    masters: [{
      id: 'master',
      objects: [
        { id: 'folio_rule', kind: 'rect', x: 54, y: 744, width: 504, height: 1.5, color: [180, 188, 200] },
        { id: 'folio_num', kind: 'number', x: 528, y: 750, width: 30, height: 18, style: 'folio' },
      ],
    }],
    pages: [
      {
        id: 'page1', width: 612, height: 792, bleed: 9, margin: 54,
        guides: { x: [54, 558], y: [54, 738] }, masterId: 'master',
        objects: [
          { id: 'masthead_rule', kind: 'rect', x: 54, y: 102, width: 504, height: 4, color: [18, 42, 84] },
          { id: 'masthead_title', kind: 'text', x: 54, y: 58, width: 504, height: 38, paragraph: { style: 'body', runs: [{ text: name, style: 'header' }] } },
        ],
        frames: [{ id: 'frame1', storyId: 'story1', nextFrame: 'frame2', x: 54, y: 124, width: 504, height: 590 }],
      },
      {
        id: 'page2', width: 612, height: 792, bleed: 9, margin: 54,
        guides: { x: [54, 558], y: [54, 738] }, masterId: 'master',
        objects: [],
        frames: [{ id: 'frame2', storyId: 'story1', nextFrame: null, x: 54, y: 72, width: 504, height: 590 }],
      },
    ],
    stories: [{
      id: 'story1', firstFrame: 'frame1',
      paragraphs: [
        { style: 'body', runs: [{ text: 'Lead dispatch: summarize the month in clear paragraphs. Linked frames carry overflow seamlessly onto page two.' }] },
        { style: 'body', runs: [{ text: 'Upcoming dates, contributor notes, and community announcements continue across the issue.' }] },
      ],
    }],
  });
}

function booklet(name) {
  return validate({
    version: 1,
    title: name,
    pageView: 'facing',
    characterStyles: {
      default: { font: 'Libertinus Serif', size: 11, weight: 400, style: 'normal', color: [26, 26, 30] },
      header: { font: 'Liberation Sans', size: 22, weight: 700, style: 'normal', color: [255, 255, 255] },
      folio: { font: 'Liberation Sans', size: 9, weight: 400, style: 'normal', color: [100, 105, 115] },
    },
    paragraphStyles: {
      body: { leading: 4, spaceAfter: 7, indent: 0, align: 'left' },
    },
    assets: [],
    masters: [{
      id: 'master',
      objects: [{ id: 'page_no', kind: 'number', x: 198, y: 562, width: 24, height: 18, style: 'folio' }],
    }],
    pages: [
      {
        id: 'page1', width: 419.5, height: 595.3, bleed: 9, margin: 36,
        guides: { x: [36, 383.5], y: [36, 559.3] }, masterId: null,
        objects: [
          { id: 'cover_band', kind: 'rect', x: 36, y: 36, width: 347.5, height: 220, color: [28, 56, 72] },
          { id: 'cover_title', kind: 'text', x: 54, y: 108, width: 311.5, height: 96, paragraph: { style: 'body', runs: [{ text: name, style: 'header' }] } },
        ],
        frames: [],
      },
      ...[2, 3, 4].map(n => ({
        id: 'page' + n, width: 419.5, height: 595.3, bleed: 9, margin: 36,
        guides: { x: [36, 383.5], y: [36, 559.3] }, masterId: 'master',
        objects: [],
        frames: [{ id: 'frame' + (n - 1), storyId: 'story1', nextFrame: n === 4 ? null : 'frame' + n, x: 36, y: 54, width: 347.5, height: 486 }],
      })),
    ],
    stories: [{
      id: 'story1', firstFrame: 'frame1',
      paragraphs: [
        { style: 'body', runs: [{ text: 'Interior booklet story: edit chapters, programme notes, or product specifications here. Text flows cleanly from page two through page four.' }] },
      ],
    }],
  });
}

export function templateModel(templateId, docTitle) {
  const cleanTitle = title(docTitle);
  if (templateId === 'event-flyer') return eventFlyer(cleanTitle);
  if (templateId === 'newsletter') return newsletter(cleanTitle);
  if (templateId === 'booklet') return booklet(cleanTitle);
  fail(400, 'publishing_template_unsupported');
}
