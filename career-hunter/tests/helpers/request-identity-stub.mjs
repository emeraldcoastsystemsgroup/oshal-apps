/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A scoped double of the kernel's request-identity module (@/shared/services/database/request-identity) for the bare-checkout suites, which have no framework to resolve it from: the same AsyncLocalStorage contract (runWithRequestIdentity, runWithSystemIdentity, getRequestIdentity, the frozen SYSTEM_IDENTITY sentinel). The compiled dispatch reads the caller's verified issuer from it, the automation route records it, and the rail handler requires it to be the run owner; the real module is crossed by tests/career-rail-kernel-boundary.core.test.js.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** The trusted background sentinel, as the kernel defines it. */
export const SYSTEM_IDENTITY = Object.freeze({ sub: null, principalIssuer: null, isOperator: true, isSystem: true });

/**
 * @description Build the module shape the compiled routes require.
 * @returns {object} The identity module double.
 */
export function requestIdentityStub() {
  return {
    SYSTEM_IDENTITY,
    getRequestIdentity: () => store.getStore(),
    runWithRequestIdentity: (identity, fn) => store.run(identity, fn),
    runWithSystemIdentity: (fn) => store.run(SYSTEM_IDENTITY, fn),
    isSystemIdentity: (identity) => identity === SYSTEM_IDENTITY,
  };
}

/** One shared instance, so a harness and a spec see the same context. */
export const requestIdentity = requestIdentityStub();
