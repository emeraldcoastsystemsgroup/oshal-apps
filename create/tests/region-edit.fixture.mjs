/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The explicitly named fixture image provider for region-edit tests (create-region-fixture-provider): deterministic solid-colour answers of a size unlike the anchor, optional hold/fail modes, and a record of every call and every cost event. No network, no vendor, no core provider.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Allow explicit synthetic cost classes so HTTP, queue and browser proofs can exercise free, paid and unknown-class consent boundaries without real providers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Model the kernel's operator-only CLI rails (core ADR-130 amendment 2026-10-02): `operators` makes the resolver refuse everyone else the way resolveStoryboardImageProvider does for a CLI rail that is not available to the caller (it throws "not configured ... Refusing to fall back"), and `availableFor` makes the resolved provider report available() only for the named people. Both default to everyone.
 */
import { sharp } from './project-api.fixture.mjs';

export const FIXTURE_PROVIDER_ID = 'create-region-fixture-provider';
export const FIXTURE_MODEL = 'create-region-fixture-model';
export const ANSWER = Object.freeze([0, 200, 80, 255]);

/** @description A deterministic, non-uniform RGBA image, so a changed pixel outside a region cannot hide.
 * @param {number} width Pixels across. @param {number} height Pixels down.
 * @returns {Promise<Buffer>} PNG bytes. */
export async function noiseImage(width = 160, height = 100) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const x = index % width, y = Math.floor(index / width);
    pixels.set([(x * 7 + y * 3) % 256, (x * 13 + y * 29) % 256, (x * y + 41) % 256, 255], index * 4);
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** @description Decode any image to raw RGBA for byte comparison.
 * @param {Buffer} bytes Encoded image. @returns {Promise<{data:Buffer,width:number,height:number}>} Pixels and size. */
export async function rgba(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** @description The named fixture provider plus the dependency object the router accepts.
 * @param {{mode?:string,costUsd?:number|null,id?:string,available?:boolean,costClass?:string,operators?:string[],availableFor?:string[]}} options hold, fail or answer; reported cost; provider ID and class; who the resolver serves and who the provider reports itself available to.
 * @returns {object} provider, dependencies, costs, and release() for held answers. */
export function fixtureProvider(options = {}) {
  const calls = [], costs = [], resolvedFor = [], held = [];
  let mode = options.mode ?? 'answer';
  const answer = async () => sharp({ create: { width: 64, height: 48, channels: 4, background: { r: ANSWER[0], g: ANSWER[1], b: ANSWER[2], alpha: 1 } } }).png().toBuffer();
  const provider = {
    id: options.id ?? FIXTURE_PROVIDER_ID, costClass: options.costClass ?? 'paid', available: async () => options.available ?? true,
    async generateWithMeta(prompt, anchor) {
      const size = await sharp(anchor).metadata(); calls.push({ prompt, width: size.width, height: size.height });
      if (mode === 'fail') throw new Error('Fixture provider refused this synthetic request');
      if (mode === 'hold') await new Promise(release => held.push(release));
      return { image: await answer(), costUsd: options.costUsd === undefined ? 0.04 : options.costUsd, model: FIXTURE_MODEL };
    },
    generate: async () => { throw new Error('Fixture provider answers through generateWithMeta only'); },
  };
  const dependencies = {
    resolveProvider: async ({ userSub }) => {
      resolvedFor.push(userSub);
      if (options.operators && !options.operators.includes(userSub)) {
        throw new Error(`storyboard image provider '${provider.id}' is not configured — demo-mode CLI rendering needs an operator caller. Refusing to fall back to a paid provider you did not ask for.`);
      }
      return options.availableFor ? { ...provider, available: async () => options.availableFor.includes(userSub) } : provider;
    },
    recordCost: async (_pool, event) => { costs.push(event); },
  };
  return { provider, dependencies, calls, costs, resolvedFor,
    setMode: next => { mode = next; }, heldCount: () => held.length, release: () => held.splice(0).forEach(done => done()) };
}

/** @description Poll one region edit until it leaves generating (or a predicate holds).
 * @param {Function} call Fixture HTTP caller. @param {string} path Region edit path. @param {Function} done Stop condition.
 * @param {string} actor Fixture actor. @returns {Promise<object>} The last edit read. */
export async function waitForEdit(call, path, done = edit => edit.status !== 'generating', actor = 'alice') {
  const deadline = Date.now() + 10000;
  for (;;) {
    const result = await call(path, 'GET', undefined, actor);
    if (result.status !== 200) throw new Error(`Region edit read failed: ${result.status} ${JSON.stringify(result.body)}`);
    if (done(result.body.edit)) return result.body.edit;
    if (Date.now() > deadline) throw new Error(`Region edit stayed ${result.body.edit.status}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** @description Wait until the held provider has actually received the request.
 * @param {object} fixture The fixtureProvider result. @returns {Promise<void>} Resolves once a call is held. */
export async function whenHeld(fixture) {
  const deadline = Date.now() + 10000;
  while (!fixture.heldCount()) {
    if (Date.now() > deadline) throw new Error('The fixture provider was never called');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
