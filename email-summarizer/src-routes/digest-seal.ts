/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | The saved day summary is sealed by the kernel (the declared memory skill), which holds the key. The package's own helper needed a SESSION_SECRET the native kernel never hands a package, so the model answered and saving the answer failed with 502: "Summary unavailable".
 *
 * @module digest-seal
 */
import { decryptField, encryptField, isEncrypted } from '@/features/personal-data';

/**
 * @description Seal a day summary for its owner.
 * @param owner - The person the summary belongs to.
 * @param summary - The summary text.
 * @returns The sealed value to store.
 */
export async function sealDigest(owner: string, summary: string): Promise<string> {
  return await encryptField(owner, summary);
}

/**
 * @description Open a stored day summary. A summary is a cache, so one sealed by the earlier platform, whose key this
 * installation does not hold, reads as none and the person's next summary replaces it. Any other failure is thrown: a kernel
 * that cannot open a current value must not look like "nothing saved".
 * @param owner - The person the summary belongs to.
 * @param stored - The stored value.
 * @returns The summary, or null when this installation cannot have sealed it.
 */
export async function openDigest(owner: string, stored: string): Promise<string | null> {
  if (!isEncrypted(stored)) return null;
  try {
    return await decryptField(owner, stored);
  } catch (err) {
    if ((err as { code?: string }).code === 'personal_data_reentry_required') return null;
    throw err;
  }
}
