/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One bounded owner-profile reader for concierge status and automatic facts; no corpus, engine, model or document-store dependency.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EDIT_SCREEN = '/cockpit/?app=career-hunter&screen=career-resume-studio';
const unavailable = () => Object.assign(new Error('Your saved résumé could not be read. Open My résumé to check it.'), {status:503});
/** Read only the resolved owner's regular profile, retaining its exact revision and refusing unsafe sources. */
function readResumeSource(userDir) {
  if (!userDir) return {present:false, raw:{}, revision:null};
  const file = path.join(userDir, 'career_db.json');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return {present:false, raw:{}, revision:null}; throw unavailable(); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw unavailable();
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw unavailable();
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd), current = fs.lstatSync(file);
    if (bytes.length > 4 * 1024 * 1024 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || current.ino !== opened.ino || current.dev !== opened.dev) throw unavailable();
    const raw = JSON.parse(bytes.toString('utf8'));
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw unavailable();
    return {present:true, raw, revision:crypto.createHash('sha256').update(bytes).digest('hex')};
  } catch { throw unavailable(); } finally { if (fd !== undefined) fs.closeSync(fd); }
}
/** Return presence and fixed section headings only. Saved document text is never part of this observation. */
function resumeStatus(userDir) {
  const {present, raw, revision} = readResumeSource(userDir), p = raw.profile || {};
  const nonempty = value => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0;
  const fields = [['headline','Headline',p.headline || p.credential], ['summary','Summary',p.experience_summary],
    ['competencies','Core competencies',raw.competencies], ['skills','Skills',Object.values(raw.skills || {}).flatMap(g => g?.items || [])],
    ['experience','Experience',raw.roles], ['education','Education',raw.education], ['certifications','Certifications',raw.certifications],
    ['licenses','Licenses',raw.licenses], ['clearance','Clearance',p.clearance]];
  return {present, revision, sections:present ? fields.filter(([, , value]) => nonempty(value)).map(([field, heading]) => ({field, heading})) : [],
    editScreen:EDIT_SCREEN, message:present ? 'Your main résumé is saved in Career.' : 'You have not saved a résumé in Career yet.',
    documentNote:'My résumé opens a separate AI Office document. Use Save to main résumé there to update Career; document-only edits are not included here.'};
}
module.exports = {readResumeSource, resumeStatus};
