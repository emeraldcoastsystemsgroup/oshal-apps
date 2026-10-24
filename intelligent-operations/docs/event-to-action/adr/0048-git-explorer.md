# ADR0048: Git explorer and cluster repository links

Status: accepted live, 23 October 2026 (`deploy/evidence/git-live.json`): under the operator's own
GitHub connection the installed explorer listed 22 repositories, opened the demo repository's files as
readable text and linked the lab cluster to it. Kernel PR 85 (GitHub reads), PR 100 (GitLab reads) and
PR 102 (a base64 text blob is decoded before the response scrubber; before it, every file arrived as
masked lines). GitLab browsing is guarded with fixtures; no GitLab account is saved on the lab yet.
Extends ADR0040 and ADR0044.

Roger asked for "git integration and navigation". ADR0040 built the integration: promotion into
one repository the person typed by name. He pointed out that a DevOps admin works across many
repositories, and that each Kubernetes cluster usually has its own.

## Decision

**Git explorer page.** Under the person's own GitHub connection, it lists every repository they
can reach, including collaborator and organisation repositories, with a filter. For one
repository it shows:

- branches, with protection;
- open pull requests;
- recent workflow runs, with their result;
- the file tree on the default branch, where a file opens read-only (text up to 256 KiB).

Nested paths go through tree and blob SHAs, so no path argument can traverse. Every read is a
confirmed connector action, and the page writes nothing to GitHub.

**Cluster repository links.** From an open repository, the person links a recorded cluster to it
with a base branch, a folder and an optional workflow. There is one link per cluster per person,
at most 64, in their own scope.

**Promotion uses the links.** The "Promote through Git" panel offers the linked repositories.
For a response plan it preselects the repository linked to the plan's cluster, so a change for
prod-east goes to prod-east's GitOps repository.

## Not claimed

- GitLab browsing; the explorer is GitHub only.
- Writing from the explorer. Writes stay in promotion, with its reservation and confirmations.
