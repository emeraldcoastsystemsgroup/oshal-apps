# ADR0045: Google Cloud and Azure reads under the person's own account

Status: implemented in source, 22 October 2026. The kernel connectors (`gcp` and `azure`,
oshal-kernel PR 82) are on main, and the package path is guarded with fixtures. Live use needs an
operator to register the Google and Azure OAuth clients and select the services; a person then
connects their own account. Extends ADR0039 and ADR0042.

Roger asked for an AWS, Google Cloud and Azure command helper that runs under his own
authorization. ADR0042 covered AWS. This covers the other two in the same way.

## Kernel

- **`gcp`.** Reads GKE clusters in a project, one cluster, and its node pools at
  `container.googleapis.com`. It uses the existing `gcp` OAuth registration with the
  `cloud-platform.read-only` scope.
- **`azure`.** Reads subscriptions, AKS clusters in a subscription, one cluster, and its agent
  pools at `management.azure.com`, with fixed API versions. It uses a new `azure` registration
  with Resource Manager `user_impersonation`, under `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`
  or the shared Microsoft client.

Every operation is a GET with exact path arguments, and nothing writes.

## Package

The command helper maps only these coached commands onto the person's connection. Any other
flag, and any other command, stays in the person's own terminal.

- **Google Cloud** (`--project` is required):
  - `gcloud container clusters list --project P`
  - `gcloud container clusters describe NAME --location|--zone|--region L --project P`
  - `gcloud container node-pools list --cluster C --location L --project P`
- **Azure** (`--subscription` must be a GUID):
  - `az account list`
  - `az aks list --subscription S`
  - `az aks show -n N -g G --subscription S`
  - `az aks nodepool list --cluster-name N -g G --subscription S`

"Run through your Google Cloud connection" and "Run through your Azure connection" each send
one read with a fresh confirmation. The result is recorded as `gcp-connection` or
`azure-connection`, with its own provenance.

## Not claimed

Writes, other services, and SSH to hosts. Adding a read is a curated connector entry and a
mapping line.
