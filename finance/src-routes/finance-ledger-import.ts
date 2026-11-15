/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A statement import in three steps a person controls: preview (read the file, pick or propose the account, show what would be added and what is already there; nothing but the preview record is written), apply (add at most 1,500 new transactions a call, safe to call again, then bring the account's balance to the statement's closing balance and rebuild the snapshot) and undo (take the import's transactions back out, and the account or balance it brought). A duplicate is the same bank id, or the same account, date, amount and description; it is skipped, never added twice. A transaction in a closed month is not added. A category comes from the file, then from the person's own rules, then from a small table of plain words, and is marked as a guess until the person reviews it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): undo also answers which transactions it took out (their ids and months), so the bills a removed payment had marked paid can be put back to due (VER2 on the test slot: after Undo the bill's matched payment stayed on Paid).
 */

/**
 * No framework runtime import: runs with plain node and a PostgreSQL pool in tests/ledger-import.test.cjs.
 *
 * @module finance-ledger-import
 */
import {
  LedgerRefusal, OWED_TYPES, ACCOUNT_TYPES, assertMonthOpen, cleanText, deleteAccount, deleteImportTransactions, ensureBook,
  fingerprint, hashId, insertAccount, insertImport, insertTransactions, isDate, lastFour, listAccounts, listImportTransactions,
  listImports, listMonths, listRules, matchText, monthClosed, monthOf, newId, nowStamp, readAccount, readBook, readImport,
  ruleCategory, saveAccount, saveImport, transactionId,
  type LedgerAccount, type LedgerBook, type LedgerDb, type LedgerImport, type LedgerRule, type LedgerTransaction,
} from './finance-ledger-store';
import { parseCsv, type NeedsColumns, type ParsedRow, type ParsedStatement, type ParseRefusal, type StatementAccount } from './finance-parse-csv';
import { looksLikeOfx, parseOfx } from './finance-parse-ofx';
import { parseStatementText } from './finance-parse-text';
import { rebuildSnapshot } from './finance-aggregate';

/** The most transactions one apply call adds, to stay inside the 60-second package call. */
export const APPLY_ROWS = 1500;
/** The kinds of import a person can undo: the ones a file produced. */
export const FILE_KINDS: readonly string[] = Object.freeze(['csv', 'ofx', 'text']);

/** Plain words that suggest a category. First match wins; the result is a guess the person reviews. */
const CATEGORY_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(payroll|paycheck|direct dep|salary|interest (paid|earned))\b/i, 'Income'],
  [/\b(transfer|xfer|payment thank you|card payment|autopay)\b/i, 'Transfer'],
  [/\b(loan payment|auto loan|student loan)\b/i, 'Loan payment'],
  [/\b(rent|apartments?|property management)\b/i, 'Rent'],
  [/\bmortgage\b/i, 'Mortgage'],
  [/\b(utilit\w*|electric|water|sewer|power|energy|internet|broadband|wireless)\b/i, 'Utilities'],
  [/\b(market|grocer\w*|supermarket|foods?)\b/i, 'Groceries'],
  [/\b(restaurant|trattoria|cafe|coffee|pizza|grill|diner|bistro|bakery)\b/i, 'Dining out'],
  [/\b(fuel|gas station|gasoline|petrol)\b/i, 'Gas'],
  [/\b(pharmacy|dental|dentist|clinic|hospital|medical|doctor|optical)\b/i, 'Health'],
  [/\binsurance\b/i, 'Insurance'],
  [/\b(streaming|subscription)\b/i, 'Streaming'],
  [/\b(fee|overdraft|service charge)\b/i, 'Fees'],
  [/\b(airline|hotel|lodging|travel)\b/i, 'Travel'],
  [/\b(tax|treasury)\b/i, 'Taxes'],
];

/** What a preview or an apply decided about one line of the file. */
export interface Candidate { row: ParsedRow; txn: LedgerTransaction; status: 'new' | 'duplicate' | 'closed' | 'added' }

/** The account an import will write to: one the person has, or one the import will create. */
export interface ImportAccount { account: LedgerAccount; isNew: boolean; guessed: boolean }

/** What a preview request carries. */
export interface PreviewInput {
  bookId: string;
  kind?: string;
  fileName?: string;
  text: string;
  accountId?: string;
  newAccount?: Record<string, unknown>;
  columnMap?: unknown;
  docId?: string;
}

/** A preview as the route answers it. */
export interface Preview { record: LedgerImport; target: ImportAccount | null; candidates: Candidate[]; parsed: ParsedStatement }

/**
 * @description The category a description suggests, from plain words only.
 * @param description - The transaction's description.
 * @param direction - Which way the money went.
 * @returns The suggested category ('Income' or 'Other' when no word matches).
 */
export function guessCategory(description: string, direction: 'in' | 'out'): string {
  for (const [words, category] of CATEGORY_WORDS) if (words.test(description)) return category;
  return direction === 'in' ? 'Income' : 'Other';
}

/**
 * @description Which reader a file needs: OFX by its own header, then the file's name, then its shape.
 * @param text - The file's text.
 * @param fileName - The file's name, when known.
 * @param kind - The kind the caller named, when it did.
 * @returns 'csv', 'ofx' or 'text'.
 */
export function kindOf(text: string, fileName: string = '', kind: string = ''): 'csv' | 'ofx' | 'text' {
  if (kind === 'csv' || kind === 'ofx' || kind === 'text') return kind;
  if (looksLikeOfx(text) || /\.(ofx|qfx)$/i.test(fileName)) return 'ofx';
  if (/\.(csv|tsv)$/i.test(fileName)) return 'csv';
  if (/\.(txt|pdf)$/i.test(fileName)) return 'text';
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
  // A comma inside an amount (1,450.00) is not a delimiter.
  const delimited = lines.filter((line) => (line.match(/,(?!\d{3}(?:\D|$))|[;\t]/g) || []).length >= 2).length;
  return lines.length && delimited >= Math.ceil(lines.length * 0.75) ? 'csv' : 'text';
}

/**
 * @description Read a statement with the reader its kind needs.
 * @param input - The preview request.
 * @returns The transactions, a request to match columns, or a refusal in words.
 */
export function readStatement(input: PreviewInput): ParsedStatement | NeedsColumns | ParseRefusal {
  const kind = kindOf(input.text, input.fileName, input.kind);
  if (kind === 'ofx') return parseOfx(input.text);
  if (kind === 'csv') return parseCsv(input.text, { columnMap: input.columnMap });
  return parseStatementText(input.text);
}

/** The words that say where an account's statement figures came from. */
function statementLabel(account: { institution: string; name: string }): string {
  return `${account.institution || account.name} statement`;
}

/** A new account as an import proposes it. The id is fixed at the preview so every apply call writes the same account. */
function proposedAccount(sub: string, bookId: string, spec: Record<string, unknown>, fromFile?: StatementAccount): LedgerAccount {
  const now = nowStamp();
  const type = ACCOUNT_TYPES.includes(String(spec.type || fromFile?.type)) ? String(spec.type || fromFile?.type) : 'depository';
  const subtype = cleanText(spec.subtype ?? fromFile?.subtype ?? '', 40);
  const institution = cleanText(spec.institution ?? fromFile?.institution ?? '', 80);
  const last4 = lastFour(spec.last4 ?? fromFile?.last4 ?? '');
  const fallback = [institution, subtype || (type === 'credit' ? 'card' : 'account'), last4 && `ending ${last4}`].filter(Boolean).join(' ');
  const name = cleanText(spec.name || fallback || 'Account', 80);
  return {
    accountId: typeof spec.accountId === 'string' && /^acct_[0-9a-f]{32}$/.test(spec.accountId) ? spec.accountId : newId('acct'),
    bookId, name, institution, type, subtype, last4, currency: cleanText(spec.currency ?? fromFile?.currency ?? 'USD', 3).toUpperCase() || 'USD',
    balanceCents: null, balanceAsOf: null, source: 'import', sourceLabel: statementLabel({ institution, name }), posture: '',
    linkId: '', importMap: null, state: 'open', createdAt: now, updatedAt: now,
  };
}

/** The account a file belongs to, among the person's accounts: the one named, else the one the file itself points at. */
async function existingTarget(db: LedgerDb, sub: string, input: PreviewInput, parsed: ParsedStatement): Promise<ImportAccount | null> {
  if (input.accountId) {
    const account = await readAccount(db, sub, input.accountId);
    if (!account || account.bookId !== input.bookId) throw new LedgerRefusal(404, 'unknown_account', 'That account is not in your records.');
    return { account, isNew: false, guessed: false };
  }
  const accounts = (await listAccounts(db, sub, input.bookId)).filter((a) => a.state === 'open' && a.source !== 'sample');
  const fromFile = parsed.account;
  const matches = fromFile?.last4
    ? accounts.filter((a) => a.last4 === fromFile.last4 && a.type === fromFile.type)
    : parsed.headerKey ? accounts.filter((a) => (a.importMap as { headerKey?: string } | null)?.headerKey === parsed.headerKey) : [];
  return matches.length === 1 ? { account: matches[0], isNew: false, guessed: true } : null;
}

/** The account an import will write to, or null when the person still has to choose one. */
async function targetOf(db: LedgerDb, sub: string, input: PreviewInput, parsed: ParsedStatement): Promise<ImportAccount | null> {
  const existing = await existingTarget(db, sub, input, parsed);
  if (existing) return existing;
  if (input.newAccount && typeof input.newAccount === 'object') return { account: proposedAccount(sub, input.bookId, input.newAccount, parsed.account), isNew: true, guessed: false };
  if (parsed.account?.last4) return { account: proposedAccount(sub, input.bookId, {}, parsed.account), isNew: true, guessed: true };
  return null;
}

/** One line of a file as the transaction it would become. */
function candidateOf(sub: string, account: LedgerAccount, row: ParsedRow, position: number, importId: string, rules: LedgerRule[]): LedgerTransaction {
  const now = nowStamp(), description = cleanText(row.description) || 'Transaction';
  const fromFile = cleanText(row.category || '', 60), fromRule = fromFile ? '' : ruleCategory(rules, description);
  return {
    txnId: transactionId(account.accountId, { bankRef: row.bankRef, date: row.date, amountCents: row.amountCents, direction: row.direction, description, position }),
    bookId: account.bookId, accountId: account.accountId, month: monthOf(row.date), date: row.date, amountCents: row.amountCents,
    direction: row.direction, currency: account.currency, description, merchant: description,
    category: fromFile || fromRule || guessCategory(description, row.direction), categorySource: fromFile ? 'file' : fromRule ? 'rule' : 'guess',
    review: 'new', flags: [], note: '', source: 'import', sourceLabel: statementLabel(account), sourceRef: cleanText(row.bankRef || '', 80),
    posture: '', importId, matchedBillId: '', matchedInvoiceId: '', createdAt: now, updatedAt: now,
  };
}

/** The same-account, same-day, same-amount, same-description key the second duplicate rule compares. */
function tupleKey(t: { accountId: string; date: string; amountCents: number; direction: string; description: string }): string {
  return [t.accountId, t.date, t.amountCents, t.direction, matchText(t.description)].join('\u001f');
}

/**
 * @description Decide, for every line of a file, whether it is new, already in the records, already
 * added by this import, or in a closed month. A duplicate is a row with the same id (the bank's own
 * id, or account, date, amount, description and position) or, failing that, an unclaimed row of the
 * same account, date, amount and description from another source.
 * @param db - The pool.
 * @param sub - The caller.
 * @param book - The set of records (for its closed months).
 * @param account - The account the file belongs to.
 * @param rows - The file's lines.
 * @param importId - This import.
 * @returns One candidate a line, in the file's order.
 */
export async function classify(db: LedgerDb, sub: string, book: LedgerBook | null, account: LedgerAccount, rows: ParsedRow[], importId: string): Promise<Candidate[]> {
  const rules = await listRules(db, sub, account.bookId);
  const seen = new Map<string, number>();
  const txns = rows.map((row) => {
    const key = tupleKey({ accountId: account.accountId, ...row });
    const position = seen.get(key) || 0;
    seen.set(key, position + 1);
    return candidateOf(sub, account, row, position, importId, rules);
  });
  const held = await listMonths(db, sub, account.bookId, txns.map((t) => t.month));
  const byId = new Map(held.map((t) => [t.txnId, t]));
  const unclaimed = new Map<string, number>();
  for (const t of held) if (t.accountId === account.accountId && t.importId !== importId) unclaimed.set(tupleKey(t), (unclaimed.get(tupleKey(t)) || 0) + 1);
  return txns.map((txn, index) => {
    const same = byId.get(txn.txnId), key = tupleKey(txn);
    if (same) return { row: rows[index], txn, status: same.importId === importId ? 'added' : 'duplicate' } as Candidate;
    if (monthClosed(book, txn.month)) return { row: rows[index], txn, status: 'closed' } as Candidate;
    if ((unclaimed.get(key) || 0) > 0) { unclaimed.set(key, (unclaimed.get(key) as number) - 1); return { row: rows[index], txn, status: 'duplicate' } as Candidate; }
    return { row: rows[index], txn, status: 'new' } as Candidate;
  });
}

/** How many candidates have a status. */
function count(candidates: Candidate[], status: Candidate['status']): number {
  return candidates.filter((c) => c.status === status).length;
}

/**
 * @description Read a statement and keep its preview: what would be added, what is already there,
 * the account it belongs to and the closing balance. Nothing but the preview record is written.
 * @param db - The pool.
 * @param sub - The caller.
 * @param input - The file and what the person chose.
 * @param parsed - The statement as read.
 * @returns The preview.
 */
export async function previewImport(db: LedgerDb, sub: string, input: PreviewInput, parsed: ParsedStatement): Promise<Preview> {
  const book = await ensureBook(db, sub, input.bookId);
  const target = await targetOf(db, sub, input, parsed);
  const importId = newId('imp');
  const candidates = target ? await classify(db, sub, book, target.account, parsed.rows, importId) : [];
  const record: LedgerImport = {
    importId, bookId: input.bookId, accountId: target && !target.isNew ? target.account.accountId : '',
    newAccount: target?.isNew ? { ...target.account } : null, kind: parsed.kind, fileName: cleanText(input.fileName || '', 120),
    fingerprint: fingerprint(input.text), periodStart: parsed.period?.start || null, periodEnd: parsed.period?.end || null,
    rowsTotal: parsed.rows.length, rowsNew: target ? count(candidates, 'new') : parsed.rows.length, rowsDuplicate: count(candidates, 'duplicate'),
    rowsUnreadable: parsed.unreadableCount, rowsAdded: 0, closingBalanceCents: parsed.closingBalance?.cents ?? null,
    closingBalanceAsOf: parsed.closingBalance?.asOf ?? null, columnMap: parsed.columnMap ? { headerKey: parsed.headerKey, map: parsed.columnMap } : null,
    pending: parsed.rows, state: 'previewed', docId: input.docId || '', createdAt: nowStamp(), appliedAt: null, undoneAt: null,
  };
  await insertImport(db, sub, record);
  return { record, target, candidates, parsed };
}

/**
 * @description The lines an import record still holds, checked on the way out of storage.
 * @param record - The import.
 * @returns Its waiting lines; anything that is not a dated amount is dropped.
 */
export function pendingRows(record: LedgerImport): ParsedRow[] {
  return (record.pending || []).filter((row): row is ParsedRow => {
    const r = row as ParsedRow;
    return Boolean(r) && isDate(r.date) && Number.isSafeInteger(r.amountCents) && r.amountCents > 0 && (r.direction === 'in' || r.direction === 'out');
  });
}

/** The account an apply call writes to, created now when the import proposed a new one. */
async function applyTarget(db: LedgerDb, sub: string, record: LedgerImport, choice: { accountId?: string; newAccount?: Record<string, unknown> }): Promise<{ account: LedgerAccount; created: boolean }> {
  const named = choice.accountId || record.accountId;
  if (named) {
    const account = await readAccount(db, sub, named);
    if (!account || account.bookId !== record.bookId) throw new LedgerRefusal(404, 'unknown_account', 'That account is not in your records.');
    return { account, created: false };
  }
  const spec = record.newAccount || (choice.newAccount && typeof choice.newAccount === 'object' ? choice.newAccount : null);
  if (!spec) throw new LedgerRefusal(400, 'account_required', 'Choose the account this statement belongs to, or name a new one.');
  const proposed = proposedAccount(sub, record.bookId, spec);
  const created = await insertAccount(db, sub, proposed);
  return { account: (await readAccount(db, sub, proposed.accountId)) || proposed, created };
}

/** After the last transaction is in: the statement's closing balance and, for a CSV, its column map are kept on the account. */
async function finishAccount(db: LedgerDb, sub: string, account: LedgerAccount, record: LedgerImport): Promise<Record<string, unknown> | null> {
  const before = { balanceCents: account.balanceCents, balanceAsOf: account.balanceAsOf, source: account.source, sourceLabel: account.sourceLabel, posture: account.posture };
  const next: LedgerAccount = { ...account };
  if (record.columnMap) next.importMap = record.columnMap;
  const newer = record.closingBalanceCents !== null && record.closingBalanceAsOf && (!account.balanceAsOf || record.closingBalanceAsOf >= account.balanceAsOf);
  if (newer) {
    // An OFX card or loan statement states what is owed as a negative balance; the account keeps the amount owed.
    next.balanceCents = OWED_TYPES.includes(account.type) && record.kind === 'ofx' ? -(record.closingBalanceCents as number) : record.closingBalanceCents;
    next.balanceAsOf = record.closingBalanceAsOf;
    next.source = 'import'; next.sourceLabel = statementLabel(account); next.posture = '';
  }
  if (newer || record.columnMap) await saveAccount(db, sub, next);
  return newer ? before : null;
}

/**
 * @description Add an import's new transactions, at most APPLY_ROWS a call. Safe to call again:
 * what an earlier call added is recognised and not added twice. When nothing is left the account is
 * brought to the statement's closing balance and the snapshot is rebuilt.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @param choice - The account, when the preview could not tell.
 * @returns The import as it now stands, what this call added and what is left.
 */
export async function applyImport(db: LedgerDb, sub: string, importId: string, choice: { accountId?: string; newAccount?: Record<string, unknown> } = {}): Promise<{ record: LedgerImport; added: number; remaining: number }> {
  const record = await readImport(db, sub, importId);
  if (!record || !FILE_KINDS.includes(record.kind)) throw new LedgerRefusal(404, 'unknown_import', 'That import is not in your records.');
  if (record.state === 'applied') return { record, added: 0, remaining: 0 };
  if (record.state === 'undone') throw new LedgerRefusal(409, 'import_undone', 'This import was undone. Add the file again to bring its transactions back.');
  const book = await ensureBook(db, sub, record.bookId);
  const { account, created } = await applyTarget(db, sub, record, choice);
  const candidates = await classify(db, sub, book, account, pendingRows(record), importId);
  const fresh = candidates.filter((c) => c.status === 'new');
  const { added } = await insertTransactions(db, sub, fresh.slice(0, APPLY_ROWS).map((c) => c.txn));
  const remaining = Math.max(0, fresh.length - APPLY_ROWS);
  const next: LedgerImport = {
    ...record, accountId: account.accountId, rowsAdded: count(candidates, 'added') + added, rowsDuplicate: count(candidates, 'duplicate'),
    rowsNew: remaining, state: remaining ? 'applying' : 'applied',
    newAccount: record.newAccount || created ? { ...(record.newAccount || {}), accountId: account.accountId, created: created || Boolean((record.newAccount as { created?: boolean } | null)?.created) } : null,
  };
  if (!remaining) {
    const before = await finishAccount(db, sub, account, record);
    next.newAccount = before ? { ...(next.newAccount || { accountId: account.accountId }), balanceBefore: before } : next.newAccount;
    next.pending = null; next.appliedAt = nowStamp();
  }
  await saveImport(db, sub, next);
  if (!remaining) await rebuildSnapshot(db, sub);
  return { record: next, added, remaining };
}

/** Whether anything but this import still stands on an account. */
async function accountStillUsed(db: LedgerDb, sub: string, record: LedgerImport): Promise<boolean> {
  const others = (await listImports(db, sub, record.bookId)).filter((i) => i.importId !== record.importId && i.state !== 'undone' && i.state !== 'previewed');
  if (others.some((i) => i.accountId === record.accountId)) return true;
  for (const other of others.filter((i) => !FILE_KINDS.includes(i.kind))) {
    if ((await listImportTransactions(db, sub, other.importId)).some((t) => t.accountId === record.accountId)) return true;
  }
  return false;
}

/** Take back what an import did to its account: remove the account it created, or restore the balance it replaced. */
async function undoAccount(db: LedgerDb, sub: string, record: LedgerImport): Promise<void> {
  const effects = record.newAccount as { created?: boolean; balanceBefore?: Record<string, unknown> } | null;
  const account = record.accountId ? await readAccount(db, sub, record.accountId) : null;
  if (!account || !effects) return;
  if (effects.created && !(await accountStillUsed(db, sub, record))) { await deleteAccount(db, sub, account.accountId); return; }
  const before = effects.balanceBefore as { balanceCents: number | null; balanceAsOf: string | null; source: LedgerAccount['source']; sourceLabel: string; posture: string } | undefined;
  if (before && account.balanceAsOf === record.closingBalanceAsOf && account.source === 'import') {
    await saveAccount(db, sub, { ...account, balanceCents: before.balanceCents, balanceAsOf: before.balanceAsOf, source: before.source, sourceLabel: before.sourceLabel, posture: before.posture });
  }
}

/**
 * @description Undo an import: its transactions leave the records, with the account it created or
 * the balance it brought, and the snapshot is rebuilt. An import with a transaction in a closed
 * month is refused until that month is reopened.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @returns The import as it now stands, how many transactions were removed, and which (their ids and months).
 */
export async function undoImport(db: LedgerDb, sub: string, importId: string): Promise<{ record: LedgerImport; removed: number; removedTxns: Array<{ txnId: string; month: string }> }> {
  const record = await readImport(db, sub, importId);
  if (!record) throw new LedgerRefusal(404, 'unknown_import', 'That import is not in your records.');
  if (record.kind === 'plaid') throw new LedgerRefusal(409, 'not_a_file', 'These transactions came from a bank link. Remove the link on Linked banks to stop reading that bank.');
  if (!FILE_KINDS.includes(record.kind)) throw new LedgerRefusal(409, 'not_a_file', 'Only a statement you added can be undone here.');
  if (record.state === 'undone') return { record, removed: 0, removedTxns: [] };
  const book = await readBook(db, sub, record.bookId);
  const taken = await listImportTransactions(db, sub, importId);
  for (const t of taken) assertMonthOpen(book, t.month);
  const removed = await deleteImportTransactions(db, sub, importId);
  await undoAccount(db, sub, record);
  const next: LedgerImport = { ...record, state: 'undone', pending: null, rowsAdded: 0, undoneAt: nowStamp() };
  await saveImport(db, sub, next);
  await rebuildSnapshot(db, sub);
  return { record: next, removed, removedTxns: taken.map((t) => ({ txnId: t.txnId, month: t.month })) };
}

/**
 * @description The id of the record that stands for everything a person typed into a set of records.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The import id.
 */
export function typedImportId(sub: string, bookId: string): string {
  return hashId('imp', sub, bookId, 'typed');
}
