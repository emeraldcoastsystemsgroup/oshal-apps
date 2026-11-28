# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (the coordinator, 2026-11-27: documents from an earlier Career must not count as stale for every release, or each release would make every person's documents be written again, one at a time): the revision of how Career writes a job's documents, apart from the Career version. generate.py records it on every generation (application.json documents_revision, beside career_version); lib/career-documents-turn.js reads this file, and Fill in several writes a job's documents again before approving it only when its packet records an older revision (or its letter is dated an earlier day). A packet that records none was written under revision 1.
"""The revision of how Career writes a job's documents, which only a change to that writing moves."""

#: Bump only when how a job's documents are written changes: a writing pass, a prompt, a template or a check the
#: documents go through. A release that changes nothing about the documents leaves it as it is. Every packet made
#: before a bump is then written again before Fill in several approves it; one that records no revision counts as 1.
DOCUMENTS_REVISION = 1
