/**
 * Rail guard — the one answer to "is this book's broker / market-data rail connected?" that every
 * trading read asks before it touches the rail.
 *
 * The framework's broker readers and market-data sources expose configured(). A host that has no
 * rail at all (the native kernel bridge answers getMarketData with {} and a broker reader without
 * configured) left every caller calling an absent method, so the watchlist, ledger, account,
 * positions, performance and exposure reads all answered 502 "x.configured is not a function". An
 * absent rail or an absent probe is "not connected" — the honest state the
 * routes already know how to report — never an error.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — railConfigured(rail): true only when the rail exists, exposes configured() and that probe answers true; an absent rail or probe is not connected. NO_BROKER_STATUS / NO_BROKER_MESSAGE are the 409 and the sentence every book read answers when the selected book has no connected broker.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | railReason(rail): the sentence a not-connected rail carries (the native host's notConnectedReason: no Alpaca connector, Schwab not used for market data), so a route prints the host's reason instead of advice to set keys this installation has no place for.
 *
 * @module trading-rail-guard
 */

/** HTTP status a book read answers when the selected book has no connected broker: a state the operator resolves, not a server fault. */
export const NO_BROKER_STATUS = 409;

/** What a book read says when the selected book has no connected broker. */
export const NO_BROKER_MESSAGE = 'No broker is connected for this account. Connect one in Settings → Connections.';

/** The part of a broker reader or market-data source the guard reads. */
export interface RailProbe {
  configured?: unknown;
  notConnectedReason?: unknown;
}

/**
 * @description Whether a broker reader or market-data source is connected. A host without the rail
 * (no object, no configured() probe) reads as not connected, so the
 * caller takes its existing not-connected branch instead of failing the whole request.
 * @param rail - The broker reader or market-data source, possibly absent or partial.
 * @returns True only when the rail's own probe answers true.
 */
export function railConfigured(rail: RailProbe | null | undefined): boolean {
  if (!rail || typeof rail.configured !== 'function') return false;
  return (rail.configured as () => unknown).call(rail) === true;
}

/**
 * @description The sentence a not-connected rail carries, when its host gives one.
 * @param rail - The broker reader or market-data source, possibly absent.
 * @returns The host's reason, or null when the rail says nothing.
 */
export function railReason(rail: RailProbe | null | undefined): string | null {
  return rail && typeof rail.notConnectedReason === 'string' && rail.notConnectedReason ? rail.notConnectedReason : null;
}
