/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The master record as one Markdown file (1.51.0): the page's Download and, cut into pages, what the concierge reads. Every role with its numbered bullets, skills and stories; every skill under its group, one per line; additional experience; education and certifications; evidence; the history newest first with what was added and the person's own words, then Strengthen answers and snapshot dates; the documents kept outside Career. Career's private writing notes are left out and named in one closing line (plan section 5, question 3).
 */
'use strict';

/** A list item stays on one line, whatever line breaks its text holds. */
const one = (value) => String(value).replace(/\s*\r?\n\s*/g, ' ').trim();
const quote = (value) => String(value).split(/\r?\n/).map((line) => (`> ${line}`).trimEnd());
const bulleted = (items) => items.map((item) => `- ${one(item)}`);
const numbered = (items) => items.map((item, index) => `${index + 1}. ${one(item)}`);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const join = (parts, glue) => parts.filter(Boolean).join(glue);

function header(r) {
  const c = r.counts, read = `${r.asOf.slice(0, 16).replace('T', ' ')} UTC`;
  return [`# Master record${r.person.name ? ` — ${one(r.person.name)}` : ''}`, '',
    `Everything Career keeps for you, read ${read}. Career changed nothing to make this file.`, '', '## Counts', '',
    `- Roles: ${c.roles}`, `- Bullets: ${c.bullets}`,
    `- Skills: ${c.skills} in ${plural(c.skillGroups, 'group')}, plus ${c.roleSkills} tagged on roles`,
    `- Stories: ${c.stories}`, `- Additional experience: ${c.additional}`,
    `- Education: ${c.education} · Certifications: ${c.certifications} · Licenses: ${c.licenses}`,
    `- Metrics: ${c.metrics} · Projects: ${c.projects} · Account groups: ${c.accountGroups} (${plural(c.accounts, 'account')})`
      + ` · Employers: ${c.employers} · Speaking: ${c.speaking}`,
    `- Headline options: ${c.headlineOptions}`,
    `- History of what you added: ${plural(c.history, 'record')}${c.unreadableHistory ? ` (${c.unreadableHistory} more could not be read)` : ''}`,
    `- Strengthen: ${c.strengthenAnswers} answered of ${plural(c.strengthenThemes, 'theme')}`,
    `- Snapshots taken before a change: ${c.snapshots}`, `- Linked documents: ${c.linked}`, ''];
}

function profile(r) {
  const p = r.person, out = ['## Profile', ''];
  const headline = p.headline || (p.credential ? '(none saved; your résumé shows your credential line in its place)' : '(none saved)');
  for (const [label, value] of [['Name', p.name], ['Credential', p.credential], ['Headline', headline], ['Location', p.location],
    ['Citizenship', p.citizenship], ['Clearance', p.clearance], ['Email', p.email], ['Phone', p.phone], ['LinkedIn', p.linkedin]]) {
    if (value) out.push(`- ${label}: ${one(value)}`);
  }
  for (const link of p.links) out.push(`- ${one(link.label || 'Link')}: ${link.url}`);
  if (p.headlineOptions.length) out.push('', '### Headline options', '', ...numbered(p.headlineOptions));
  if (p.summary) out.push('', '### Summary', '', p.summary);
  if (r.competencies.length) out.push('', '### Core competencies', '', ...bulleted(r.competencies));
  return [...out, ''];
}

function role(item, index) {
  const dates = item.start || item.end ? join([item.start, item.end || 'present'], ' – ') : '';
  const out = [`### ${index + 1}. ${one(join([item.title, item.org], ' — ')) || 'Untitled role'}`, ''];
  const facts = join([dates, item.notPublic ? 'marked not public' : ''], ' · ');
  if (facts) out.push(facts, '');
  out.push(...(item.bullets.length ? numbered(item.bullets) : ['No bullets saved for this role.']));
  if (item.skills.length) out.push('', `Skills on this role: ${item.skills.map(one).join(' · ')}`);
  if (item.stories.length) {
    out.push('', 'Stories:', '');
    for (const story of item.stories) {
      out.push(`- ${one(join([story.title, story.story], ': '))}${story.bullet ? ` (supports: ${one(story.bullet)})` : ''}`
        + `${story.weak ? ' (marked as carrying little evidence)' : ''}`);
    }
  }
  return [...out, ''];
}

function experience(r) {
  return ['## Experience', '', ...(r.experience.length ? r.experience.flatMap(role) : ['No roles saved.', ''])];
}

function skills(r) {
  const out = ['## Skills', ''];
  if (!r.skills.length) out.push('No skills saved.', '');
  for (const group of r.skills) {
    out.push(`### ${one(group.group)}${group.proficiency ? ` (${one(group.proficiency)})` : ''}`, '');
    if (group.note) out.push(one(group.note), '');
    out.push(...(group.items.length ? bulleted(group.items) : ['No skills in this group.']), '');
  }
  return out;
}

function additionalEntry(entry, index) {
  const out = [`### ${index + 1}. ${one(entry.title) || 'Untitled entry'}`, '',
    join([entry.role, entry.organization !== entry.title ? entry.organization : '', entry.period, entry.kind, entry.source,
      entry.archived ? 'archived' : ''].map((part) => one(part)), ' · '), ''];
  if (entry.summary) out.push(entry.summary, '');
  if (entry.bullets.length) out.push(...numbered(entry.bullets), '');
  if (entry.facts) out.push('Work details:', '', entry.facts, '');
  for (const [label, items] of [['Skills', entry.skills], ['Technology', entry.tech], ['Applications', entry.applications], ['Links', entry.links]]) {
    if (items.length) out.push(`${label}: ${items.map(one).join(' · ')}`, '');
  }
  return out;
}

function additional(r) {
  return ['## Additional experience', '', ...(r.additional.length ? r.additional.flatMap(additionalEntry) : ['No additional experience saved.', ''])];
}

function qualifications(r) {
  const out = ['## Education and certifications', ''];
  for (const [label, items] of [['Education', r.education], ['Certifications', r.certifications], ['Licenses', r.licenses]]) {
    if (label === 'Licenses' && !items.length) continue;
    out.push(`### ${label}`, '', ...(items.length ? bulleted(items) : [`No ${label.toLowerCase()} saved.`]), '');
  }
  return out;
}

function evidence(r) {
  const e = r.evidence, out = ['## Evidence', ''];
  for (const [label, items] of [['Metrics', e.metrics], ['Project ledger', e.projects]]) {
    out.push(`### ${label}`, '', ...(items.length ? bulleted(items) : ['None saved.']), '');
  }
  out.push('### Named accounts', '');
  if (!e.accounts.length) out.push('None saved.', '');
  for (const group of e.accounts) out.push(`#### ${one(group.group)}`, '', ...bulleted(group.items), '');
  for (const [label, items] of [['Speaking', e.speaking], ['Employers', e.employers]]) {
    out.push(`### ${label}`, '', ...(items.length ? bulleted(items) : ['None saved.']), '');
  }
  return out;
}

function historyRecord(item) {
  const out = [`### ${join([item.when, item.source && one(item.source)], ' · ')}`, ''];
  if (item.added.length) out.push('What was added:', '', ...bulleted(item.added), '');
  if (item.words) out.push('Your words:', '', ...quote(item.words), '');
  return out;
}

function history(r) {
  const out = ['## History, newest first', ''];
  out.push(...(r.history.length ? r.history.flatMap(historyRecord) : ['No history of added facts yet.', '']));
  if (r.unreadableHistory) out.push(`${plural(r.unreadableHistory, 'history line')} could not be read and ${r.unreadableHistory === 1 ? 'is' : 'are'} not shown.`, '');
  out.push('### Strengthen answers', '');
  if (!r.strengthen.length) out.push('No Strengthen answers yet.', '');
  for (const answer of r.strengthen) {
    out.push(`#### ${join([answer.when, one(answer.theme)], ' · ')}`, '', ...(answer.answer ? quote(answer.answer) : ['Marked answered, with no words saved.']), '');
  }
  out.push('### Snapshots taken before a change', '', ...(r.snapshots.length ? bulleted(r.snapshots.map((s) => s.when)) : ['None.']), '');
  return out;
}

function linked(r) {
  const out = ['## Linked documents', ''];
  out.push(...(r.linked.length ? r.linked.map((doc) => `- ${doc.label}: ${doc.url} (kept outside Career)`) : ['None linked.']), '');
  const n = r.notes, kept = [plural(n.framing.length, 'framing note'), plural(n.gaps.length, 'gap to collect', 'gaps to collect'),
    plural(n.locked.length, 'locked fact')];
  if (n.framing.length || n.gaps.length || n.locked.length) {
    out.push(`Not in this file: the notes Career keeps for writing (${kept.join(', ')}). They are on the Master record page.`, '');
  }
  return out;
}

/**
 * @description Render a master record as one Markdown file. Text is carried as saved: a list item is
 * put on one line, words and answers keep their lines as quotes. The private writing notes are not
 * rendered; their counts are named in one closing line.
 * @param {object} r A record from career-master-record.js readMasterRecord.
 * @returns {string} The Markdown, ending in one newline.
 */
function toMarkdown(r) {
  if (!r.present) {
    return [...header(r), 'You have not saved a résumé in Career yet. Upload one in Resume Studio and this record fills in.', '']
      .join('\n');
  }
  const lines = [header(r), profile(r), experience(r), skills(r), additional(r), qualifications(r), evidence(r), history(r), linked(r)].flat();
  // One blank line between blocks; a blank line inside the person's own text is a part of that text and stays.
  return `${lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n').trimEnd()}\n`;
}

module.exports = { toMarkdown };
