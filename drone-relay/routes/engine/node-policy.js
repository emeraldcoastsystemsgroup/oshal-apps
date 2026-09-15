"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The rule every relay carries on board and applies WITHOUT the
 *                     |                             | controller: battery first (fly home while the flight home
 *                     |                             | plus the reserve still fit), then the inner link — silent
 *                     |                             | past the detect window, shift one hop inward along the
 *                     |                             | corridor and hold; silent past the RTL window, fly home along
 *                     |                             | the corridor. The outer link is the controller's problem; a
 *                     |                             | relay never chases outward. Pure and deterministic so the
 *                     |                             | simulation, the tests and a companion firmware can share it
 *                     |                             | line for line.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideLocal = decideLocal;
/**
 * @description Decide the relay's own action. Priority: battery, timeout, shift, hold.
 * @param i - The instant's inputs.
 * @returns The action and why.
 */
function decideLocal(i) {
    if (i.remainingS <= i.returnTimeS + i.reserveS)
        return { action: 'rtl', reason: 'battery' };
    if (i.innerLinkOk)
        return { action: 'hold', reason: 'nominal' };
    if (i.innerLostForS >= i.rtlAfterS)
        return { action: 'rtl', reason: 'inner-link-timeout' };
    if (i.innerLostForS < i.detectS)
        return { action: 'hold', reason: 'nominal' };
    if (i.movedInwardM < i.hopM)
        return { action: 'shift-in', reason: 'inner-link-silent' };
    return { action: 'hold', reason: 'shifted-one-hop' };
}
//# sourceMappingURL=node-policy.js.map