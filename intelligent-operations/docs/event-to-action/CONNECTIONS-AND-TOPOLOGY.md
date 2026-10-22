# Connections, CLI sessions and topology

This is the target service contract behind the separate UX prototype. The prototype makes no login,
CLI, discovery or infrastructure calls. Real native broker, runner and provider acceptance remain required.

## The user journey

A connection administrator selects a named connection and the intended runner, chooses interactive
operator use or unattended discovery, and follows the provider's secure authorization flow through
OSHAL. The app displays the resulting principal and exact account, tenant/subscription, project,
cluster incarnation or host identity before permitting collection. Authentication, inventory reads,
evidence reads and writes have independent scope, test result and test time. A generic “Connected”
label must not imply all four passed.

| Connection | Operator identity | Background identity and required binding |
|---|---|---|
| AWS | Named IAM Identity Center profile and provider sign-in | Scoped assumed role with temporary credentials; bind account, role and region. |
| Azure | Provider sign-in and explicit tenant/subscription selection | Approved managed or federated workload identity; bind tenant, subscription and role. |
| Google Cloud | Named CLI configuration and explicit principal/project | Workload identity federation or approved impersonation; verify the actual CLI/SDK credential chain. |
| Kubernetes | Authorized kubeconfig reference and explicit context | Short-lived scoped service identity; verify API server, cluster UID, namespace and RBAC. |
| Data center hosts | Managed SSH credential reference and verified host fingerprint | Brokered short-lived identity, exact target and allowed commands; retain host-key verification. |
| Splunk | Managed secure connection reference | Scoped API credential and bounded index/search access; a CLI login is not required for this adapter. |

Google CLI credentials and Application Default Credentials are distinct. A successful login in a
terminal does not prove the SDK collector uses the same identity. Likewise, an AWS login does not
establish the account/role of an arbitrary later command. Always probe using the same runner,
credential reference/version, configuration and explicit target that the actual operation will use.

Before collection, verify tool/adapter availability and supported version on the selected runner.
A missing tool, expired delegation, wrong account, wrong cluster incarnation, withdrawn grant or
failed identity check stops new work. Changing the connection, authentication mode or target
invalidates prior probe results. Refresh must preserve the bound identity; it cannot silently fall
back to another profile. Revocation blocks new operations; in-flight behavior must be specified by
collector/action and recorded rather than assumed to undo external effects.

The shared credential service owns secrets, refresh and revocation. The application stores references
and non-secret verification metadata. Do not import a developer's global CLI cache, default context,
SSH directory or browser token into a scanner. Use an isolated runner configuration and pass explicit
profile/context/subscription/project selection. Invocation logs and generated bundles must redact
secret values. Connection ownership does not grant every application user access to that identity.

Provider sign-in is not permission to execute remediation. The proposed observer connection cannot
be upgraded to write by toggling a screen control. Writes require a separately scoped principal,
registered action, exact approved bundle and execution-time rechecks.

## Topology and discovery

The map and correlation engine must read the same temporal inventory/relationship records. Render
site, cloud account/project and cluster grouping; expose environment, layer, source and health
filters. The current prototype uses a scope picker for its single synthetic environment and exposes
network/compute/service and health filters. Inspector source labels are explicit. Multi-environment
selection and source filtering remain implementation work.

Show network attachment, containment, scheduling and service dependency as different edge types.
A placement edge is not a verified network path. Each node and edge needs source, native scoped ID,
observation time and validity; declared/manual relationships remain labeled. Filtering out a node
must not invent a direct relationship between its neighbors. Correlation must bound traversal and
avoid merging an estate through a shared infrastructure hub.

Keep health, inventory presence and freshness independent. Missing telemetry is unknown, stale
observations stay stale, and an expired scanner login cannot turn previously observed assets green.
Historical incident-time views must not silently substitute current placement or new pod instances.
Kubernetes discovery needs watch/reconciliation, periodic full resync and instance UID tracking;
cloud/host scanners need configurable intervals, bounded concurrency, pagination and partial-scan
receipts. Failed or incomplete scans cannot delete assets. A complete authorized scan may reconcile
absence according to retention and lifecycle policy. Evidence should capture disappearing instances
before scale-down where possible.

The UX now includes historical snapshots, selectable nodes, typed relationships, five estate scopes,
filter/empty states and a local discovery-interval draft. It does not run any scanner or claim live
cloud/network health. The local Kubernetes lab remains separate from this prototype.

## Acceptance before activation

- Verify runner/tool identity separately from the browser's OSHAL session.
- Exercise each provider with disposable scope, allowed and denied reads, wrong scope, expiry,
  refresh and revocation. Prove no default credential/context fallback occurs.
- Prove server-side resource grants on connection use and topology traversal; a browser role picker
  is only a fixture, not authorization.
- Test pod replacement/movement, partial scan failure and historical topology preservation.
- Prove no collection principal can mutate infrastructure; exercise write approval separately.

Provider references: [AWS IAM Identity Center CLI setup](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html),
[Azure service principal authentication](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-service-principal),
[Google CLI authentication](https://docs.cloud.google.com/sdk/docs/authenticate), and
[Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials).
