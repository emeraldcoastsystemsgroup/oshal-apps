"use strict";
/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Keep accrued interest and margin equity distinct from net borrowing; identify open-position day P&L so it cannot masquerade as a full account return.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Display measured native broker buying power, debit and maintenance without compatibility cash fallbacks; label withdrawal, trading and unsettled balances independently of settlement.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Summarize cross-account real holding concentration, registration groups and stale statement coverage; failed source reads force partial capital.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Separate real and simulated capital, retain every held name, and distinguish retirement registration from broker cash/margin mechanics without inventing borrowing authority.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioError = void 0;
exports.measured = measured;
exports.accountKey = accountKey;
exports.registration = registration;
exports.accountConstraints = accountConstraints;
exports.capitalGroup = capitalGroup;
exports.capitalSummary = capitalSummary;
exports.inventoryAccount = inventoryAccount;
exports.uniqueAccounts = uniqueAccounts;
exports.buildPortfolio = buildPortfolio;
exports.portfolioRisk = portfolioRisk;
class PortfolioError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.PortfolioError = PortfolioError;
/** Missing, string, NaN and infinite money never become a zero balance. */
function measured(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** Identity includes the connection: masked suffixes and nicknames are not account bindings. */
function accountKey(row) {
    if (typeof row.accountId !== 'string' || !row.accountId || row.accountId.length > 200
        || typeof row.connectionKey !== 'string' || !row.connectionKey || row.connectionKey.length > 200)
        return null;
    return JSON.stringify([row.connectionKey, row.accountId]);
}
function registration(value) {
    if (!['unknown', 'taxable', '401k', 'ira', 'roth-ira'].includes(String(value)))
        throw new PortfolioError(400, 'registration_invalid', 'Choose an explicit account registration.');
    return value;
}
/** Registration is owner-declared; CASH/MARGIN from a broker does not identify a retirement plan. */
function accountConstraints(row, declared = 'unknown') {
    declared = registration(declared);
    const brokerType = typeof row.accountType === 'string' ? row.accountType.toLowerCase() : 'unknown';
    const retirement = ['401k', 'ira', 'roth-ira'].includes(declared);
    const margin = !retirement && declared === 'taxable' && brokerType === 'margin';
    const group = retirement ? declared : declared === 'unknown' ? 'unclassified'
        : brokerType === 'margin' ? 'margin' : brokerType === 'cash' ? 'cash' : 'unclassified';
    const nativeBroker = row.kind === 'live' && (row.broker === 'schwab' || row.nativeReadOnly === true);
    const facts = row.balanceFacts && typeof row.balanceFacts === 'object' ? row.balanceFacts : {};
    return { registration: declared, registrationSource: declared === 'unknown' ? 'unconfirmed' : 'owner-declared',
        brokerType, group, retirement, leverageSimulationAllowed: margin,
        borrowingExecutionAvailable: false,
        reportedBuyingPower: measured(nativeBroker ? facts.buyingPower : row.buyingPower), settledCash: measured(row.settledCash),
        marginDebt: measured(nativeBroker ? facts.debitBalance : row.marginDebt), maintenanceRequirement: measured(nativeBroker ? facts.maintenanceRequirement : row.maintenanceRequirement),
        withdrawableCash: measured(facts.cashAvailableForWithdrawal), availableForTradingCash: measured(facts.cashAvailableForTrading),
        unsettledCash: measured(facts.unsettledCash), reportedMarginBalance: measured(facts.marginBalance),
        accruedInterest: measured(facts.accruedInterest), marginEquity: measured(facts.marginEquity), equityPercentage: measured(facts.equityPercentage),
        buyingPowerBasis: nativeBroker ? 'provider-current-balances' : 'reported-compatibility-field',
        reason: retirement ? 'Retirement capital is modeled without borrowing.'
            : declared === 'unknown' ? 'Confirm whether this account is taxable or a retirement account.'
                : margin ? 'Margin scenarios are research. Broker borrowing, maintenance and execution need separate verified capabilities.'
                    : 'Cash scenarios cannot use borrowed capital; settlement availability must be verified separately.' };
}
/** Totals identify partial coverage; unknown day P&L and failed reads stay unknown. */
function capitalGroup(rows) {
    const included = rows.filter(row => !row.error && measured(row.equity) !== null);
    const values = included.map(row => measured(row.equity));
    const changes = included.map(row => measured(row.dayChange)).filter((n) => n !== null);
    const native = included.filter(row => row.kind === 'live' && row.nativeReadOnly === true).length;
    return { accounts: rows.length, reporting: included.length,
        equity: values.length ? values.reduce((a, b) => a + b, 0) : null,
        dayChange: changes.length ? changes.reduce((a, b) => a + b, 0) : null,
        dayChangeReporting: changes.length, dayChangeBasis: native === included.length && native > 0 ? 'open-positions' : native > 0 ? 'mixed' : 'reported', partial: included.length !== rows.length,
        dayChangePartial: changes.length !== rows.length };
}
/** Paper is deliberately excluded from real capital, real day change and live concentration. */
function capitalSummary(rows) {
    const paper = rows.filter(row => row.kind === 'paper' || row.ref === 'paper');
    const live = rows.filter(row => row.kind === 'live' && row.ref !== 'paper');
    const outside = rows.filter(row => row.kind === 'outside');
    return { live: capitalGroup(live), paper: capitalGroup(paper), outside: capitalGroup(outside),
        real: capitalGroup([...live, ...outside]), includesPaperInRealCapital: false };
}
/** Every position is inventoried, whether watchlisted, bought by OSHAL, or neither. */
function inventoryAccount(row, profile, watchlist) {
    const positions = Array.isArray(row.positions) ? row.positions : [];
    if (positions.length > 5000)
        throw new PortfolioError(422, 'positions_exceed_limit', 'This account exceeds the portfolio position limit.');
    const holdings = positions.map(position => {
        const symbol = typeof position.symbol === 'string' ? position.symbol.trim().toUpperCase() : '';
        const value = measured(position.marketValue);
        return { ...position, symbol, qty: measured(position.qty), marketValue: value,
            tracking: watchlist.has(symbol) ? 'watchlisted' : 'not-watchlisted',
            management: row.nativeReadOnly || row.notTrading || position.unmanaged === true ? 'view-only' : 'unverified',
            valueKnown: value !== null, symbolKnown: !!symbol && symbol.length <= 64 };
    });
    const equity = measured(row.equity), gross = holdings.reduce((sum, p) => sum + Math.abs(p.marketValue ?? 0), 0);
    const allValuesKnown = holdings.every(p => p.valueKnown);
    const largest = holdings.reduce((max, p) => Math.max(max, Math.abs(p.marketValue ?? 0)), 0);
    return { ...row, accountId: row.accountId, connectionKey: row.connectionKey, kind: row.kind, asOf: row.asOf, label: profile?.label || (typeof row.label === 'string' ? row.label : '') || `Account ${String(row.accountMasked || '')}`,
        constraints: accountConstraints(row, profile?.registration), strategyId: profile?.strategyId ?? null,
        holdings, holdingsCount: holdings.length, watchlisted: holdings.filter(p => p.tracking === 'watchlisted').length,
        notWatchlisted: holdings.filter(p => p.tracking === 'not-watchlisted').length,
        grossExposurePct: allValuesKnown && equity !== null && equity > 0 ? gross / equity * 100 : null,
        largestPositionPct: allValuesKnown && equity !== null && equity > 0 ? largest / equity * 100 : null,
        holdingsComplete: Array.isArray(row.positions) && holdings.every(p => p.valueKnown && p.symbolKnown && p.qty !== null),
        strategyAppliedToBroker: false };
}
/** Reject conflicting duplicates instead of counting a login or masked suffix twice. */
function uniqueAccounts(rows) {
    if (rows.length > 200)
        throw new PortfolioError(422, 'accounts_exceed_limit', 'The portfolio supports at most 200 account snapshots.');
    const found = new Map();
    for (const row of rows) {
        const key = accountKey(row);
        if (!key)
            throw new PortfolioError(422, 'account_binding_missing', 'An account snapshot has no verified account and connection binding.');
        const prior = found.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(row))
            throw new PortfolioError(422, 'account_snapshot_conflict', 'Conflicting snapshots were returned for one account. Refresh the account read.');
        found.set(key, row);
    }
    return [...found.values()];
}
/** Coverage is explicit: an empty read is not proof that no outside accounts exist. */
function buildPortfolio(rows, profiles, symbols, errors = [], now = new Date()) {
    const watchlist = new Set(symbols.map(symbol => symbol.trim().toUpperCase()));
    const profileMap = new Map(profiles.map(profile => [accountKey(profile), profile]));
    const accounts = uniqueAccounts(rows).map(row => inventoryAccount(row, profileMap.get(accountKey(row)), watchlist));
    const real = accounts.filter(row => row.kind !== 'paper');
    const connections = new Set(real.filter(row => row.kind === 'live').map(row => row.connectionKey));
    const capital = capitalSummary(accounts);
    if (errors.length) {
        capital.live.partial = true;
        capital.real.partial = true;
        capital.live.dayChangePartial = true;
        capital.real.dayChangePartial = true;
    }
    const risk = portfolioRisk(real, errors.length, now);
    return { accounts, capital, risk, errors,
        coverage: { accounts: real.length, holdings: real.reduce((sum, row) => sum + row.holdingsCount, 0),
            notWatchlisted: real.reduce((sum, row) => sum + row.notWatchlisted, 0),
            unclassifiedAccounts: real.filter(row => row.constraints.group === 'unclassified').length,
            unassignedReviewStrategies: real.filter(row => !row.strategyId).length,
            staleOutsideAccounts: risk.staleOutsideAccounts,
            sourceFailures: errors.length, outsideAccountsVerifiedComplete: false,
            physicalAccountOverlapUnverified: connections.size > 1,
            allHoldingsCovered: errors.length === 0 && real.length > 0 && real.every(row => row.holdingsComplete) && risk.staleOutsideAccounts === 0 },
        execution: { liveAvailable: false, realOrdersPlaced: 0 },
        warnings: ['Account registration must be confirmed independently of broker cash/margin mechanics.',
            ...(connections.size > 1 ? ['Multiple logins may expose the same physical account. Totals are per connection and are not verified net worth.'] : []),
            'Assigning a review strategy does not enable broker execution or position protection.'] };
}
/** Aggregate reported real positions; never mix paper or claim unknown/stale source coverage is complete. */
function portfolioRisk(accounts, sourceFailures = 0, now = new Date()) {
    const real = accounts.filter(row => row.kind === 'live' || row.kind === 'outside');
    const capital = capitalGroup(real), positions = new Map();
    let holdings = 0, valued = 0, knownGross = 0;
    for (const account of real) {
        const inAccount = new Set();
        for (const holding of account.holdings) {
            holdings++;
            if (holding.valueKnown) {
                valued++;
                knownGross += Math.abs(holding.marketValue);
            }
            if (!holding.symbolKnown)
                continue;
            const symbol = holding.symbol, entry = positions.get(symbol) || { symbol, grossMarketValue: 0, marketValue: 0, qty: 0, accounts: 0, valueComplete: true };
            if (holding.valueKnown) {
                entry.grossMarketValue += Math.abs(holding.marketValue);
                entry.marketValue += holding.marketValue;
            }
            else
                entry.valueComplete = false;
            entry.qty = entry.qty === null || holding.qty === null ? null : entry.qty + holding.qty;
            if (!inAccount.has(symbol)) {
                entry.accounts++;
                inAccount.add(symbol);
            }
            positions.set(symbol, entry);
        }
    }
    const staleOutsideAccounts = real.filter(row => row.kind === 'outside' && (typeof row.asOf !== 'string' || !Number.isFinite(Date.parse(row.asOf)) || Date.parse(row.asOf) > now.getTime() || now.getTime() - Date.parse(row.asOf) > 7 * 86400000)).length;
    const complete = real.length > 0 && sourceFailures === 0 && !capital.partial && real.every(row => row.holdingsComplete) && staleOutsideAccounts === 0;
    const denominator = complete && capital.equity !== null && capital.equity > 0 ? capital.equity : null;
    const exposures = [...positions.values()].map(row => ({ ...row, shareOfReportedEquityPct: denominator !== null && row.valueComplete ? row.grossMarketValue / denominator * 100 : null })).sort((a, b) => b.grossMarketValue - a.grossMarketValue || a.symbol.localeCompare(b.symbol));
    const groups = Object.fromEntries(['401k', 'ira', 'roth-ira', 'cash', 'margin', 'unclassified'].map(group => [group, capitalGroup(real.filter(row => row.constraints.group === group))]));
    return { currency: 'USD', groups, exposures, holdings, valuedHoldings: valued, knownGrossMarketValue: knownGross,
        grossMarketValue: complete ? knownGross : null, grossExposurePct: denominator === null ? null : knownGross / denominator * 100,
        largestPositionPct: exposures[0]?.shareOfReportedEquityPct ?? null, complete, staleOutsideAccounts, statementFreshnessDays: 7,
        physicalAccountOverlapUnverified: new Set(real.filter(row => row.kind === 'live').map(row => row.connectionKey)).size > 1,
        outsideOverlapUnverified: real.some(row => row.kind === 'outside'), paperExcluded: true };
}
