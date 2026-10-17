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
exports.nativePaperDecision = nativePaperDecision;
exports.nativePaperQuote = nativePaperQuote;
exports.nativePaperOrder = nativePaperOrder;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | "Buy a stock" on the native paper book: POST /decisions/manual and POST /orders answer from the person's native paper book (routes/paper/manual.js) when this is the native kernel's railless paper book; every other book keeps its existing path. Review had failed with 502 (an undeclared unique key) and there was no broker to fill the order.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | nativePaperQuote: GET /quote on the native railless paper book answers from the kernel's stored price.
 */
const crypto = __importStar(require("crypto"));
const trading_1 = require("@/features/trading");
const screen_1 = require("./paper/screen");
const manual_1 = require("./paper/manual");
/** Whether this book is the native kernel's paper book with no broker rail (the native paper engine owns it). */
function nativePaper(ctx, sub, book) {
    if (!(0, screen_1.nativeHost)(ctx) || !(0, screen_1.paperBook)(book))
        return false;
    const reader = () => (0, trading_1.getBrokerReader)(book.kind, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
    return !(0, screen_1.readerConnected)(reader);
}
function deps(ctx) {
    return { pool: ctx.pool, intent: ctx.intent, newId: () => crypto.randomUUID() };
}
/**
 * @description The native paper book's answer to POST /decisions/manual, or null for every other book.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param order - The validated request.
 * @returns The answer, or null.
 */
async function nativePaperDecision(ctx, sub, book, order) {
    if (!nativePaper(ctx, sub, book))
        return null;
    return (0, manual_1.previewManual)(deps(ctx), sub, { ...order, now: new Date() });
}
/**
 * @description The native paper book's answer to GET /quote (the price its orders are priced at), or null otherwise.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param symbol - Upper-case ticker.
 * @returns The answer, or null.
 */
async function nativePaperQuote(ctx, sub, book, symbol) {
    if (!nativePaper(ctx, sub, book))
        return null;
    return (0, manual_1.quoteManual)(deps(ctx), symbol, book.ref);
}
/**
 * @description The native paper book's answer to POST /orders for a manual paper decision, or null otherwise.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param decisionId - The decision to fill.
 * @returns The answer, or null.
 */
async function nativePaperOrder(ctx, sub, book, decisionId) {
    if (!nativePaper(ctx, sub, book))
        return null;
    return (0, manual_1.fillManual)(deps(ctx), sub, decisionId, new Date());
}
