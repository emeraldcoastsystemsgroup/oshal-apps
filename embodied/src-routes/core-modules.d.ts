/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package
 *                     |                             | imports (the scan-to-print idiom): the oshal loader resolves
 *                     |                             | `@/` at RUNTIME (BUILDING-EXTENSIONS §5); declaring the types
 *                     |                             | here lets `tsc -p src-routes` type-check AND emit only this
 *                     |                             | package's files. Every signature mirrors the real export it
 *                     |                             | names — a stub that lies passes here and fails the store's
 *                     |                             | canonical whole-program compile.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B23: `@/shared/artifact-exchange` — the shared ADR-139 redeem
 *                     |                             | the scene-import destination calls (mirrors redeem.ts exactly).
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
  /**
   * The GUC-stamped pg pool surface package routes ride on (rows are pg's any[]). NOT exported
   * by the real module — the package derives its pool type as `AppContext['pool']`, which is why
   * this interface stays module-private here.
   */
  interface QueryablePool {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  }
  /** The app context handed to package route factories (open-ended: only what this package reads). */
  export interface AppContext {
    pool: QueryablePool;
    appPackageDir?: string;
    [key: string]: unknown;
  }
}

declare module '@/shared/security/explicit-write-confirmation' {
  /** @description True only when the body carries the explicit `confirm: true` opt-in. */
  export function hasExplicitWriteConfirmation(body: unknown): boolean;
  /** @description The standard 428 payload for an unconfirmed outward write. */
  export function confirmationRequiredPayload(guard: string, action: string): Record<string, unknown>;
}

declare module '@/shared/artifact-exchange' {
  /** A redeemed ADR-139 artifact handle: the bytes plus the source's declared name and MIME. */
  export interface RedeemedArtifact { ok: true; name: string; type: string; buffer: Buffer }
  /** A refusal from the relay, already carrying the status the destination should answer with. */
  export interface RedeemFailure { ok: false; status: number; error: string }
  /**
   * @description Redeem an artifact handle through the api's own loopback relay as this caller
   * (ADR-139 wave 2 — the shared package-side redeem the `spaces` destination uses).
   */
  export function redeemArtifactViaRelay(
    input: { port: number | undefined; callerSub: string; ref: string; maxBytes?: number },
  ): Promise<RedeemedArtifact | RedeemFailure>;
}
