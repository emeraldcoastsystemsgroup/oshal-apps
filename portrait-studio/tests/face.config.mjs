/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reuse the explicit core fixture dependencies for real local detector browser proof.
 */
import config from './authorization.config.mjs';
export default { ...config, test: { ...config.test, include: ['face-browser.spec.ts'] } };
