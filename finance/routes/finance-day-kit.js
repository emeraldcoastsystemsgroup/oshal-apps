"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | What the day's four route modules share (the day, bills, goals and the month): one wrapper that requires a signed-in caller, answers a refusal in its own words and logs anything else; the checks a request's values pass before anything is stored (a whole number of cents, a real date, a month, a confirmation); and the readers for what a store hands back. A refusal is a sentence a person can act on, never a status code or a setting's name.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNAVAILABLE = exports.MAX_CENTS = void 0;
exports.callerSub = callerSub;
exports.route = route;
exports.bodyOf = bodyOf;
exports.bookOf = bookOf;
exports.dayOf = dayOf;
exports.requireConfirm = requireConfirm;
exports.centsOf = centsOf;
exports.neededCents = neededCents;
exports.dateOf = dateOf;
exports.monthParam = monthParam;
exports.nameOf = nameOf;
exports.whole = whole;
exports.wholeOrNull = wholeOrNull;
exports.cell = cell;
exports.jsonParam = jsonParam;
const logger_1 = require("@/shared/logger");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_day_model_1 = require("./finance-day-model");
const logger = (0, logger_1.createChildLogger)({ module: 'finance-day' });
/** The largest amount a request may carry, in cents. */
exports.MAX_CENTS = 1e13;
/** What a route answers when something other than a refusal went wrong. */
exports.UNAVAILABLE = 'Finance could not read or change your records just now. Try again.';
/**
 * @description The signed-in caller.
 * @param req - The request.
 * @returns Their subject, or null when nobody is signed in.
 */
function callerSub(req) {
    const user = req.oidc?.user;
    const sub = user?.sub || user?.oid;
    return sub ? String(sub) : null;
}
/**
 * @description Wrap one handler: require a signed-in caller, answer a refusal in its own words and
 * log anything else.
 * @param name - The route's name for the log.
 * @param run - The handler; what it returns is the JSON answer.
 * @returns The Express handler.
 */
function route(name, run) {
    return async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json(await run(sub, req));
        }
        catch (err) {
            if (err instanceof finance_ledger_store_1.LedgerRefusal) {
                res.status(err.status).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, route: name }, 'finance day route failed');
            res.status(500).json({ error: 'finance_unavailable', message: exports.UNAVAILABLE });
        }
    };
}
/**
 * @description A request's body as a plain record.
 * @param req - The request.
 * @returns The body ({} when there is none).
 */
function bodyOf(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
}
/**
 * @description The set of records a request names, from its query or its body.
 * @param req - The request.
 * @returns 'home' or 'business'.
 */
function bookOf(req) {
    return (0, finance_ledger_store_1.bookIdOf)(req.query?.book ?? bodyOf(req).book);
}
/**
 * @description The person's day for a request: the page's own local day when it sends one.
 * @param req - The request.
 * @returns YYYY-MM-DD.
 */
function dayOf(req) {
    return (0, finance_day_model_1.todayOf)(req.query?.today ?? bodyOf(req).today);
}
/**
 * @description Require the explicit confirmation a change of this weight needs.
 * @param body - The request's body.
 * @param what - What is being confirmed, as the start of the sentence.
 * @returns Nothing; throws the refusal.
 */
function requireConfirm(body, what) {
    if (!body || body.confirm !== true)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'confirm_required', `${what} needs your confirmation.`);
}
/**
 * @description An amount a person typed, as whole cents.
 * @param value - The request's value.
 * @param what - What the amount is, for the refusal ("The amount").
 * @returns The cents, or null when the request gave none.
 */
function centsOf(value, what) {
    if (value === undefined || value === null || value === '')
        return null;
    const cents = Number(value);
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > exports.MAX_CENTS)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_amount', `${what} must be an amount of money, zero or more.`);
    return cents;
}
/**
 * @description An amount a request must carry, above zero.
 * @param value - The request's value.
 * @param what - What the amount is, for the refusal.
 * @returns The cents.
 */
function neededCents(value, what) {
    const cents = centsOf(value, what);
    if (!cents)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'amount_required', `${what} is needed, and it must be more than zero.`);
    return cents;
}
/**
 * @description A date a request carries.
 * @param value - The request's value.
 * @param what - What the date is, for the refusal ("The due date").
 * @returns YYYY-MM-DD, or null when the request gave none.
 */
function dateOf(value, what) {
    if (value === undefined || value === null || value === '')
        return null;
    if (!(0, finance_ledger_store_1.isDate)(value))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_date', `${what} must be a real date.`);
    return value;
}
/**
 * @description A month a request names.
 * @param value - The request's value.
 * @param fallback - The month to use when the request names none.
 * @returns YYYY-MM.
 */
function monthParam(value, fallback) {
    if (value === undefined || value === null || value === '')
        return fallback;
    if (!(0, finance_ledger_store_1.isMonth)(value))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_month', 'Name the month by its year and month.');
    return value;
}
/**
 * @description A name a person typed, cleaned, or a refusal when it is empty.
 * @param value - The request's value.
 * @param what - The sentence to refuse with.
 * @param limit - The longest name kept.
 * @returns The name.
 */
function nameOf(value, what, limit = 80) {
    const name = (0, finance_ledger_store_1.cleanText)(value, limit);
    if (!name)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'name_required', what);
    return name;
}
/**
 * @description A whole number out of a BIGINT a driver may hand back as text.
 * @param value - The stored value.
 * @returns The number.
 */
function whole(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(n))
        throw new Error('A stored amount is not a whole number.');
    return n;
}
/**
 * @description A stored amount that may not be known.
 * @param value - The stored value.
 * @returns The number, or null: unknown is not zero.
 */
function wholeOrNull(value) {
    return value === null || value === undefined ? null : whole(value);
}
/**
 * @description A stored JSON cell, parsed when a driver hands it back as text.
 * @param value - The stored value.
 * @returns The value, or null.
 */
function cell(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    return value;
}
/**
 * @description A value for a ::jsonb parameter.
 * @param value - The value to store.
 * @returns Its JSON text, or null.
 */
function jsonParam(value) {
    return value === null || value === undefined ? null : JSON.stringify(value);
}
//# sourceMappingURL=finance-day-kit.js.map