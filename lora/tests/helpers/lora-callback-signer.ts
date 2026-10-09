/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Test-side worker signer for the LoRA callback grant contract, written independently of the package verifier so a canonicalization mistake in one cannot hide in the other. Specs use it to act as the GPU worker holding the grant a real dispatch handed out.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Media type of a signed JSON callback. */
export const CALLBACK_TYPE = 'application/vnd.oshal.lora-callback+json';

const GRANT_ASSIGNMENT = /^\$env:OSHAL_LORA_CALLBACK_GRANT='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})'; /;

/** The grant a dispatch handed its worker: the id and the secret half of the token. */
export interface WorkerGrant { id: string; secret: string; token: string }

/**
 * @description Read the grant from a recorded box command, exactly as the worker's PowerShell
 * would receive it. Fails when the command does not START with the assignment.
 * @param command - The enqueued shell.exec command.
 * @returns The grant id, secret and full token.
 */
export function grantFromCommand(command: string): WorkerGrant {
  const match = GRANT_ASSIGNMENT.exec(command);
  if (!match) throw new Error(`command does not begin with a callback grant assignment: ${command.slice(0, 120)}`);
  return { id: match[1], secret: match[2], token: `${match[1]}.${match[2]}` };
}

/**
 * @description Split a `<grant id>.<secret>` token (as mintCallbackGrant returns it).
 * @param token - The worker token.
 * @returns The grant id, secret and token.
 */
export function workerGrant(token: string): WorkerGrant {
  const [id, secret] = token.split('.');
  return { id, secret, token };
}

/** Everything one signed request needs. */
export interface SignInput {
  grant: WorkerGrant;
  owner: string;
  method: string;
  target: string;
  body?: Buffer;
  timestamp?: number;
  nonce?: string;
}

/**
 * @description Headers for one request under a grant: key = SHA-256("oshal-lora-callback-grant-v1:"
 * + secret), signature = HMAC-SHA256(key, METHOD|target|ts|nonce|hex SHA-256(body)).
 * @param input - Grant, owner, method, exact request target and body.
 * @returns The five contract headers.
 */
export function signedHeaders(input: SignInput): Record<string, string> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomBytes(18).toString('base64url');
  const key = createHash('sha256').update(`oshal-lora-callback-grant-v1:${input.grant.secret}`).digest();
  const bodyHash = createHash('sha256').update(input.body ?? Buffer.alloc(0)).digest('hex');
  const signature = createHmac('sha256', key)
    .update(`${input.method.toUpperCase()}|${input.target}|${timestamp}|${nonce}|${bodyHash}`).digest('hex');
  return {
    'x-lora-callback-grant': input.grant.id,
    'x-lora-callback-owner': Buffer.from(input.owner, 'utf8').toString('base64url'),
    'x-lora-callback-timestamp': String(timestamp),
    'x-lora-callback-nonce': nonce,
    'x-lora-callback-signature': signature,
  };
}

/** A prepared request that can be sent, and sent again byte for byte to prove replay refusal. */
export interface PreparedRequest { url: string; init: RequestInit }

/**
 * @description Prepare a signed JSON callback to the ingest mount.
 * @param base - Server origin.
 * @param grant - The worker's grant.
 * @param owner - The grant owner's plain sub.
 * @param payload - The callback body.
 * @param overrides - Optional timestamp/nonce/target for refusal cases.
 * @returns A request that can be sent more than once.
 */
export function signedCallback(
  base: string, grant: WorkerGrant, owner: string, payload: Record<string, unknown>,
  overrides: { timestamp?: number; nonce?: string; target?: string } = {},
): PreparedRequest {
  const target = overrides.target ?? '/api/lora/ingest';
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = signedHeaders({ grant, owner, method: 'POST', target, body, timestamp: overrides.timestamp, nonce: overrides.nonce });
  return { url: base + target, init: { method: 'POST', headers: { ...headers, 'content-type': CALLBACK_TYPE }, body } };
}

/**
 * @description Prepare a signed raw-image upload or a signed GET under a grant.
 * @param base - Server origin.
 * @param grant - The worker's grant.
 * @param owner - The grant owner's plain sub.
 * @param method - POST for an image upload, GET for a download.
 * @param target - Exact path and query.
 * @param image - Image bytes and type for a POST.
 * @returns A request that can be sent more than once.
 */
export function signedRequest(
  base: string, grant: WorkerGrant, owner: string, method: 'GET' | 'POST', target: string,
  image?: { bytes: Buffer; type: string },
): PreparedRequest {
  const headers = signedHeaders({ grant, owner, method, target, body: image?.bytes });
  return { url: base + target, init: image
    ? { method, headers: { ...headers, 'content-type': image.type }, body: image.bytes }
    : { method, headers } };
}

/**
 * @description Send a prepared request.
 * @param request - The prepared request.
 * @returns The response.
 */
export function send(request: PreparedRequest): Promise<Response> {
  return fetch(request.url, request.init);
}
