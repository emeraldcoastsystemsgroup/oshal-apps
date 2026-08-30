/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package imports (the marketing-engine/switchboard idiom): the oshal loader resolves `@/` at RUNTIME; declaring the surfaces here lets `tsc -p src-routes` type-check AND emit only this package's files. Deliberately minimal — only what portrait-studio's modules actually use.
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

declare module '@/shared/middleware/authz' {
  /** @description The trusted sub from an internal service-secret call, or null. */
  export function getTrustedServiceUserSub(req: unknown): string | null;
}

declare module '@/app/composition/app-context' {
  /** The pg pool surface package routes ride on (rows are pg's any[]). */
  export interface QueryablePool {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  }
  /** The app context handed to package route factories. */
  export interface AppContext {
    pool: QueryablePool;
    appPackageDir?: string;
    [key: string]: unknown;
  }
}

declare module '@/features/video-generation' {
  /** One rendered image plus the vendor-reported cost/model (null cost = subscription-included). */
  export interface StoryboardImageResult {
    image: Buffer;
    costUsd: number | null;
    model: string;
  }
  /** The vendor-abstracted image-to-image engine (the media-generation kernel skill). */
  export interface StoryboardImageProvider {
    readonly id: string;
    readonly costClass: 'free' | 'paid';
    available(): Promise<boolean>;
    generate(prompt: string, anchor: Buffer | null): Promise<Buffer>;
    generateWithMeta?(prompt: string, anchor: Buffer | null): Promise<StoryboardImageResult>;
    healthCheck?(): Promise<{ ok: boolean; detail: string }>;
  }
  /** @description Resolve the configured provider; `userSub` threads the caller for per-caller rails (ADR-130). */
  export function resolveStoryboardImageProvider(opts?: { vertexToken?: string; userSub?: string }): Promise<StoryboardImageProvider>;
  /** @description Write vendor-reported image spend to the canonical ledger (chat_tasks + oshal_cost_events). */
  export function recordStoryboardImageCost(pool: unknown, event: {
    taskId: string; agentId: string; ownerSub: string; providerId: string; model: string; costUsd: number;
  }): Promise<void>;
}
