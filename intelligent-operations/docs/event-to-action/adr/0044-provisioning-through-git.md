# ADR0044: Provisioning through Git

Status: implemented in source, 22 October 2026. Guarded with fixtures. A real Kubernetes API
server accepted the rendered manifests in a server-side dry run
(`deploy/evidence/provisioning-dry-run.json`). Live promotion accepted 23 October 2026
(`deploy/evidence/git-live.json`): the installed app committed a rendered team namespace (5 manifests)
to a branch of the demo repository through the operator's own GitHub connection, opened
[pull request #1](https://github.com/emeraldcoastsystemsgroup/triagenorth-provisioning-demo/pull/1) and
dispatched `validate.yml`. GitHub did not start that pipeline: the account's Actions spending limit or
payment blocks private-repository runs. The same five files pass the workflow's parse check locally and
the lab API server accepted them (namespace server-side dry run, the rest strict client validation).
Extends ADR0040.

Roger listed provisioning among the things the application must do. Upper-level changes go
through Git so a pipeline applies them, which is also the safe way to provision.

## Decision

A Provisioning page offers templates. The server renders each one from closed, strictly
validated parameters into exact manifests with SHA-256 digests. The same parameters always
render the same bytes.

**Templates:**

- **Team namespace.** A Namespace with team and Pod Security labels (enforce baseline, warn
  restricted), a ResourceQuota, a LimitRange with container defaults, a default-deny ingress
  NetworkPolicy that still allows traffic within the namespace, and a RoleBinding of the built-in
  `edit` role to the team's editors group.
- **App deployment.** A Deployment that runs as non-root with the RuntimeDefault seccomp profile.
  It drops all capabilities, keeps a read-only root filesystem and allows no privilege
  escalation. It does not mount a service-account token, and it has readiness and liveness
  probes and resource requests and limits. A Service fronts it. The image must be pinned by tag
  or digest, never `:latest`.

**Validation.** Names are DNS labels. Quantities match the Kubernetes quantity form. Groups and
paths use fixed character sets. Every value is quoted into the YAML after validation, so a
parameter cannot add fields or documents.

**Flow.** The person reviews the rendered bytes and copies a `kubectl apply --dry-run=server`
command for their own terminal. They then promote the request through the existing Git relay
under their own GitHub or GitLab connection, with a fresh confirmation for each write. The
promotion's `provisioning` kind commits exactly the stored bytes plus a `manifest.json` to
`triagenorth-provision-<id>`. It opens a pull or merge request whose text says nothing was
applied, and it can optionally start the pipeline. One request is kept per template and
parameters, and a person may hold at most 64.

## Not claimed

- Cloud infrastructure such as Terraform for EKS, GKE or AKS. Adding one is a new template.
- Applying anything from the application; the person's pipeline applies a merged request.
