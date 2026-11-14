/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First participant-status seam (0.1.0), closed by default. A coach reads a snapshot as themself, and the kernel proves the coach is an active person at the door; nothing the kernel offers a package tells whether the OTHER person (the seeker) is still active, suspended or deactivated. The package's own person row is a stale application record and does not count (study "Proposed consent and identity contract"). So the installation's status reader says it is unavailable, and every coach read is refused before any snapshot row is read. A kernel that later offers an exact, tenant-bounded status read of one named principal can be wired here; until then nothing reaches a coach.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: wired to the kernel's `person.status` read (kernel crates/oshald/src/person_status.rs, declared in the manifest as `person-status.read`). The reader asks about one exact person by native id, issuer and subject and takes only the two answers the kernel gives: `{status: 'active'}` confirms them, `{status: 'inactive'}` (suspended, deactivated, unknown to the kernel or in another organization, all in the same word) closes their snapshot, and anything else (a refusal, an error, an extra field, another word) is no answer and refuses. `ready()` proves the read exists on this installation by asking about the caller, whom the kernel has just admitted: on a kernel without the read, or where the package was not linked it, the coach's page stays closed before any row is read and the seeker is still told coaches cannot open shares here.
 */
'use strict';
const {createLogger} = require('./log');

const logger = createLogger('career-coaching-participants');

/** What a coach is told when the platform cannot confirm both people are current. */
const UNAVAILABLE = Object.freeze({
  ok: false,
  code: 'participant_status_unavailable',
  message: 'Shared snapshots can’t be shown yet: this installation can’t confirm that the person who shared is still an active member.',
});

/** What the reader answers for a person the kernel says is no longer current. */
const INACTIVE = Object.freeze({ok: false, code: 'participant_inactive', message: 'This snapshot is no longer available.'});

/** The one kernel intent this package sends. */
const STATUS_INTENT = 'person.status';

/**
 * @description One exact person's standing from the kernel. Only the kernel's two exact answers count.
 * @param {(name: string, input: object) => Promise<unknown>} intent - The kernel bridge's intent call.
 * @param {object} person - {personId, issuer, subject} of the person asked about.
 * @returns {Promise<object>} {ok:true}, INACTIVE, or UNAVAILABLE when the kernel gave no usable answer.
 */
async function standing(intent, person) {
  let answer;
  try {
    answer = await intent(STATUS_INTENT, {principal_id: person.personId, issuer: person.issuer, subject: person.subject});
  } catch (error) {
    // The kernel's own words say why (not declared, no such read, a store it could not read); they name nobody.
    logger.error({err: error, intent: STATUS_INTENT}, 'the kernel did not answer the person status read');
    return UNAVAILABLE;
  }
  const exact = Boolean(answer) && typeof answer === 'object' && !Array.isArray(answer) && Object.keys(answer).length === 1;
  if (exact && answer.status === 'active') return {ok: true};
  if (exact && answer.status === 'inactive') return INACTIVE;
  logger.error({intent: STATUS_INTENT}, 'the kernel answered the person status read with something other than active or inactive');
  return UNAVAILABLE;
}

/**
 * @description The installation's participant-status reader: the kernel's `person.status` read through the bridge's
 * intent call (crates/host-process/bridge/runner.js loadPackage ctx.intent). A context without that call gets a closed
 * reader. It never reads the package's own rows as a stand-in.
 * @param {object} ctx - Package context from the kernel bridge.
 * @returns {{available: boolean, check: (person: object) => Promise<object>}} The reader.
 */
function kernelParticipantStatus(ctx) {
  if (!ctx || typeof ctx.intent !== 'function') {
    return Object.freeze({available: false, async check() { return UNAVAILABLE; }});
  }
  const intent = (name, input) => ctx.intent(name, input);
  return Object.freeze({available: true, check: (person) => standing(intent, person)});
}

/**
 * @description Whether this installation can confirm people at all: the reader is asked about the caller, whom the
 * kernel admitted for this very request. No answer, an error or anything but a confirmation means it cannot.
 * @param {{available: boolean, check: Function}} reader - Participant-status reader.
 * @param {object} caller - verifiedCaller() of the request.
 * @returns {Promise<boolean>} True only when the reader confirmed the caller.
 */
async function ready(reader, caller) {
  if (!reader || reader.available !== true || typeof reader.check !== 'function' || !caller) return false;
  try {
    const answer = await reader.check(Object.freeze({personId: caller.personId, issuer: caller.issuer, subject: caller.subject,
      tenant: caller.tenant}));
    return Boolean(answer && answer.ok === true);
  } catch { return false; }
}

/**
 * @description Ask a reader whether every named person is current; any refusal, error or odd answer refuses.
 * @param {{available: boolean, check: Function}} reader - Participant-status reader.
 * @param {object[]} people - {personId, issuer, subject, tenant} for each participant other than the caller.
 * @returns {Promise<object>} {ok:true} only when the reader confirmed each person.
 */
async function confirmActive(reader, people) {
  if (!reader || reader.available !== true || typeof reader.check !== 'function') return UNAVAILABLE;
  for (const person of people) {
    let answer;
    try { answer = await reader.check(Object.freeze({...person})); } catch { return UNAVAILABLE; }
    if (!answer || answer.ok !== true) return answer && answer.code === INACTIVE.code ? INACTIVE : UNAVAILABLE;
  }
  return {ok: true};
}

module.exports = {UNAVAILABLE, INACTIVE, STATUS_INTENT, kernelParticipantStatus, ready, confirmActive};
