# ADR0054: Cloud cluster inventory

Status: implemented in source, 23 October 2026. Guarded with recorded provider answers
(`tests/cloud-inventory.test.cjs`). Live acceptance needs the operator's own AWS key and Google
Cloud and Azure sign-ins. Closes the managed-Kubernetes part of R16.

## Context

R16 asks for AWS, Azure and Google Cloud inventory with real, scoped scanners, standard identifiers
and measured or unknown health. Until now the cloud part of the topology was a synthetic prototype.
The kernel already declares read operations for each provider's managed Kubernetes: EKS clusters and
node groups, GKE clusters and node pools, and AKS clusters and agent pools. A DevOps engineer's first
question about a cloud estate is which clusters exist, where they run, how big they are and whether
they are healthy.

## Decision

Systems gains a **Cloud clusters** panel.

- It reads each provider through the person's own connection: an AWS key for the EKS service, and a
  Google Cloud or Azure sign-in. Every read carries a fresh confirmation, and the panel only reads.
- Google Cloud reads need the project ID. Azure reads every subscription the account lists, or the
  one subscription named.
- AWS reads the region the administrator's EKS service endpoint serves. The panel shows that region.

Each provider's answer becomes one bounded inventory scan with the cloud's own identifiers:

| Asset | Identifier |
|---|---|
| Cluster | ARN, self link or resource ID |
| Node pool (`node-pool`, a new inventory kind) | the cluster's identifier plus the pool name |
| Region | the region name |

Edges: a node pool is `IN_CLUSTER` its cluster, and a cluster is `IN_REGION`.

Properties: Kubernetes version, status, node count, and each pool's machine type, size and
autoscaling range.

Health comes from the provider's own status:

- running or active is healthy;
- a named failure or degraded state is degraded;
- anything else is unknown.

A failed read of one cluster is recorded as a collection failure, and the scan is partial, not empty.

The console's "largest cluster" now ranks every recorded cluster by node count across Kubernetes,
EKS, GKE and AKS. Live kubectl reads still go to the one cluster the Kubernetes connection reaches,
and the console says which one that is.

For Azure, the same read also records each subscription's virtual machines (size, OS, provisioning
state) and virtual networks with their subnets (address space and prefixes), as `virtual-machine`,
`network` and `subnet` assets. Edges: a subnet is `IN_VPC` its network; machines and networks are
`IN_REGION`. Kernel PR 104 added those two reads. The list answer carries no power state, so a
machine's health is unknown unless provisioning reports a failure.

## Not in this decision

- **AWS EC2 instances and VPCs.** EC2 answers in XML, which the kernel's connector transport does not
  parse.
- **Google Compute Engine instances and networks.** They are served from a different host than the
  Google connector's.
- **Load balancers and data-center hosts.** The topology kinds exist (`load-balancer`, `host`), but
  no read is declared for them.
- **Scheduled cloud discovery.** This is a person's read. The Kubernetes schedule (ADR0049) is the
  model for doing it unattended.
- **Several EKS regions per AWS key.** The kernel's EKS service is bound to one regional endpoint.
