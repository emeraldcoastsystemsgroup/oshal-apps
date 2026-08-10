/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package imports (the aero-lab idiom): the oshal loader resolves `@/` at RUNTIME (BUILDING-EXTENSIONS §5); declaring types here lets `tsc -p src-routes` type-check AND emit only this package's files — mapping paths into the core checkout makes tsc emit the core tree into routes/. Surfaces are deliberately minimal: only what switchboard's modules actually use.
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

declare module '@/app/routes/email-routes' {
  /** @description The kernel's ONE privacy-bounded Gmail metadata summarizer. */
  export function summarizeGmailMetadata(id: string, message: Record<string, unknown>): {
    id: string; from: string; subject: string; snippet: string; receivedAt: string; unread: boolean; important: boolean;
  };
  /** @description Send a Gmail message on the caller's own token. */
  export function sendGmail(...args: any[]): Promise<any>;
}

declare module '@/app/routes/slack-client' {
  /** One normalized Slack feed message. */
  export type SlackFeedMessage = any;
  export function pullSlackFeed(...args: any[]): Promise<any>;
  export function slackIdentity(...args: any[]): Promise<any>;
}

declare module '@/app/routes/inline-bot-execution' {
  /** @description The accounted bot/inline execution path (ADR-036) — never a local CLI. */
  export function executeBotOrInline(...args: any[]): Promise<any>;
}

declare module '@/features/agent-management' {
  /** Direct sync call to an accountable bot node. */
  export class BotNodeClient {
    constructor(...args: any[]);
    execute(...args: any[]): Promise<any>;
    [key: string]: any;
  }
  export function createRegistryEndpointResolver(...args: any[]): any;
}

declare module '@/features/video-generation' {
  /** One generated storyboard image result (image bytes + attributed cost + model). */
  export interface StoryboardImageResult { image: Buffer; costUsd: number | null; model: string; [k: string]: any }
  /** The media-generation kernel-skill provider surface compose consumes. */
  export interface StoryboardImageProvider {
    id: string;
    generate(prompt: string, opts: unknown): Promise<Buffer>;
    generateWithMeta?(prompt: string, opts: unknown): Promise<StoryboardImageResult>;
  }
  export function resolveStoryboardImageProvider(...args: any[]): Promise<StoryboardImageProvider>;
  export function recordStoryboardImageCost(...args: any[]): Promise<any>;
}

declare module '@/features/personal-data' {
  /** Owner-key field encryption for at-rest personal content (synchronous). */
  export function encryptField(...args: any[]): string;
  export function decryptField(...args: any[]): string;
  export function isEncrypted(value: unknown): boolean;
}
