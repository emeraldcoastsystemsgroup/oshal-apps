"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planNativeReconciliation = planNativeReconciliation;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Plan account/book-bound historical closes with exact rational replay; refuse ambiguous allocation, missing buys and incomplete venue evidence.
 */
const node_crypto_1 = require("node:crypto");
/** Exact fractions avoid cumulative float errors in fractional quantities, partial fills and FIFO. */
class Amount {
    n;
    d;
    constructor(n, d = 1n) {
        this.n = n;
        this.d = d;
        if (d <= 0n)
            throw Error('Invalid decimal evidence.');
    }
    static of(value) {
        if (typeof value !== 'number' && typeof value !== 'string')
            throw Error('Missing numeric evidence.');
        const s = String(value), m = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
        if (!m || s.length > 80)
            throw Error('Invalid numeric evidence.');
        const exp = Number(m[4] || 0) - (m[3] || '').length;
        if (Math.abs(exp) > 30)
            throw Error('Numeric evidence exceeds supported precision.');
        const n = BigInt((m[1] || '') + m[2] + (m[3] || ''));
        return exp >= 0 ? new Amount(n * 10n ** BigInt(exp)) : new Amount(n, 10n ** BigInt(-exp));
    }
    add(b) { return new Amount(this.n * b.d + b.n * this.d, this.d * b.d).reduce(); }
    sub(b) { return this.add(new Amount(-b.n, b.d)); }
    mul(b) { return new Amount(this.n * b.n, this.d * b.d).reduce(); }
    div(b) { if (b.n <= 0n)
        throw Error('Non-positive execution quantity.'); return new Amount(this.n * b.d, this.d * b.n).reduce(); }
    cmp(b) { const a = this.n * b.d - b.n * this.d; return a < 0n ? -1 : a > 0n ? 1 : 0; }
    abs() { return new Amount(this.n < 0n ? -this.n : this.n, this.d); }
    reduce() { let a = this.n < 0n ? -this.n : this.n, b = this.d; while (b) {
        const c = a % b;
        a = b;
        b = c;
    } return new Amount(this.n / a, this.d / a); }
    toString() { const negative = this.n < 0n, n = negative ? -this.n : this.n; const scaled = (n * 10n ** 12n + this.d / 2n) / this.d; return (negative ? '-' : '') + (scaled / 10n ** 12n) + '.' + String(scaled % 10n ** 12n).padStart(12, '0'); }
}
const ZERO = Amount.of(0), EPS = Amount.of('0.000001'), PRICE = Amount.of('0.02');
const num = (r, k) => Amount.of(r[k]);
const sum = (rs, f) => rs.reduce((a, r) => a.add(f(r)), ZERO);
const close = (a, b, tol = EPS) => a.sub(b).abs().cmp(tol) <= 0;
const id = (r, k) => { const s = r[k]; if (typeof s !== 'string' || !s || s.length > 200)
    throw Error('Missing execution identity.'); return s; };
const time = (value) => { if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw Error('Execution timestamp lacks a valid timezone.'); return Date.parse(value); };
const stable = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(stable(value)).digest('hex');
function uuid(name) {
    const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
    const bytes = (0, node_crypto_1.createHash)('sha1').update(namespace).update(name).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function executionTime(row) {
    const trade = time(row.tradeDate), activity = row.activityAt ? time(row.activityAt) : trade;
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(zone.formatToParts(trade).map(p => [p.type, p.value]));
    if (parts.hour === '00' && parts.minute === '00' && parts.second === '00' && trade % 1000 === 0 && zone.format(trade).slice(0, 10) === zone.format(activity).slice(0, 10))
        return new Date(activity).toISOString();
    return new Date(trade).toISOString();
}
function reviewSymbol(book, symbol, ledger, evidence, held) {
    const result = { symbol, action: 'refuse', corrections: [] };
    try {
        if (held.cmp(ZERO) < 0)
            throw Error('Short positions require allocation review.');
        const unique = new Map();
        for (const row of evidence) {
            const key = id(row, 'transactionId');
            if (unique.has(key) && stable(unique.get(key)) !== stable(row))
                throw Error('Conflicting execution copies.');
            unique.set(key, row);
        }
        let trades = [...unique.values()];
        for (const t of trades) {
            if (!['buy', 'sell'].includes(String(t.side)) || num(t, 'qty').cmp(ZERO) <= 0 || num(t, 'price').cmp(ZERO) <= 0 || num(t, 'fees').cmp(ZERO) < 0)
                throw Error('Invalid equity execution.');
            time(t.tradeDate);
            if (t.activityAt)
                time(t.activityAt);
        }
        const filled = ledger.filter(r => r.status === 'filled');
        const buys = new Set(filled.filter(r => r.side === 'buy' && r.broker_order_id).map(r => String(r.broker_order_id)));
        const starts = trades.filter(t => t.side === 'buy' && buys.has(String(t.orderId))).map(t => time(t.tradeDate));
        if (starts.length) {
            const start = Math.min(...starts);
            trades = trades.filter(t => time(t.tradeDate) >= start);
        }
        if (!close(sum(trades, t => t.side === 'buy' ? num(t, 'qty') : ZERO.sub(num(t, 'qty'))), held))
            throw Error('Venue replay differs from current holdings; opening history or non-trade changes require review.');
        const groups = new Map();
        for (const row of trades) {
            const key = String(row.orderId || 'activity:' + id(row, 'transactionId'));
            groups.set(key, [...(groups.get(key) || []), row]);
        }
        const booked = new Map();
        for (const row of filled) {
            if (!['buy', 'sell'].includes(String(row.side)) || num(row, 'filled_qty').cmp(ZERO) <= 0 || num(row, 'filled_avg_price').cmp(ZERO) <= 0)
                throw Error('Invalid filled ledger row.');
            let key = String(row.broker_order_id || '');
            if (!groups.has(key)) {
                const candidates = [...groups].filter(([, fs]) => {
                    const qty = sum(fs, t => num(t, 'qty')), price = sum(fs, t => num(t, 'qty').mul(num(t, 'price'))).div(qty);
                    return fs.every(t => t.side === row.side) && close(qty, num(row, 'filled_qty')) && close(price, num(row, 'filled_avg_price'), PRICE) && fs.some(t => Math.abs(time(t.activityAt || t.tradeDate) - time(row.created_at)) <= 21600000);
                });
                if (candidates.length !== 1)
                    throw Error('Missing order ID has no unique venue match.');
                key = candidates[0][0];
            }
            booked.set(key, [...(booked.get(key) || []), row]);
        }
        const matched = new Set();
        for (const [key, old] of booked) {
            const fs = groups.get(key);
            if (new Set([...fs, ...old].map(r => r.side)).size !== 1)
                throw Error('Order side conflict.');
            const qty = sum(fs, t => num(t, 'qty')), original = sum(old, t => num(t, 'filled_qty'));
            if (!close(qty, original))
                throw Error('Partial fill or duplicate ledger quantity needs review.');
            if (!close(sum(fs, t => num(t, 'qty').mul(num(t, 'price'))).div(qty), sum(old, t => num(t, 'filled_qty').mul(num(t, 'filled_avg_price'))).div(original), PRICE))
                throw Error('Ledger and venue fill price conflict.');
            fs.forEach(t => matched.add(id(t, 'transactionId')));
        }
        const pending = trades.filter(t => !matched.has(id(t, 'transactionId')));
        if (pending.some(t => t.side === 'buy'))
            throw Error('Unbooked buys require allocation review; manual holdings are never enrolled automatically.');
        const bases = new Map();
        if (pending.length) {
            const stamps = new Map();
            for (const t of trades) {
                const stamp = time(t.activityAt || t.tradeDate), sides = stamps.get(stamp) || new Set();
                sides.add(t.side);
                stamps.set(stamp, sides);
            }
            if ([...stamps.values()].some(s => s.size > 1))
                throw Error('Buy/sell ordering is ambiguous at the same timestamp.');
            const lots = [];
            for (const t of [...trades].sort((a, b) => time(a.activityAt || a.tradeDate) - time(b.activityAt || b.tradeDate) || id(a, 'transactionId').localeCompare(id(b, 'transactionId')))) {
                if (t.side === 'buy') {
                    lots.push({ qty: num(t, 'qty'), price: num(t, 'price') });
                    continue;
                }
                let remaining = num(t, 'qty'), cost = ZERO;
                while (remaining.cmp(EPS) > 0) {
                    const lot = lots[0];
                    if (!lot)
                        throw Error('FIFO opening lots are missing; older history or transfers require review.');
                    const used = remaining.cmp(lot.qty) < 0 ? remaining : lot.qty;
                    cost = cost.add(used.mul(lot.price));
                    remaining = remaining.sub(used);
                    lot.qty = lot.qty.sub(used);
                    if (lot.qty.cmp(EPS) <= 0)
                        lots.shift();
                }
                bases.set(id(t, 'transactionId'), cost.div(num(t, 'qty')));
            }
        }
        const net = sum(filled, r => r.side === 'buy' ? num(r, 'filled_qty') : ZERO.sub(num(r, 'filled_qty')));
        if (!close(net.sub(sum(pending, t => num(t, 'qty'))), held))
            throw Error('Proposed ledger replay does not match current holdings.');
        const corrections = pending.map(t => {
            const identity = `oshal:venue-reconcile:v1:${book}:${id(t, 'transactionId')}`, qty = num(t, 'qty'), price = num(t, 'price'), basis = bases.get(id(t, 'transactionId')), fees = num(t, 'fees');
            return { order_id: uuid(identity), decision_id: uuid(identity + ':decision'), client_order_id: `reconcile:native:${t.transactionId}:${book}`, broker_order_id: t.orderId || null, transaction_id: t.transactionId, symbol, side: 'sell', qty: qty.toString(), filled_qty: qty.toString(), filled_avg_price: price.toString(), cost_basis: basis.toString(), fees: fees.toString(), realized_pnl: price.sub(basis).mul(qty).sub(fees).toString(), created_at: executionTime(t), venue_trade_date: t.tradeDate, book_id: book, mode: 'live', broker: 'schwab', status: 'filled', raw_status: 'RECONCILE_NATIVE_VENUE', order_type: 'market' };
        });
        return { symbol, action: corrections.length ? 'book' : 'already-clean', ledgerNet: net.toString(), venueQty: held.toString(), corrections };
    }
    catch (error) {
        result.reason = error.message;
        return result;
    }
}
/** Accept only kernel-resolved account/book identity and current complete venue evidence. */
function planNativeReconciliation(ledger, venue) {
    if (!ledger.accountId || ledger.accountId !== venue.accountId || !ledger.accountBinding || ledger.accountBinding !== venue.accountBinding)
        throw Error('Ledger and venue account bindings differ.');
    if (venue.unsupported.length)
        throw Error('Unsupported venue records require review before reconciliation.');
    if (ledger.orders.length > 10000 || venue.transactions.length > 10000)
        throw Error('Reconciliation exceeds supported history limits.');
    if (ledger.status === 'no-ledger')
        return { status: 'no-ledger', accountId: ledger.accountId, bookId: null, symbols: [], corrections: [], fingerprint: hash({ ledger, venue }) };
    if (ledger.status !== 'available' || !ledger.bookId || ledger.orders.some(r => r.book_id !== ledger.bookId || r.mode !== 'live'))
        throw Error('Historical book evidence is incomplete.');
    const held = new Map();
    for (const p of venue.positions) {
        const s = id(p, 'symbol');
        held.set(s, (held.get(s) || ZERO).add(num(p, 'qty')));
    }
    const symbols = [...new Set([...ledger.orders, ...venue.transactions, ...venue.positions].map(r => id(r, 'symbol')))].sort();
    const reviews = symbols.map(s => reviewSymbol(ledger.bookId, s, ledger.orders.filter(r => r.symbol === s), venue.transactions.filter(t => t.symbol === s), held.get(s) || ZERO));
    const normalized = { ledger: { ...ledger, orders: [...ledger.orders].sort((a, b) => id(a, 'order_id').localeCompare(id(b, 'order_id'))) }, venue: { ...venue, transactions: [...venue.transactions].sort((a, b) => id(a, 'transactionId').localeCompare(id(b, 'transactionId'))), positions: [...held].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, qty]) => ({ symbol, qty: qty.toString() })) } };
    return { status: reviews.some(r => r.action === 'refuse') ? 'review-required' : 'verified', accountId: ledger.accountId, bookId: ledger.bookId, symbols: reviews, corrections: reviews.flatMap(r => r.corrections), fingerprint: hash(normalized) };
}
