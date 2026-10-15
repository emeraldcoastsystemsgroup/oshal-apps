/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What the Eats concierge remembers, shown to the person and forgettable. Sweep 9: the concierge said "you want spicy food", a note the model had invented and saved in sweep 8 before the remember filter existed; the person could neither see nor remove it. And after it remembered "allergic to peanuts" the Dietary preferences card still read "No diet set". The saved notes are listed once each with whether they record an allergy, an intolerance or a diet, and a note is forgotten in every saved copy of the person's own.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the Per-order budget card read "Budget open" while the remembered list held "budget: cheap". A remembered note about spending (budget, cheap, affordable, a dollar cap) is marked budget, so the card shows it beside an unset dollar cap. Guard: tests/eats-remembered.test.js.
 */
/** What the Eats concierge remembers: the person's saved notes, listed and forgotten. */

/** A note that records an allergy, an intolerance or a diet (the same words the chat route keeps whenever a diner states one). */
const RESTRICTION = /allerg|intoleran|celiac|coeliac|anaphyla|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;
/** A note about how much to spend: a budget, cheap or affordable, a price or a dollar cap ("under $30", "30 dollars"). */
const BUDGET = /budget|cheap|afford|inexpensive|\bpric(e|ey)|\bspend|\$\s?\d|\d+\s?(dollars|bucks)\b/;
/** A table name this module may interpolate: the concierge store's own, never caller text. */
const TABLE = /^[a-z_]+$/;

/** One remembered note as the profile answers it: whether it records a restriction, and whether it is about spending. */
export interface Remembered { note: string; restriction: boolean; budget: boolean }

/** The minimum of a query pool these helpers use. */
interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

/**
 * @description A note's comparison key: case and spacing do not make a different note.
 * @param note - Saved or requested note text.
 * @returns The key.
 */
export function noteKey(note: unknown): string {
  return String(note ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @description The saved notes, newest first, each once, marked when it records an allergy, an intolerance or a diet,
 * and when it is about how much to spend (the Per-order budget card shows it while no dollar cap is set).
 * @param notes - The concierge store's notes, newest first (a note saved many times appears many times).
 * @returns The distinct notes.
 */
export function rememberedList(notes: unknown[]): Remembered[] {
  const seen = new Set<string>(), out: Remembered[] = [];
  for (const raw of notes || []) {
    const note = String(raw ?? '').replace(/\s+/g, ' ').trim(), key = noteKey(note);
    if (!key || seen.has(key)) continue;
    seen.add(key);
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
export async function forgetNote(pool: Queryable, store: any, sub: string, note: string): Promise<number> {
  const key = noteKey(note);
  if (!key) return 0;
  const documents = store?.feedback?.table;
  if (typeof documents === 'string' && TABLE.test(documents)) {
    const found = await pool.query(`SELECT id, body FROM ${documents} WHERE user_sub = $1`, [sub]);
    const ids = (found.rows || []).filter((row) => noteKey((typeof row.body === 'string' ? JSON.parse(row.body) : row.body)?.note) === key).map((row) => String(row.id));
    for (const id of ids) await pool.query(`DELETE FROM ${documents} WHERE user_sub = $1 AND id = $2`, [sub, id]);
    return ids.length;
  }
  const rows = store?.fb;
  if (typeof rows === 'string' && TABLE.test(rows)) {
    const gone = await pool.query(`DELETE FROM ${rows} WHERE user_sub = $1 AND lower(btrim(regexp_replace(note, '\\s+', ' ', 'g'))) = $2`, [sub, key]);
    return Number(gone.rowCount || 0);
  }
  return 0;
}
