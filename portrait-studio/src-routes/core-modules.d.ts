/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Ambient declarations for the framework `@/` modules this package imports (the marketing-engine/switchboard idiom): the oshal loader resolves `@/` at RUNTIME; declaring the surfaces here lets `tsc -p src-routes` type-check AND emit only this package's files. Deliberately minimal — only what portrait-studio's modules actually use.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Passport export + email (1.6.0): declare the surfaces the two new routes ride — sharp (square resize, in the core image already), the sendGmail/sendOutlookMail senders + getValidAccessToken (the ADR-108 "email it" rail presentations proved), and the explicit-write-confirmation gate.
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

declare module '@/shared/security/explicit-write-confirmation' {
  /** @description True only when the body carries the literal `confirm: true`. */
  export function hasExplicitWriteConfirmation(body: unknown): boolean;
  /** @description The standard 428 payload for a write attempted without confirm: true. */
  export function confirmationRequiredPayload(guard: string, action: string): Record<string, unknown>;
}

declare module '@/app/routes/connectors-routes' {
  /** @description A fresh access token for the caller's connection to `provider`, or null when not connected. */
  export function getValidAccessToken(pool: unknown, userSub: string, provider: string): Promise<string | null>;
}

declare module '@/app/routes/email-routes' {
  /** One outbound message + optional single attachment — the shape both vendor senders share. */
  export interface OutboundMailMessage {
    to: string;
    subject: string;
    body: string;
    attachment?: { filename: string; contentBase64: string; mimeType?: string };
  }
  /** @description Send over Gmail (users.messages.send) with the core header-injection fence. */
  export function sendGmail(token: string, m: OutboundMailMessage): Promise<{ id: string }>;
  /** @description Send over Microsoft Graph (users/me/sendMail) — same call shape as sendGmail. */
  export function sendOutlookMail(token: string, m: OutboundMailMessage): Promise<{ id: string }>;
}

declare module 'sharp' {
  /** The one pipeline surface this package uses: square cover-resize → PNG bytes. */
  interface SharpPipeline {
    resize(width: number, height: number, opts?: { fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'; position?: string }): SharpPipeline;
    png(): SharpPipeline;
    toBuffer(): Promise<Buffer>;
  }
  /** @description Open an image (path or bytes) as a sharp pipeline. */
  function sharp(input: Buffer | string): SharpPipeline;
  export = sharp;
}
