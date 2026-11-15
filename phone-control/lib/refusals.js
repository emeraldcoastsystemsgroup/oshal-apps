/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.1: every "not found" this package answers carries a sentence a person can read beside its code, as its other refusals do (blue acceptance 2026-11-14: POST /devices/<unknown>/apps, tool phone-control-tv-apps, answered only {"error":"device_not_found"}; Smart Home says "No saved TV is called ..."). Another person's device reads exactly like a device nobody saved.
 */

'use strict';

/** What a refusal repeats of the caller's own input: one line, at most 80 characters. */
const said = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * @description Answer 404 with the code and its sentence.
 * @param {object} res The response. @param {string} error The code. @param {string} message The sentence.
 * @returns {object} The response.
 */
function missing(res, error, message) {
  return res.status(404).json({ error, message });
}

/** @description No saved device of this person's by that id or name. @param {object} res The response. @param {string} id What was asked for. @returns {object} The response. */
const deviceNotFound = (res, id) => missing(res, 'device_not_found',
  `No saved device is called "${said(id)}". List your devices first (phone-control-list-devices).`);
/** @description No saved capture of this person's by that id. @param {object} res The response. @returns {object} The response. */
const captureNotFound = (res) => missing(res, 'capture_not_found',
  'No saved capture has that id. List your captures first (phone-control-list-captures).');
/** @description No staged transfer of this person's by that id. @param {object} res The response. @returns {object} The response. */
const transferNotFound = (res) => missing(res, 'transfer_not_found',
  'No staged transfer has that id. List your transfers first (phone-control-list-transfers).');
/** @description No bridge file by that name. @param {object} res The response. @param {string} name What was asked for. @returns {object} The response. */
const bridgeFileNotFound = (res, name) => missing(res, 'bridge_file_not_found',
  `The phone bridge has no file called "${said(name)}".`);
/** @description No page file by that name. @param {object} res The response. @param {string} name What was asked for. @returns {object} The response. */
const assetNotFound = (res, name) => missing(res, 'asset_not_found',
  `Phone & Device Control has no page file called "${said(name)}".`);

module.exports = { deviceNotFound, captureNotFound, transferNotFound, bridgeFileNotFound, assetNotFound };
