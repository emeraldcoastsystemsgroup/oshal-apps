# ADR0042: AWS reads under the person's own key

Status: implemented in source, 22 October 2026. Kernel signer and curated catalog on
`dev/native-parity`; package path guarded with fixtures. Live acceptance needs an administrator to
select the AWS STS and EKS services and a person to connect their own AWS key, which only the
key's owner can do. Extends ADR0039.

Roger asked to run AWS, Google Cloud and Azure commands from the application under his own
authorization. Until now the command helper coached the command and recorded what the person
pasted back from their terminal.

## Decision

The kernel gains AWS Signature Version 4 as a connector authentication type, `awsSigV4`:

- **The person's own key.** The connection holds `accessKeyId`, `secretAccessKey` and an optional
  `sessionToken`, saved by the person like any personal connection. It is never an installation
  key.
- **Signed per request.** The kernel signs the exact host, path, query and body it sends. Region
  and service come from the operator-selected regional endpoint
  (`https://{service}.{region}.amazonaws.com`); any other endpoint is refused at registration. The
  signer matches the published AWS "get-vanilla" test vector.
- **Never raw.** An AWS-signed connector names no API host, so package egress can never place
  the key on a request.
- **Curated reads.** The imported STS and EKS catalog entries could not execute: they used
  fragment paths and a raw Authorization header. They are replaced by five reads: caller
  identity; list clusters; describe one cluster; list a cluster's node groups; describe one node
  group. Each is a GET, admits exact arguments and cannot traverse paths.

In the command helper, when the analyst proposes one of those commands, "Run through your AWS
connection" runs it with a fresh confirmation. The page first checks two things:

- the administrator selected that service;
- the command's `--region`, if any, matches the region the selected endpoint reads.

Any other flag, or any other command, stays in the person's own terminal. The record says
`aws-connection`, with the account and region, and the provenance "native AWS-signed read".

## Not claimed

- AWS writes, and services beyond STS and EKS. Adding a read is a curated catalog entry.
- Google Cloud and Azure execution. Google Cloud's catalog is OAuth and can follow the same
  path once an administrator registers the OAuth client. Azure needs a Resource Manager connector.
- Running the person's own CLI. The OSHAL Node sandbox has no network or host profiles by
  design.
