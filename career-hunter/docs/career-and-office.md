# How Career and AI Office work together on the master resume

Since Career 1.49.0, Resume Studio opens the person's **master resume** (the durable career profile
every tailored resume is generated from) as an editable **Word document in AI Office's own editor**.
Career does not copy any AI Office code. It embeds AI Office's editor page on one document and keeps
only the mapping between that document and the master resume.

## Who owns what

| Part | Owner | Where |
|---|---|---|
| The master resume (headline, summary, competencies, skills, clearance, each role's bullets) | Career | the career profile, written only through `resume base-save` (the whitelist) |
| The Word document "Master resume (Career)", its revisions, Undo and Revision history | AI Office | the person's own AI Office documents (owner-scoped, 40 per person, 100 revisions per document) |
| Editing in the document: typing, formatting, the Concierge's approved edits | AI Office | `/api/presentations/editor/app?document=<id>`, the shared editor foundation and the standard Concierge |
| Mapping document ↔ master resume, Save to master resume, Replace with the saved master resume | Career | `tools/career-resume-office.js` |

## The document's shape (the contract Career reads back)

- **Title** paragraph: the person's name (not saved; the profile owns it).
- The paragraph under it (Heading 2): the **headline**.
- One **Heading 1** per section, with these exact names: Summary, Core competencies, Skills, Experience,
  Education, Certifications, Clearance.
- **Experience**: one **Heading 2** per role ("Title — Employer"), its dates in the next paragraph,
  then one **bullet** paragraph per bullet. Roles are matched by position.
- **Skills**: one paragraph, items separated by " · ".

On Save to master resume, Career takes only headline, summary, competencies, skills, clearance and each
role's bullets. Role titles, employers and dates stay the profile's: a changed role heading is kept in
the document only and the save says so. A document with a different number of roles than the profile is
refused in words. A section with another name (for example "Volunteering") stays in the document only.
Education and certifications are source statements and are not written from the document.

## Rules for the assistants

- **The Concierge beside the document is AI Office's standard Concierge** (`deck-builder`). It edits the
  open document through AI Office's own operations (`office-apply-edits`, a `text-range` on the existing
  paragraph), each one an approval card; the person approves it, and Undo or Revision history takes it
  back. Its persona (`presentations/personas/deck-builder.yaml`, "A Career master resume") keeps the
  headings above intact and never invents facts.
- **The Career bot** (`personas/career-hunter.yaml`) sends a resume edit request to Resume Studio and
  never uses `career_resume_patch` / `career_resume_save` while the document is open (the screen's context
  carries `fields.officeDocument`), because that would rewrite the profile behind the person's document.
- **Reading the current text:** the standard Concierge saves the document before every message. When
  Jarvis or the Career concierge asks from Resume Studio, the screen first saves the document into the
  master (the 1.29.3 "save before a read" handoff), so `career_resume_read` shows what the person has.
- If a Career or Jarvis turn does change the saved master, Resume Studio writes it into the document as a
  new revision; the earlier text stays in AI Office's Revision history.
- **Jarvis** hands a resume request to Career by the routing words on the Career bot (my resume, master
  resume, edit/tighten/update my resume) and Career's description; AI Office's own words are "a word document".

## What the Career bot cannot do yet

The kernel lets a bot see and call only its own package's tools, plus tools it imports **and** the person
was granted (`crates/packages/src/registrations.rs`, `tools_visible_to` and `may_call`). So the Career bot
itself cannot propose an edit inside an AI Office document today. Letting it would need AI Office to export
`office-apply-edits`, Career to import it, and a `tool.office-apply-edits` grant on Career's roles, which
changes what Career's assignments grant. Until then the document's Concierge is AI Office's.

## Without AI Office

If AI Office is not installed or not granted to the person, Resume Studio opens the master resume in the
classic preview with Career's resume editor and says why. Tailored job packets always use the classic
preview and editor.

## Guards

- `tests/career-resume-office.test.mjs`: the document passes AI Office's model validation, maps back
  exactly, and an edited document saved through the real `resume base-save` keeps the profile valid.
- `tests/career-resume-office-browser.spec.mjs` (lane-run; needs the disposable PostgreSQL at 35689 and a
  kernel platform export): edit the headline, ask the Concierge to tighten a bullet, approve, save,
  re-open and see both; another person cannot read the document; the phone layout.
