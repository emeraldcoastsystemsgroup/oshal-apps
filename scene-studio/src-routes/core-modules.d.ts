/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package
 *                     |                             | imports (the cad-studio idiom): the oshal loader resolves `@/` at
 *                     |                             | RUNTIME (BUILDING-EXTENSIONS §5); declaring the types here lets
 *                     |                             | `tsc -p src-routes` type-check AND emit only this package's files.
 *                     |                             | Every signature mirrors the real export it names.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: AppContext gains the two activation-scoped ports the
 *                     |                             | package now uses — `tools` (core PackageToolContext, package-tools)
 *                     |                             | and `authorization` (core PackageAuthorizationContext) — narrowed
 *                     |                             | to the members this package calls. The canonical rebuild excludes
 *                     |                             | this file and compiles against the real types.
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
   * by the real module — the package derives its pool type as `AppContext['pool']`.
   */
  interface QueryablePool {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  }
  /** The app context handed to package route factories (open-ended: only what this package reads). */
  export interface AppContext {
    pool: QueryablePool;
    appPackageDir?: string;
    /** Core PackageToolContext: present only while a package that declares package tools activates. */
    tools?: { register(name: string, handler: (input: unknown) => Promise<unknown>): void };
    /** Core PackageAuthorizationContext: the package's bound authorization port (ADR-149). */
    authorization?: {
      registerResource(resource: string, adapter: { authorize(input: { actor: { isActive: boolean } }): Promise<boolean> }): void;
      currentActor(): { sub: string; issuer: string; isActive: boolean } | undefined;
    };
    [key: string]: unknown;
  }
}

declare module '@/shared/security/explicit-write-confirmation' {
  /** @description True only when the body carries the explicit `confirm: true` opt-in. */
  export function hasExplicitWriteConfirmation(body: unknown): boolean;
  /** @description The standard 428 payload for an unconfirmed outward write. */
  export function confirmationRequiredPayload(guard: string, action: string): Record<string, unknown>;
}
