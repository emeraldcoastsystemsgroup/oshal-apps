/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package imports (the switchboard/aero-lab idiom): the oshal loader resolves `@/` at RUNTIME; declaring types here lets `tsc -p src-routes` type-check AND emit only this package's files. Surfaces are deliberately minimal: only what marketing-engine's modules actually use.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add connector-tenancy resolveConnectionRow — the LinkedIn create-post author URN comes from the accessible connection row's account_id (personal or household-shared), never a bare user_sub query.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Declare BuildSpecOptions so the standalone per-package compile matches the framework build the store CI actually runs.
 */

declare module '@/shared/logger' {
  /** The pino child-logger surface this package uses (obj-first or message-only call shapes). */
  export interface OshalLogger {
    debug(objOrMsg: Record<string, unknown> | string, msg?: string): void;
    info(objOrMsg: Record<string, unknown> | string, msg?: string): void;
    warn(objOrMsg: Record<string, unknown> | string, msg?: string): void;
    error(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  }
  /** @description Create the module-scoped structured logger (never console.log). */
  export function createChildLogger(bindings: Record<string, unknown>): OshalLogger;
}

declare module '@/app/composition/app-context' {
  /** The GUC-stamped pg pool surface package routes ride on (rows are pg's any[]). */
  export interface QueryablePool {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  }
  /** The app context handed to package route factories (open-ended: panes use varied slices). */
  export interface AppContext {
    pool: QueryablePool;
    appPackageDir?: string;
    ticketService?: {
      createTicket(input: Record<string, unknown>): Promise<{ ticketId: string } & Record<string, unknown>>;
    };
    [key: string]: unknown;
  }
}

declare module '@/shared/services/database' {
  /** @description Idempotent lazy-DDL bootstrap (create-if-missing + validate requirements). */
  export function runRuntimeSchemaBootstrap(opts: {
    pool: unknown;
    moduleName: string;
    statements: string[];
    requirements: Array<{ table: string; columns: string[] }>;
  }): Promise<void>;
  /** @description Owner-RLS policy DDL for a user_sub-keyed table (oshal.current_sub GUC). */
  export function buildOwnerRlsPolicyStatements(table: string, ownerColumn: string): string[];
}

declare module '@/shared/services/database/request-identity' {
  /** @description Run a background job under the trusted-operator identity (RLS-visible). */
  export function runWithSystemIdentity<T>(fn: () => Promise<T>): Promise<T>;
}

declare module '@/shared/security/explicit-write-confirmation' {
  /** @description True only when the body carries the explicit confirm:true opt-in. */
  export function hasExplicitWriteConfirmation(body: unknown): boolean;
  /** @description The standard 428 payload for an unconfirmed outward write. */
  export function confirmationRequiredPayload(guard: string, action: string): Record<string, unknown>;
}

declare module '@/app/routes/connectors-routes' {
  /** @description The caller's valid (refreshed) access token for a provider, or null. */
  export function getValidAccessToken(pool: unknown, sub: string, provider: string): Promise<string | null>;
}

/* The declarations below deliberately use `any` in returns: sibling modules narrow these
   results with their own row/result interfaces, and an `unknown` here rejects those casts
   that compile fine against the real core types. */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module '@/app/routes/inline-bot-execution' {
  /** @description The accounted bot/inline execution path (ADR-036) — never a local CLI. Read result.success; the orchestrator swallows provider errors as {success:false}. */
  export function executeBotOrInline(...args: any[]): Promise<any>;
}

declare module '@/features/agent-management' {
  /** Direct sync call to an accountable bot node (inline bots resolve to no endpoint). */
  export class BotNodeClient {
    constructor(...args: any[]);
    execute(...args: any[]): Promise<any>;
    [key: string]: any;
  }
  export function createRegistryEndpointResolver(...args: any[]): any;
}

declare module '@/features/notifications' {
  /** @description Best-effort operator notification; never throws; unconfigured transport = skipped. */
  export function notifyOperator(
    message: { text: string },
    opts?: Record<string, unknown>,
  ): Promise<{ delivered: boolean; skipped?: boolean; error?: string }>;
}

declare module '@/app/connectors/runtime' {
  /** Resolved credentials/options the spec client rides on. */
  export type BuildSpecOptions = any;
  /** A loaded declarative connector spec (yaml). */
  export type ConnectorSpec = any;
  /** Pool shape the action audit trail writes through. */
  export type ConnectorActionAuditPool = any;
  /** @description Load + validate a connector spec yaml from an absolute path. */
  export function loadConnectorSpec(absPath: string): ConnectorSpec;
  /** @description Broker-only credential resolve for WRITE actions (no env fallback). */
  export function resolveConnectorActionCreds(
    spec: ConnectorSpec,
    pool: unknown,
    userSub: string,
    getToken: (pool: unknown, sub: string, provider: string) => Promise<string | null>,
  ): Promise<any>;
  /** @description The one governed connector write pipeline: params schema -> 428 confirm gate -> fail-closed audit -> HTTP. */
  export function runConnectorAction(opts: {
    pool: ConnectorActionAuditPool;
    spec: ConnectorSpec;
    resolveCreds: () => Promise<any>;
    userSub: string;
    actionName: string;
    params: Record<string, unknown>;
    requestBody: Record<string, unknown>;
  }): Promise<{ status: number; body: { ok: boolean; data?: any; error?: string; code?: string } }>;
  /** @description Invoke a declared READ resource with resolved creds. */
  export function invokeSpecResource(
    spec: ConnectorSpec,
    creds: any,
    resourceName: string,
    inputs: Record<string, unknown>,
  ): Promise<{ status: number; body: { ok: boolean; data?: any; error?: string } }>;
}

declare module '@/app/routes/connector-tenancy' {
  /** @description Resolve the ONE accessible connection row (personal ∪ household-shared) for (caller, provider); null when none. */
  export function resolveConnectionRow(
    pool: unknown,
    userSub: string,
    provider: string,
    opts?: Record<string, unknown>,
  ): Promise<({ account_id?: string | null } & Record<string, unknown>) | null>;
}

declare module '@/app/connectors/runtime/spec-tools' {
  /** @description READ-tier credential resolve: broker first, then CONNECTOR_* env fallback. */
  export function resolveConnectorSpecCreds(
    spec: any,
    pool: unknown,
    userSub: string,
    getToken: (pool: unknown, sub: string, provider: string) => Promise<string | null>,
  ): Promise<any>;
}
