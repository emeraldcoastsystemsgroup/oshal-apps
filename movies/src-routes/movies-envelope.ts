/**
 * Movies concierge reply envelope: the model's JSON reply → { say, show, watchlist, remember }.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | UX audit 2026-11-06 (movies--movies-concierge, FIX-BROKEN): the concierge printed the raw object ({"say":…,"show":[]…}) as its reply. The parse came from the framework's concierge-envelope helpers, and the native kernel's compatibility shim answers {} for any string, so every reply fell back to the raw model text. This package-local parser reads the envelope itself: inside a ```json fence, inside prose, or bare. A reply that is plainly an envelope but cannot be read becomes a plain apology, never the raw object; plain prose stays the reply.
 *
 * @module movies-envelope
 */

/** The typed envelope the Movies concierge route acts on. */
export interface ChatEnvelope { say: string; show: string[]; watchlist: string[]; remember: string[]; }

/** What the concierge says when the model's reply was an envelope it could not read. */
export const ENVELOPE_APOLOGY = 'Sorry, I lost my train of thought there. Could you ask me that again?';

const FENCE = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
const ENVELOPE_HINT = /[{]\s*"(?:say|show|watchlist|remember)"\s*:/;

/**
 * @description The text pieces that may hold the envelope: each fenced block first, then the whole reply.
 * @param {string} text The model's reply.
 * @returns {string[]} Candidate texts, most specific first.
 */
function candidateTexts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FENCE)) if (m[1].trim()) out.push(m[1].trim());
  out.push(text);
  return out;
}

/**
 * @description Parse the first balanced JSON object that starts at or after `from`; string contents are skipped so a brace inside a reply does not end it early.
 * @param {string} s The text to scan.
 * @param {number} from Where the object's opening brace is.
 * @returns {Record<string, unknown> | null} The object, or null when the braces never balance or the slice is not JSON.
 */
function balancedObjectAt(s: string, from: number): Record<string, unknown> | null {
  let depth = 0; let inString = false; let escaped = false;
  for (let i = from; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) {
      try {
        const o = JSON.parse(s.slice(from, i + 1));
        return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null;
      } catch { return null; }
    }
  }
  return null;
}

/**
 * @description Find the envelope object in a reply: in a code fence, wrapped in prose, or bare.
 * @param {string} text The model's reply.
 * @returns {Record<string, unknown> | null} The first JSON object found, or null.
 */
export function extractEnvelopeObject(text: string): Record<string, unknown> | null {
  for (const s of candidateTexts(String(text || ''))) {
    for (let at = s.indexOf('{'); at !== -1; at = s.indexOf('{', at + 1)) {
      const o = balancedObjectAt(s, at);
      if (o) return o;
    }
  }
  return null;
}

/**
 * @description Coerce a value to a clean list of non-empty strings; anything that is not a list is an empty list.
 * @param {unknown} v The envelope field.
 * @returns {string[]} The strings.
 */
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.length > 0) : [];
}

/**
 * @description The reply with every fenced block removed, for prose that wraps an envelope or a reply with no envelope.
 * @param {string} text The model's reply.
 * @returns {string} The prose, trimmed.
 */
function proseOf(text: string): string {
  return text.replace(FENCE, ' ').replace(/\s+\n/g, '\n').trim();
}

/**
 * @description Parse the Movies concierge reply. The `say` is never the raw envelope: an unreadable envelope becomes ENVELOPE_APOLOGY.
 * @param {string} text The model's reply (may be empty when the model did not answer).
 * @returns {ChatEnvelope} The envelope; `say` is '' only when the reply was empty.
 */
export function parseMoviesEnvelope(text: string): ChatEnvelope {
  const raw = String(text || '').trim();
  const empty: ChatEnvelope = { say: '', show: [], watchlist: [], remember: [] };
  if (!raw) return empty;
  const o = extractEnvelopeObject(raw);
  if (!o) return { ...empty, say: ENVELOPE_HINT.test(raw) || raw.startsWith('{') ? ENVELOPE_APOLOGY : (proseOf(raw) || ENVELOPE_APOLOGY) };
  const say = typeof o.say === 'string' && o.say.trim() ? o.say.trim() : ENVELOPE_APOLOGY;
  return { say, show: strings(o.show), watchlist: strings(o.watchlist), remember: strings(o.remember) };
}
