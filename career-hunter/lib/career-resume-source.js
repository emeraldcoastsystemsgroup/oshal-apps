/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One bounded owner-profile reader for concierge status and automatic facts; no corpus, engine, model or document-store dependency.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: asked on Work history why his résumé did not show a job, the concierge answered "I can't see that document from here"). The status told the concierge that My résumé opens a separate document it could not read. The document is a view of the main résumé now (tools/career-resume-office.js settle), so the note says so: what the concierge reads here is what My résumé shows. The status also names the revision before the latest change (previousRevision, the newest kept backup), which is what Undo needs, and the Work history page.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EDIT_SCREEN = '/cockpit/?app=career-hunter&screen=career-resume-studio';
const HISTORY_SCREEN = '/cockpit/?app=career-hunter&screen=career-work-history';
const DOCUMENT_NOTE = 'My résumé shows this main résumé as a Word document, and Work history shows its jobs. They are one thing: '
  + 'a change saved here is in the document the next time a Career page or My résumé is open, with no extra step, and what the '
  + 'person types in the document is saved into this main résumé. What you read with the résumé tools is what My résumé shows.';
/** The revision of the newest kept backup: the main résumé as it was before its latest change, or null when none is kept. */
function previousRevision(userDir) {
  try {
    const folder = path.join(userDir, 'backups');
    const newest = fs.readdirSync(folder).filter(name => /^career_db\..+\.json$/.test(name))
      .map(name => ({name, stat:fs.lstatSync(path.join(folder, name))}))
      .filter(item => item.stat.isFile() && item.stat.size <= 4 * 1024 * 1024)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
    return newest ? crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, newest.name))).digest('hex') : null;
  } catch { return null; }
}
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
  return {present, revision, previousRevision:present ? previousRevision(userDir) : null,
    jobs:present && Array.isArray(raw.roles) ? raw.roles.length : 0,
    sections:present ? fields.filter(([, , value]) => nonempty(value)).map(([field, heading]) => ({field, heading})) : [],
    editScreen:EDIT_SCREEN, workHistoryScreen:HISTORY_SCREEN,
    message:present ? 'Your main résumé is saved in Career.' : 'You have not saved a résumé in Career yet.',
    documentNote:DOCUMENT_NOTE};
}
module.exports = {readResumeSource, resumeStatus};
