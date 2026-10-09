/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify owned source UI over isolated member APIs; this is not deployed authorization proof.
 */
process.env.OSHAL_EXPERIENCE_PROOF_PACKAGE = 'studio-experience';
require('./support/browser-proof.ts');
