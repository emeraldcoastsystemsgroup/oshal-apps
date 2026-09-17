/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — one answer to "is the owner of a shared
 *                     |                             | catalog row installed beside this package?",
 *                     |                             | for the suites that must assert the catalog's
 *                     |                             | ACTUAL contract. A shared row resolves when its
 *                     |                             | owner is there and is withheld when it is not,
 *                     |                             | and both are correct: store packages install
 *                     |                             | one at a time, and the framework's Test Lab
 *                     |                             | runs a package case against a snapshot of ONE
 *                     |                             | package directory with no siblings. A suite
 *                     |                             | that pins the resolved count instead reds the
 *                     |                             | package wherever the owner is legitimately
 *                     |                             | absent, which is the operator case of
 *                     |                             | installing this lab without Animatronics.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * @description The rows a catalog file DECLARES, before any owner is resolved.
 * @param {string} file Path to catalog/drivers.json.
 * @returns {object[]} The raw declared rows.
 */
function declaredDrivers(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.drivers)) throw new Error(`${file} declares no drivers list`);
  return raw.drivers;
}

/**
 * @description The shared rows in a catalog file whose owner package is NOT installed beside it —
 * exactly the rows the loader will withhold, worked out from the declaration and the filesystem
 * rather than from the loader's own answer, so a suite comparing the two is comparing two things.
 * @param {string} file Path to catalog/drivers.json.
 * @param {string} [packagesRoot] Where packages sit side by side; defaults to the package's parent.
 * @returns {Array<{ id: string, type: string, owner: string, file: string }>} The withheld rows.
 */
function missingSharedOwners(file, packagesRoot) {
  const root = packagesRoot ?? path.resolve(path.dirname(file), '..', '..');
  return declaredDrivers(file)
    .filter((row) => row && typeof row === 'object' && row.sharedPart && typeof row.sharedPart === 'object')
    .filter((row) => !fs.existsSync(path.join(root, String(row.sharedPart.owner), ...String(row.sharedPart.file).split('/'))))
    .map((row) => ({ id: row.id, type: row.type, owner: row.sharedPart.owner, file: row.sharedPart.file }));
}

module.exports = { declaredDrivers, missingSharedOwners };
