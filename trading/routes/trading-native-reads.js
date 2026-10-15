"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeSchwabReads = nativeSchwabReads;
exports.readNativeAccounts = readNativeAccounts;
exports.readNativeChart = readNativeChart;
exports.appendNativeSummary = appendNativeSummary;
exports.readNativeHistory = readNativeHistory;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the native caller's Schwab roster, balances and charts without legacy credentials, imported account bindings or live-order activation.
 */
const runtime = __importStar(require("@/features/trading"));
/** The native bridge explicitly declares this read contract; legacy runtimes keep their own paths. */
function nativeSchwabReads() {
    return runtime.nativeSchwabReads === true;
}
/** A native-only host port, checked at its use rather than weakening the legacy AppContext type. */
async function intent(ctx, name, input) {
    const host = ctx;
    if (typeof host.intent !== 'function')
        throw new Error('Native Trading reads are unavailable on this host.');
    return host.intent(name, input);
}
/** The kernel resolves the real current caller; no route-supplied subject or raw account number is sent. */
async function readNativeAccounts(ctx) {
    return await intent(ctx, 'trading.accounts', {});
}
/** Read candles through the same named, kernel-owned market-data adapter. */
async function readNativeChart(ctx, symbol, timeframe, connection) {
    const config = await intent(ctx, 'trading.config', {});
    if (!config.configured)
        return null;
    return intent(ctx, 'trading.bars', { symbol, timeframe, ...(connection ? { connection } : {}) });
}
/** Add every real account to the landing summary exactly once; unknown daily changes stay unknown. */
function appendNativeSummary(accounts, rows, rollup) {
    let total = 0;
    for (const account of accounts.accounts) {
        total += account.equity;
        rows.push({ ...account, nativeReadOnly: true, dayChange: null, dayChangePct: null });
        for (const p of account.positions) {
            const key = p.symbol.toUpperCase();
            const current = rollup.get(key) || { symbol: key, qty: 0, marketValue: 0, perBook: [] };
            current.qty += p.qty;
            current.marketValue += p.marketValue;
            current.perBook.push({ ref: `Schwab ${account.accountMasked}`, qty: p.qty, marketValue: p.marketValue });
            rollup.set(key, current);
        }
    }
    for (const error of accounts.errors)
        rows.push({ kind: 'live', notTrading: true, nativeReadOnly: true, label: 'Schwab account unavailable', error: error.message });
    return total;
}
/** Execution history stays account-bound and read-only; the kernel validates owner and dates. */
async function readNativeHistory(ctx, input) {
    return intent(ctx, 'trading.transactions', input);
}
