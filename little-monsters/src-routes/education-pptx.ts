/**
 * Education PowerPoint export — Little Monsters
 *
 * Bridges the Little Monsters lecture deck (lightweight JSON slides produced by
 * /process-transcript) into the OSHAL presentation generator (pptxgenjs via
 * renderPptx), then saves the rendered .pptx to the student's configured Files
 * store (ADR-041) under the lecture-scribe bot's own subfolder (ADR-043). One
 * place is reused by both the on-demand "Download PowerPoint" route and the
 * automatic deliverable emitted during lecture processing.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 19:21:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — map LM lecture slides to RenderableSlide and render+save a real .pptx via the presentation generator into the lecture-scribe bot store (ADR-043).
 *
 * @module education-pptx
 */

import { renderPptx, type RenderableSlide } from '@/features/presentation-generation';
import type { AppContext } from '@/app/composition/app-context';
import { saveContent } from '@/app/routes/storage-target';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'education-pptx' });

/** The lecture-scribe bot — owns lecture artifacts; its store namespaces the saved decks. */
const LECTURE_SCRIBE_AGENT_ID = 'ed000000-0000-0000-0000-000000000001';
/** Bot-scoped store path for lecture decks (ADR-043 `oshal/{bot-id}/`). */
const LECTURE_DECK_SUBFOLDER = `oshal/${LECTURE_SCRIBE_AGENT_ID}`;

/** A Little Monsters lecture slide as persisted in slides_path (title + bullets + an emoji). */
export interface LectureSlide {
  title: string;
  bullets?: string[];
  emoji?: string;
}

/** Where a rendered lecture deck landed, for the player to download / link to. */
export interface SavedLectureDeck {
  provider: string;
  savedTo: string;
  downloadUrl?: string;
  url?: string;
  slides: number;
  fileName: string;
}

/**
 * @description Map Little Monsters lecture slides (title/bullets/emoji) into the generator's
 * RenderableSlide shape (title + newline-separated bullet body). The emoji is prefixed onto
 * the slide title so the deck keeps the lecture's visual cue.
 * @param slides - the lecture's persisted slides
 * @returns ordered renderable slides (empty when there is nothing to render)
 */
export function lectureSlidesToSections(slides: LectureSlide[] | undefined): RenderableSlide[] {
  return (Array.isArray(slides) ? slides : [])
    .filter((s) => s && typeof s.title === 'string' && s.title.trim())
    .map((s) => ({
      title: [s.emoji, s.title].filter(Boolean).join(' ').trim().slice(0, 200) || 'Slide',
      content: (Array.isArray(s.bullets) ? s.bullets : [])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .join('\n'),
    }));
}

/**
 * @description Render a lecture's slides to a real .pptx and save it to the caller's Files store
 * under the lecture-scribe bot's subfolder. Used both on demand (export button) and as the
 * automatic deliverable from /process-transcript.
 * @param ctx - app context (storage save layer needs the db pool + connector tokens)
 * @param sub - the caller's OIDC sub (keys the per-user Files store)
 * @param title - deck title (cover slide + file name)
 * @param slides - the lecture's persisted slides
 * @returns where the .pptx was saved + a download/view URL
 * @throws when there are no slides to render or the save target fails
 */
export async function renderAndSaveLectureDeck(
  ctx: AppContext, sub: string, title: string, slides: LectureSlide[] | undefined,
): Promise<SavedLectureDeck> {
  const sections = lectureSlidesToSections(slides);
  if (!sections.length) throw new Error('no slides to render for this lecture');
  const deckTitle = (title || 'Lecture').trim();
  const buf = await renderPptx(deckTitle, sections);
  const fileName = deckTitle.replace(/[^\w.\- ]/g, '_').slice(0, 80) + '.pptx';
  const saved = await saveContent(ctx, sub, 'files', fileName, buf, undefined, LECTURE_DECK_SUBFOLDER);
  logger.info({ sub, provider: saved.provider, location: saved.location, slides: sections.length }, 'Lecture deck rendered + saved');
  return {
    provider: saved.provider, savedTo: saved.location, downloadUrl: saved.downloadUrl,
    url: saved.url, slides: sections.length, fileName,
  };
}
