/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package
 *                     |                             | imports (the cad-studio idiom): the oshal loader resolves `@/` at
 *                     |                             | RUNTIME (BUILDING-EXTENSIONS section 5); declaring the types here
 *                     |                             | lets `tsc -p src-routes` type-check AND emit only this package's
 *                     |                             | files. Every signature mirrors the real export it names rather
 *                     |                             | than widening to `any` - a stub that lies passes here and fails
 *                     |                             | the store's canonical whole-program compile.
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
   * by the real module - the package derives its pool type as `AppContext['pool']`, which is why
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
