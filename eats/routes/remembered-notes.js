"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What the Eats concierge remembers, shown to the person and forgettable. Sweep 9: the concierge said "you want spicy food", a note the model had invented and saved in sweep 8 before the remember filter existed; the person could neither see nor remove it. And after it remembered "allergic to peanuts" the Dietary preferences card still read "No diet set". The saved notes are listed once each with whether they record an allergy, an intolerance or a diet, and a note is forgotten in every saved copy of the person's own.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the Per-order budget card read "Budget open" while the remembered list held "budget: cheap". A remembered note about spending (budget, cheap, affordable, a dollar cap) is marked budget, so the card shows it beside an unset dollar cap. Guard: tests/eats-remembered.test.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1 (UX audit 2026-11-06): "What the concierge remembers" listed the concierge's own state ("address: pending", "not on boarded", copied from its profile line) as things the person said, and listed one taste twice ("spicy preference" and "wants spicy food"). State notes leave the list, a note that says the same thing as a newer one is listed once (the newer), and Forget removes every copy that says the same thing. Guard: tests/eats-remembered-clean.test.js.
 */
/** What the Eats concierge remembers: the person's saved notes, listed and forgotten. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteKey = noteKey;
exports.isStateNote = isStateNote;
exports.conceptKey = conceptKey;
exports.rememberedList = rememberedList;
exports.forgetNote = forgetNote;
/** A note that records an allergy, an intolerance or a diet (the same words the chat route keeps whenever a diner states one). */
const RESTRICTION = /allerg|intoleran|celiac|coeliac|anaphyla|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;
/** A note about how much to spend: a budget, cheap or affordable, a price or a dollar cap ("under $30", "30 dollars"). */
const BUDGET = /budget|cheap|afford|inexpensive|\bpric(e|ey)|\bspend|\$\s?\d|\d+\s?(dollars|bucks)\b/;
/**
 * The concierge's own bookkeeping, saved as if the person had said it: a profile field with no value yet ("address:
 * pending", "diet: none", "budget: n/a"), and whether the person is onboarded. None is a taste, an allergy or a budget.
 */
const STATE_NOTE = /^(address|location|diet|dietary|cuisines?|budget|onboarded|profile|status)\s*[:=]\s*(pending|ask|unknown|unset|none|n\/a|any|tbd|not set|true|false|yes|no)?\s*$|^(not\s*)?on\s*-?\s*board(ed|ing)?$|^(not|un)\s*-?\s*onboarded$/;
/** Words that only frame a note ("wants", "preference", "food"); what is left is what the note is about. */
const FRAME = new Set(['a', 'an', 'the', 'i', 'me', 'my', 'is', 'are', 'to', 'of', 'for', 'and', 'likes', 'like', 'loves', 'love',
    'wants', 'want', 'prefers', 'prefer', 'preference', 'preferences', 'preferred', 'enjoys', 'enjoy', 'food', 'foods', 'dishes', 'dish', 'meal', 'meals']);
/** A table name this module may interpolate: the concierge store's own, never caller text. */
const TABLE = /^[a-z_]+$/;
/**
 * @description A note's comparison key: case and spacing do not make a different note.
 * @param note - Saved or requested note text.
 * @returns The key.
 */
function noteKey(note) {
    return String(note ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/**
 * @description Whether a note is the concierge's own bookkeeping rather than something the person said.
 * @param note - Saved note text.
 * @returns True for a state note ("address: pending", "not on boarded").
 */
function isStateNote(note) {
    return STATE_NOTE.test(noteKey(note));
}
/**
 * @description What a note is about, with the framing words dropped and the rest sorted: "spicy preference" and "wants
 * spicy food" are both "spicy". Two notes with one key say the same thing.
 * @param note - Saved note text.
 * @returns The key, or the plain note key when nothing but framing words is left.
 */
function conceptKey(note) {
    const key = noteKey(note);
    const words = key.replace(/[^a-z0-9$ ]+/g, ' ').split(' ').filter((w) => w && !FRAME.has(w));
    return words.length ? [...new Set(words)].sort().join(' ') : key;
}
/**
 * @description The saved notes, newest first, each once, marked when it records an allergy, an intolerance or a diet,
 * and when it is about how much to spend (the Per-order budget card shows it while no dollar cap is set).
 * @param notes - The concierge store's notes, newest first (a note saved many times appears many times).
 * @returns The distinct notes.
 */
function rememberedList(notes) {
    const seen = new Set(), out = [];
    for (const raw of notes || []) {
        const note = String(raw ?? '').replace(/\s+/g, ' ').trim(), key = noteKey(note), same = conceptKey(note);
        if (!key || isStateNote(note) || seen.has(same))
            continue;
        seen.add(same);
        out.push({ note, restriction: RESTRICTION.test(key), budget: BUDGET.test(key) });
    }
    return out;
}
/**
 * @description Forget one note in every saved copy of the caller's own. Under the native kernel the store keeps each note
 * as a person-scoped document (`<prefix>_concierge_feedback`, its body holding the note); the legacy framework keeps a
 * `<prefix>_feedback` row per note. Every statement is pinned to the caller.
 * @param pool - The package's pool.
 * @param store - The route's concierge store (its table names identify the runtime's layout).
 * @param sub - The verified caller.
 * @param note - The note to forget, as the profile listed it.
 * @returns How many saved copies were removed.
 */
async function forgetNote(pool, store, sub, note) {
    const key = noteKey(note);
    if (!key)
        return 0;
    const same = conceptKey(note);
    const documents = store?.feedback?.table;
    if (typeof documents === 'string' && TABLE.test(documents)) {
        const found = await pool.query(`SELECT id, body FROM ${documents} WHERE user_sub = $1`, [sub]);
        // Every copy that says the same thing goes, because the list showed them as one note.
        const ids = (found.rows || []).filter((row) => conceptKey((typeof row.body === 'string' ? JSON.parse(row.body) : row.body)?.note) === same).map((row) => String(row.id));
        for (const id of ids)
            await pool.query(`DELETE FROM ${documents} WHERE user_sub = $1 AND id = $2`, [sub, id]);
        return ids.length;
    }
    const rows = store?.fb;
    if (typeof rows === 'string' && TABLE.test(rows)) {
        const gone = await pool.query(`DELETE FROM ${rows} WHERE user_sub = $1 AND lower(btrim(regexp_replace(note, '\\s+', ' ', 'g'))) = $2`, [sub, key]);
        return Number(gone.rowCount || 0);
    }
    return 0;
}
//# sourceMappingURL=remembered-notes.js.map