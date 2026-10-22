# Inventory and correlation structure

Reviewed 20 October 2026 against the archived graph database code and load scripts, following
the operator's direction to use their structure. This document records the implementation basis;
it does not claim that the new graph service is deployed.

## Source evidence

Paths are relative to the reviewed archive's `build/graph` directory. Do not execute archived
loaders or import their deployment settings, credentials or estate identifiers into this install.

| Source | Structure retained |
|---|---|
| `clean_tools/load_sism_topology.py`, `UPSERT_QUERY` and `build_row` | Physical/virtual hosts, service units and groups, datacenters and regions; host/service membership and geographic placement. |
| `clean_tools/load_aws_topology.py`, `UPSERT_*` and `collect_*` | VPCs, subnets, security groups, load balancers, target groups, Internet/NAT/transit gateways, route tables, peering and endpoints; compute placement, target membership and forwarding. |
| `clean_tools/load_k8s_topology.py`, `UPSERT_*` and `collect_*` | Clusters, namespaces, nodes, workloads, pods, services and ingress; workload ownership, node/host placement and routing derived from actual selectors. |
| `src/libs/models/nodes.py` and `edges.py` | Separate typed nodes and relationships, source identifiers and observation/full-stream metadata. |
| `src/backend_stream/services/ccir_full/epoch_manager.py` and `offset_managers.py` | Durable collection generations and resumable source offsets; generation completion is distinct from processing one batch. |
| `docs/relationships.md` | Explicit evidence that relationship meaning and stored direction can disagree; relationship direction needs a reviewed policy. |

The clean loader queries are parameterized Cypher using the Neo4j Python driver; the Kubernetes
loader explicitly accommodates Memgraph syntax. The adjacent design document's database name
alone is not evidence of which engine or version was deployed. Engine selection and installation
must follow verified runtime requirements, including local hardware support.

## Common asset model

Retain the above entity families with application-neutral names:

- Infrastructure: site, datacenter, region, availability zone, physical host and virtual machine.
- Service ownership: business service, service group and service unit.
- Cloud network: account/project/subscription, virtual network, subnet, security group, route
  table, load balancer, target group, gateway, peering and endpoint.
- Containers: cluster, namespace, node, workload, replica set, job, pod, container, service and ingress.
- Observation links: alert occurrence affects an exact asset; evidence records what was observed
  on that asset. Occurrences and evidence retain their canonical relational records.

An asset identity includes the authorized owner/tenant scope, provider, provider account or cluster
UID, resource kind and native resource ID. Keep source-specific IDs and aliases as provenance;
never equate assets solely because their names or IP addresses match. Kubernetes UIDs distinguish
replacement pods and workloads. Container runtime IDs distinguish replacement containers.
Names remain display properties. The original collector is recorded on each observation and edge.

Each observation includes scan ID, source/mapping revision, observed time, validity interval,
collection completeness and provenance. Readiness, health, inventory freshness and authorization
are separate states. Unknown health must not be converted into healthy or failed.

## Relationships and direction

| Relationship | Direction and use |
|---|---|
| `IN_REGION`, `IN_DATACENTER`, `IN_VPC`, `IN_SUBNET`, `IN_CLUSTER`, `IN_NAMESPACE` | Asset → containing location or scope. Useful for display; shared containment alone does not establish common failure. |
| `OWNED_BY` | Pod → replica set/job/workload through native owner references; follow the actual chain, retaining intermediate objects. |
| `RUNS_ON` | Container → pod → node → compute host where provider identity proves the link. |
| `ROUTES_TO`, `FORWARDS_TO` | Ingress → service → backend pod; load balancer → target group → registered target. Preserve ports, protocols and observed target availability where supplied. |
| `REGISTERED_IN`, `IN_SECURITY_GROUP` | Resource → target group or security policy. Membership is not itself a service dependency. |
| `ATTACHED_TO`, `ASSOCIATED_WITH`, `HAS_ATTACHMENT`, peering roles | Explicit network attachment with endpoint roles retained; do not flatten asymmetric connections into generic undirected links. |
| Service membership | Host/workload → owning service unit/group. Give membership its own type instead of treating every historical `LINKED_TO` as causal dependency. |
| `DEPENDS_ON` | Only an explicitly evidenced service dependency. Correlation policies may traverse it in a specified direction and time interval. |

Preserve original relation types and direction in import provenance. A versioned mapping translates
source vocabulary to the common vocabulary. Unmapped or ambiguous relations are inspectable,
not silently reversed. One temporal graph supplies both topology display and correlation.

## Load and reconciliation rules

The scripts provide collection stages, batching and graph upserts. Change these specific behaviors:

1. The Kubernetes loader keys pods by cluster/namespace/name and guesses some owner names by
   removing suffixes. Use metadata UIDs and owner-reference UIDs, including ReplicaSets and Jobs.
2. Several collection exceptions become empty lists. Preserve per-resource scan failure and
   partial status. Only a completed, authorized scan of the same source/scope/kind may retire
   missing observations; a denied page or failed resource request cannot delete inventory.
3. The optional reset deletes a loader's relationships before rebuilding them. Stage a generation,
   commit it atomically, and close previous validity intervals only after successful completion.
4. `stamp_updated_at` updates every node and edge from a bootstrap source. Stamp only records
   actually observed in this generation. An old unobserved record retains its old freshness.
5. Some generated region/host identities lack complete account scope. Key account, region and
   native resource identity explicitly, preventing cross-account and cross-cluster collisions.
6. The relationship review documents reversed/ambiguous meanings. Use an explicit direction
   policy with fixtures; do not allow a shared datacenter or network hub to merge all incidents.
7. Preserve failed batches and stable compound cursors. Record collection, reconciliation and
   correlation outcomes separately; every claimed completed scan must have a durable receipt.

## Implementation and acceptance

P3/M3 discovery and P4/M4 correlation use this source-derived structure. Start with actual local
Kubernetes collection, then add cloud provider adapters through standard caller-bound connections.
Use the existing native scheduler's per-principal activations and scoped SQL/connector rails where
supported; do not add an application-private user or credential service.

Required tests include pod replacement with the same name, real owner chains, namespace selector
matching, autoscaling, node movement, provider/account collisions, partial scans, restart midway
through a generation, late observations, stale edges, direction changes, cycles, shared hubs and
traversal budgets. Record the event-time topology revision used for every correlation decision.
The existing manual pod snapshot view is an earlier increment and does not satisfy these tests.
