/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One stub for the kernel's `@/shared/deployment-mode` so every isolated route load resolves the runner's ADR-137-A import; mirrors src/shared/deployment-mode.ts exactly (DEMO_MODE alone, exact operator subject) so the wall-vs-carve tests exercise the real contract.
 */

/**
 * @description Stand-in for `@/shared/deployment-mode` in isolated package tests.
 * @returns The two predicates the career engine runner imports
 */
export function deploymentModeStub() {
  return {
    demoModeEnabled: () => ['1', 'true', 'yes', 'on'].includes((process.env.DEMO_MODE || '').trim().toLowerCase()),
    isDeploymentOperatorSub: (sub) => typeof sub === 'string' && (process.env.OSHAL_OPERATOR_SUBS || '')
      .split(',').map((s) => s.trim()).filter(Boolean).includes(sub),
  };
}
