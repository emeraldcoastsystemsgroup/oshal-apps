/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: minimal ambient express declarations for standalone package TypeScript compilation (not emitted).
 */
declare module 'express' {
  export interface Request {
    params: Record<string, string>;
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    [key: string]: unknown;
  }
  export interface Response {
    status(code: number): this;
    json(body: unknown): this;
    setHeader(name: string, value: string): this;
    type(mime: string): this;
    sendFile(filePath: string): void;
  }
  export type RequestHandler = (req: Request, res: Response, next: (err?: unknown) => void) => unknown;
  export type ErrorRequestHandler = (err: unknown, req: Request, res: Response, next: (err?: unknown) => void) => unknown;
  export interface Router {
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
    use(handler: RequestHandler | ErrorRequestHandler): this;
    use(path: string, ...handlers: RequestHandler[]): this;
  }
  export function Router(): Router;
  export function json(options?: { limit?: string | number; strict?: boolean }): RequestHandler;
}
