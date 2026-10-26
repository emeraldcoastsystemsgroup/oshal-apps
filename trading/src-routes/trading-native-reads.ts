/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Type additive accrued-interest and margin-equity measurements without deriving an interest-subject loan balance or changing broker reads.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Type the additive measured broker balance contract without changing the caller-owned read or compatibility summary.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the native caller's Schwab roster, balances and charts without legacy credentials, imported account bindings or live-order activation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Carry the kernel's account day change (the sum of Schwab's per-position day P&L) to the landing; it was forced to null, so every Schwab card read "Day P&L n/a".
 * 3 | maintainer@emeraldcoastsystemsgroup.com | readNativeMovers: Schwab's whole-market movers (kernel trading.movers) for the Movers board.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | readNativeMovers names the index it asks for.
 */
import * as runtime from '@/features/trading';
import type { AppContext } from '@/app/composition/app-context';

/** The native bridge explicitly declares this read contract; legacy runtimes keep their own paths. */
export function nativeSchwabReads(): boolean {
  return (runtime as unknown as { nativeSchwabReads?: boolean }).nativeSchwabReads === true;
}

export interface NativeBalanceFacts {
  buyingPower:number|null;cashAvailableForTrading:number|null;cashAvailableForWithdrawal:number|null;
  unsettledCash:number|null;debitBalance:number|null;marginBalance:number|null;
  maintenanceRequirement:number|null;longMarketValue:number|null;shortMarketValue:number|null;
  accruedInterest?:number|null;marginEquity?:number|null;equityPercentage?:number|null;
}
export interface NativeAccount {
  broker?:'schwab';balanceFacts?:NativeBalanceFacts;
  accountId: string; connectionKey: string; accountMasked: string; accountType: string | null;
  equity: number; cash: number; buyingPower: number; kind: string; notTrading: boolean;
  /** Schwab's own day P&L summed over the positions; null when any position does not report it. */
  dayChange?: number | null; dayChangePct?: number | null;
  positions: Array<{ symbol: string; qty: number; marketValue: number }>;
}
export interface NativeAccounts {
  accounts: NativeAccount[]; errors: Array<{ connection: string; message: string }>; readAt: string;
}

/** A native-only host port, checked at its use rather than weakening the legacy AppContext type. */
async function intent(ctx: AppContext, name: string, input: Record<string,unknown>): Promise<unknown> {
  const host = ctx as AppContext & {intent?: (name:string,input:Record<string,unknown>) => Promise<unknown>};
  if (typeof host.intent !== 'function') throw new Error('Native Trading reads are unavailable on this host.');
  return host.intent(name,input);
}

/** The kernel resolves the real current caller; no route-supplied subject or raw account number is sent. */
export async function readNativeAccounts(ctx: AppContext): Promise<NativeAccounts> {
  return await intent(ctx,'trading.accounts', {}) as unknown as NativeAccounts;
}

/** One Schwab movers row as the kernel normalizes it. */
export interface NativeMover { symbol: string; name: string; price: number; change: number | null; changePct: number | null; volume: number | null }

/**
 * @description Schwab's whole-market movers through the kernel's trading.movers read, or null when Schwab is not configured.
 * @param ctx - Route context on the native kernel.
 * @param sort - PERCENT_CHANGE_UP, PERCENT_CHANGE_DOWN or VOLUME.
 * @returns The movers, or null.
 */
export async function readNativeMovers(ctx: AppContext, sort: 'PERCENT_CHANGE_UP' | 'PERCENT_CHANGE_DOWN' | 'VOLUME', index = 'EQUITY_ALL'): Promise<NativeMover[] | null> {
  const config = await intent(ctx,'trading.config', {}) as unknown as {configured:boolean};
  if (!config.configured) return null;
  const answer = await intent(ctx,'trading.movers', {index, sort}) as unknown as {movers: NativeMover[]};
  return answer.movers;
}

/** Read candles through the same named, kernel-owned market-data adapter. */
export async function readNativeChart(ctx: AppContext, symbol: string, timeframe: string, connection?: string): Promise<unknown | null> {
  const config = await intent(ctx,'trading.config', {}) as unknown as {configured:boolean};
  if (!config.configured) return null;
  return intent(ctx,'trading.bars', {symbol, timeframe, ...(connection ? {connection} : {})});
}

/** Add every real account to the landing summary exactly once; a day change the kernel could not measure stays unknown. */
export function appendNativeSummary(accounts: NativeAccounts, rows: Array<Record<string, unknown>>, rollup: Map<string, {symbol:string; qty:number; marketValue:number; perBook:Array<{ref:string; qty:number; marketValue:number}>}>): number {
  let total = 0;
  for (const account of accounts.accounts) {
    total += account.equity;
    rows.push({...account, nativeReadOnly:true, dayChange:account.dayChange ?? null, dayChangePct:account.dayChangePct ?? null});
    for (const p of account.positions) {
      const key = p.symbol.toUpperCase();
      const current = rollup.get(key) || {symbol:key,qty:0,marketValue:0,perBook:[]};
      current.qty += p.qty; current.marketValue += p.marketValue;
      current.perBook.push({ref:`Schwab ${account.accountMasked}`,qty:p.qty,marketValue:p.marketValue});
      rollup.set(key,current);
    }
  }
  for (const error of accounts.errors) rows.push({kind:'live',notTrading:true,nativeReadOnly:true,label:'Schwab account unavailable',error:error.message});
  return total;
}

/** Execution history stays account-bound and read-only; the kernel validates owner and dates. */
export async function readNativeHistory(ctx: AppContext, input: {accountId:string; connection:string; from:string; to:string}): Promise<unknown> {
  return intent(ctx,'trading.transactions',input);
}
