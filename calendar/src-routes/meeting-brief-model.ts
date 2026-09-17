/**
 * Calendar Preparation — the PURE half of the meeting-brief agent.
 *
 * Deliberately import-free (no `@/…`, no pg, no express) for the same reason bake-off's scoring
 * module is: the honesty rules that make a brief trustworthy are string and set arithmetic, and
 * arithmetic is the part a dependency-free `node --test` suite can cover against the COMPILED js
 * — the same bytes the framework requires at mount.
 *
 * The rules encoded here are the reason a brief is worth reading:
 *   1. EVERY claim carries the record that produced it. A candidate with no citable row id, or
 *      with no citable timestamp, is DROPPED — it is never rendered with a placeholder source, and
 *      there is no code path that emits a sentence nobody recorded.
 *   2. AMBIENT MATERIAL IS CITED, NEVER COPIED. A transcript or daily-review claim states only
 *      that the record exists and when, and names its row id; the recorded WORDS are not in this
 *      module's input type at all, so there is no expression here that can render them. A
 *      prior-meeting claim states only the title and date already on this package's own stored
 *      row. Nothing is summarised, inferred or generated. The module header of meeting-briefs.ts
 *      records why a copy would outlive the controls that govern the original.
 *   3. No history is stated as no history. When nothing survives rule 1 the brief says
 *      "No prior context recorded for this meeting." — never a plausible-sounding background.
 *   4. What the brief does NOT hold is printed beside what it does. The preparation snapshot
 *      carries no attendees, so every brief says so rather than leaving the reader to assume
 *      the absence means "no attendees"; the same block says recorded words are cited rather
 *      than copied, and that voices outside the owner's ambient consent settings are not cited
 *      at all, so a withheld history never reads as an empty one.
 *   5. One rendering. `deliveryText` is built once and stored on the row; the notification and
 *      the surface both show that string, so what was delivered and what is read cannot drift.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Assemble a cited per-meeting brief from previously recorded material, drop uncitable candidates, and render the one delivery text the notification and the surface share.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cite ambient material instead of quoting it. An excerpt copied into the delivery text becomes a durable second copy in both jarvis_tasks.result and calendar_meeting_briefs.brief, and no ambient control reaches either one: a deleted day, an expired retention window, or a consent a heard person later withdraws would all leave the words standing. The recorded text is therefore no longer part of this module's input type, which makes the copy unexpressible rather than merely absent.
 *
 * @module meeting-brief-model
 */

/** Record classes a claim may cite. Each maps to a row the caller already owns. */
export type BriefSourceKind = 'prior-meeting' | 'transcript' | 'daily-review';

/** The exact record that produced one claim. `id` is the stored row's primary key. */
export interface BriefSource {
  kind: BriefSourceKind;
  id: string;
  label: string;
  at: string;
}

/** One sentence of a brief and the record it came from. There is no uncited claim. */
export interface BriefClaim {
  text: string;
  source: BriefSource;
}

/** A previously briefed occurrence of the same meeting series. */
export interface PriorOccurrence {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

/**
 * A citation of an ambient transcript segment captured inside a prior occurrence's window. There
 * is deliberately NO text field: the recorded words stay in `ambient_transcript_segments`, under
 * the owner's retention, deletion and per-speaker consent controls.
 */
export interface TranscriptEvidence {
  segmentId: string;
  capturedAt: string;
  occurrenceStartsAt: string;
}

/**
 * A citation of an ambient daily review recorded on the day of a prior occurrence. As with a
 * transcript segment, the review's own words are not carried here, only the row that holds them.
 */
export interface ReviewEvidence {
  reviewId: string;
  localDate: string;
}

/** The upcoming event a brief is assembled for, as stored in the preparation snapshot. */
export interface BriefEvent {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  allDay?: boolean;
}

/** Everything the assembler is allowed to read, already fetched and owner-scoped by the caller. */
export interface MeetingBriefInput {
  event: BriefEvent;
  builtAt: string;
  priorOccurrences?: readonly PriorOccurrence[];
  transcripts?: readonly TranscriptEvidence[];
  reviews?: readonly ReviewEvidence[];
  /** False when ambient capture is off for this owner: nothing recorded was read. */
  ambientAuthorized?: boolean;
  maxClaims?: number;
  excerptChars?: number;
}

/** The assembled document. `deliveryText` is the single rendering both channels show. */
export interface MeetingBrief {
  eventId: string;
  seriesKey: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  builtAt: string;
  hasHistory: boolean;
  claims: BriefClaim[];
  limits: string[];
  deliveryText: string;
}

/** The exact sentence an empty brief says. Never a plausible-sounding substitute. */
export const NO_PRIOR_CONTEXT = 'No prior context recorded for this meeting.';
/** Always true today: the preparation snapshot stores titles, times and links only. */
export const NO_ATTENDEES_LIMIT =
  'Attendees are not in this brief: the calendar snapshot records event titles, times and links only.';
/** Printed when ambient capture is off, so an empty brief is not read as an empty history. */
export const AMBIENT_OFF_LIMIT =
  'Recorded conversation was not read: ambient capture is off for this account.';
/**
 * Printed whenever ambient material could be cited. A brief that copied the words would leave a
 * second, permanent copy where the owner's ambient controls do not reach, so it holds the citation
 * and says where the words themselves still live.
 */
export const AMBIENT_CITED_NOT_COPIED_LIMIT =
  'Recorded conversation is cited here, never copied: the words stay in your ambient record, where '
  + 'your retention, deletion and per-speaker consent settings still reach them. Open Ambient to read them.';
/**
 * Printed beside it: only voices the owner's ambient consent settings include are cited, so a
 * history withheld for consent reasons is never mistaken for a history that was empty.
 */
export const AMBIENT_CONSENT_LIMIT =
  'Only voices your ambient consent settings include are cited; recorded conversation involving '
  + 'anyone else is left out of this brief entirely.';

const DEFAULT_MAX_CLAIMS = 6;
const DEFAULT_EXCERPT_CHARS = 240;
const MAX_TITLE_CHARS = 120;
const MAX_SERIES_KEY_CHARS = 120;

/**
 * @description Normalise a meeting title into the key that links occurrences of one recurring
 * series. Case, punctuation and repeated whitespace are noise a calendar reliably varies; the
 * words are not. An empty or unusable title collapses to `untitled`, which links only to other
 * untitled events rather than to everything.
 * @param title - The raw event title.
 * @returns A lowercase word key of at most 120 characters, never empty.
 */
export function seriesKeyFor(title: unknown): string {
  const words = String(typeof title === 'string' ? title : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return words ? words.slice(0, MAX_SERIES_KEY_CHARS).trim() : 'untitled';
}

/**
 * @description Trim recorded text to one printable excerpt without changing its words. Control
 * characters and line breaks are collapsed to spaces so a delivered brief stays one readable
 * block; an over-long excerpt is cut and marked with an ellipsis rather than paraphrased.
 * @param value - The stored text to excerpt.
 * @param limit - Maximum characters to keep.
 * @returns The verbatim excerpt, or an empty string when nothing printable remains.
 */
export function excerpt(value: unknown, limit: number): string {
  const text = String(typeof value === 'string' ? value : '')
    .replace(/[ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_EXCERPT_CHARS;
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

/** @description Accept only a non-blank, control-character-free row id short enough to print. */
function citableId(value: unknown): string {
  const id = String(typeof value === 'string' ? value : '').trim();
  return id && id.length <= 200 && !/[ -]/.test(id) ? id : '';
}

/** @description Accept only a timestamp the caller's row actually carried. */
function citableAt(value: unknown): string {
  const at = String(typeof value === 'string' ? value : '').trim();
  return at && at.length <= 64 && !/[ -]/.test(at) ? at : '';
}

/** @description Build one claim, or nothing at all when it would be uncitable or empty. */
function claim(text: string, kind: BriefSourceKind, id: unknown, label: string, at: unknown): BriefClaim | null {
  const sourceId = citableId(id);
  const sourceAt = citableAt(at);
  const body = text.trim();
  if (!sourceId || !sourceAt || !body) return null;
  return { text: body, source: { kind, id: sourceId, label, at: sourceAt } };
}

/** @description State a prior occurrence using only the title and date on its stored row. */
function priorMeetingClaims(priors: readonly PriorOccurrence[], chars: number): BriefClaim[] {
  const claims: BriefClaim[] = [];
  for (const prior of priors) {
    const title = excerpt(prior.title, MAX_TITLE_CHARS);
    const when = citableAt(prior.startsAt);
    if (!title || !when) continue;
    const built = claim(
      `You last met for "${excerpt(title, chars)}" on ${when}.`,
      'prior-meeting', prior.eventId, 'a brief already recorded for this meeting series', prior.startsAt,
    );
    if (built) claims.push(built);
  }
  return claims;
}

/**
 * @description Point at recorded conversation without reproducing it. The claim states that a
 * segment exists inside that occurrence's window and names its row id; the recorded words are not
 * available to this function, so there is nothing here that could copy them.
 */
function transcriptClaims(segments: readonly TranscriptEvidence[]): BriefClaim[] {
  const claims: BriefClaim[] = [];
  for (const segment of segments) {
    const when = citableAt(segment.occurrenceStartsAt);
    if (!when) continue;
    const built = claim(
      `Recorded conversation from that meeting is on file (that occurrence started ${when}).`,
      'transcript', segment.segmentId, 'your ambient transcript', segment.capturedAt,
    );
    if (built) claims.push(built);
  }
  return claims;
}

/** @description Point at the caller's own recorded daily review for the day of a prior occurrence. */
function reviewClaims(reviews: readonly ReviewEvidence[]): BriefClaim[] {
  const claims: BriefClaim[] = [];
  for (const review of reviews) {
    const when = citableAt(review.localDate);
    if (!when) continue;
    const built = claim(
      `A daily review is recorded for ${when}.`,
      'daily-review', review.reviewId, 'your ambient daily review', review.localDate,
    );
    if (built) claims.push(built);
  }
  return claims;
}

/** @description Render one claim as the cited line both the notification and the surface show. */
function claimLine(entry: BriefClaim): string {
  return `- ${entry.text}\n  Source: ${entry.source.label} [${entry.source.kind} ${entry.source.id}] recorded ${entry.source.at}`;
}

/**
 * @description Render the one delivery text. The notification carries this string and the surface
 * displays the stored copy of it, so the two cannot drift apart. When no claim survived, the body
 * is the fixed no-context sentence rather than anything that reads like background.
 * @param brief - The assembled brief, minus its own delivery text.
 * @returns The exact text delivered and displayed.
 */
export function renderDeliveryText(brief: Omit<MeetingBrief, 'deliveryText'>): string {
  const body = brief.claims.length ? brief.claims.map(claimLine).join('\n') : NO_PRIOR_CONTEXT;
  const limits = brief.limits.map((line) => `- ${line}`).join('\n');
  return [
    `Meeting brief: ${brief.title}`,
    `Starts ${brief.startsAt}${brief.endsAt ? ` and ends ${brief.endsAt}` : ''}.`,
    '',
    body,
    '',
    'What this brief does not hold:',
    limits,
  ].join('\n');
}

/**
 * @description Assemble one meeting's brief from material the caller already recorded. Every
 * claim is a plain statement about a row that is cited by id (ambient words are pointed at, never
 * reproduced), and a candidate that cannot be cited is dropped rather than softened, so an
 * assembled brief with no history is honestly empty instead of plausibly full.
 * @param input - The upcoming event plus the owner-scoped records already fetched for it.
 * @returns The stored brief document, including the single rendering both channels show.
 */
export function buildMeetingBrief(input: MeetingBriefInput): MeetingBrief {
  const chars = Number.isFinite(input.excerptChars) && Number(input.excerptChars) > 0
    ? Math.floor(Number(input.excerptChars)) : DEFAULT_EXCERPT_CHARS;
  const cap = Number.isFinite(input.maxClaims) && Number(input.maxClaims) > 0
    ? Math.floor(Number(input.maxClaims)) : DEFAULT_MAX_CLAIMS;
  const claims = [
    ...priorMeetingClaims(input.priorOccurrences ?? [], chars),
    ...transcriptClaims(input.transcripts ?? []),
    ...reviewClaims(input.reviews ?? []),
  ].slice(0, cap);
  const limits = [NO_ATTENDEES_LIMIT];
  if (input.ambientAuthorized === true) limits.push(AMBIENT_CITED_NOT_COPIED_LIMIT, AMBIENT_CONSENT_LIMIT);
  else limits.push(AMBIENT_OFF_LIMIT);
  const assembled: Omit<MeetingBrief, 'deliveryText'> = {
    eventId: String(input.event.id),
    seriesKey: seriesKeyFor(input.event.title),
    title: excerpt(input.event.title, MAX_TITLE_CHARS) || 'Untitled event',
    startsAt: String(input.event.start),
    endsAt: input.event.end ? String(input.event.end) : null,
    builtAt: String(input.builtAt),
    hasHistory: claims.length > 0,
    claims,
    limits,
  };
  return { ...assembled, deliveryText: renderDeliveryText(assembled) };
}
