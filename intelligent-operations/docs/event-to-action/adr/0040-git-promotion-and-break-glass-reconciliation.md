# ADR0040: Git promotion and break-glass reconciliation

Status: implemented in source, 22 October 2026. Package guards pass; the kernel catalog operations
are on `dev/native-parity` as 0f86a3c with their own guard. Live acceptance needs an installation
that ships that catalog, the GitHub or GitLab service selected by an operator and the person's own
connected account. Extends ADR0025, ADR0031 and ADR0037.

Roger asked for two levels of change: an upper level where changes go to Git and a pipeline
applies them, and a lower level where an emergency patch is pushed directly (break-glass). Both
now start from the same response plan (ADR0037), so the bytes that are reviewed, executed and
committed are identical.

**Standard path (upper level).** From a plan, "Commit, open request" reserves one promotion per
plan and destination, then the browser, under the person's own GitHub or GitLab connection with a
fresh confirmation per write, reads the base branch, commits the plan's exact generated files plus
a manifest (plan, ticket and revision, work record, answer digest, target, artifact digests) to a
new branch `triagenorth-<plan>`, opens a pull or merge request whose body states that nothing was
executed on the cluster, and optionally starts the pipeline on that branch (GitHub workflow
dispatch or a GitLab pipeline). Merge and pipeline status are read back on request.

**Break-glass path (lower level).** The emergency change itself is the existing approved exec
(ADR0037). After it has a reported outcome, "Reconcile break-glass change in Git" commits the same
files with the execution receipt to `triagenorth-reconcile-<plan>` and opens a request that must
be merged, or reverted in Git, within 24 hours of the execution; the deadline is recorded and an
unmerged reconciliation past it is shown overdue. A reconciliation cannot be reserved before an
execution exists.

**Authority and evidence.** The server holds the file bytes and builds the manifest, commit
message and request text; the browser only relays them through the kernel's connector actions,
which fix the provider origin, admit exact variables and require confirmation for every write
(kernel 0f86a3c). One reservation per plan, path and destination is written before the first
provider write; a retry is refused rather than creating a second branch, and a failure mid-way is
held as uncertain. Provider results (commit, request number and link, pipeline status, merged) are
the operator session's report (`verifiedByServer: false`); links are accepted only on github.com or
gitlab.com.

**Swarm-to-swarm.** When a lower swarm owns the monitored environment, the same manifest and files
are the natural delegation payload; routing them over Jarvis between installations needs the
kernel A2A rail listed in KERNEL-RAILS-NEEDED.md and is not claimed here.
