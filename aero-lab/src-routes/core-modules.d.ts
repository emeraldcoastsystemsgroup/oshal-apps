/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:40:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — ambient
 *                     |                             | declarations for the framework `@/` modules this
 *                     |                             | package imports. The oshal loader resolves `@/` at
 *                     |                             | RUNTIME (BUILDING-EXTENSIONS §5); declaring the
 *                     |                             | types here lets `tsc -p src-routes` type-check AND
 *                     |                             | emit only this package's files (mapping paths into
 *                     |                             | the core checkout made tsc emit the core tree into
 *                     |                             | routes/ — a .d.ts never emits). Keep the surface
 *                     |                             | minimal: declare only what aero-lab actually uses.
 */

declare module '@/shared/logger' {
  /** The pino child-logger surface aero-lab uses (obj-first call shape). */
  export interface OshalLogger {
    debug(obj: Record<string, unknown>, msg?: string): void;
    info(obj: Record<string, unknown>, msg?: string): void;
    warn(obj: Record<string, unknown>, msg?: string): void;
    error(obj: Record<string, unknown>, msg?: string): void;
  }
  /** @description Create the module-scoped structured logger (never console.log). */
  export function createChildLogger(bindings: Record<string, unknown>): OshalLogger;
}
