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

/** @description What a relay knows about itself at one instant. */
export interface LocalInputs {
  /** The inward neighbour (or the base) answers beacons. */
  innerLinkOk: boolean;
  /** Seconds the inner link has been silent (0 when ok). */
  innerLostForS: number;
  /** How far the relay has already shifted inward during this loss, metres. */
  movedInwardM: number;
  /** The design hop, metres — the most a relay shifts on its own. */
  hopM: number;
  /** Flight time left, seconds. */
  remainingS: number;
  /** Seconds the flight home along the corridor takes from here. */
  returnTimeS: number;
  /** Reserve to keep on top of the flight home, seconds. */
  reserveS: number;
  detectS: number;
  rtlAfterS: number;
}

/** @description The action a relay takes on its own. */
export interface LocalAction {
  action: 'hold' | 'shift-in' | 'rtl';
  reason: 'nominal' | 'battery' | 'inner-link-silent' | 'shifted-one-hop' | 'inner-link-timeout';
}

/**
 * @description Decide the relay's own action. Priority: battery, timeout, shift, hold.
 * @param i - The instant's inputs.
 * @returns The action and why.
 */
export function decideLocal(i: LocalInputs): LocalAction {
  if (i.remainingS <= i.returnTimeS + i.reserveS) return { action: 'rtl', reason: 'battery' };
  if (i.innerLinkOk) return { action: 'hold', reason: 'nominal' };
  if (i.innerLostForS >= i.rtlAfterS) return { action: 'rtl', reason: 'inner-link-timeout' };
  if (i.innerLostForS < i.detectS) return { action: 'hold', reason: 'nominal' };
  if (i.movedInwardM < i.hopM) return { action: 'shift-in', reason: 'inner-link-silent' };
  return { action: 'hold', reason: 'shifted-one-hop' };
}
