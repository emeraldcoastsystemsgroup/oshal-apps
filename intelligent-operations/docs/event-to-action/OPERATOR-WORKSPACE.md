# Daily operator workspace

The four daily screens use the same heading, refresh status, compact controls and selected-record panels. Counts describe the returned page, not the whole installation. A saved observation retains its capture time; it is not a new health probe.

## Operations

Start with **Needs attention** for quarantined events and processing retry/attention states. Recent events open their decision trail. **Source activity** shows the last receipt visible in the loaded event page. **Incident work** opens canonical Operations tickets; accepting a report does not prove service recovery.

## Systems

Filter by system, namespace, resource type, captured health or name. Desktop filters fit one compact row in the embedded workspace; narrower screens wrap them. Searching retains the observed cluster name even when the cluster itself is excluded from the results. Expand the tree with the mouse or arrow keys. Select a resource to see its original identity, observation, relationships and related alerts. A selected pod retains the existing current-status, bounded log and reviewed command controls. Commands use the signed-in Kubernetes connection and its target scope. The shorter command field does not change execution authority.

Selecting a node shows its capacity against allocatable, pressure conditions and cordon state, roles, taints, addresses, kubelet/OS/runtime versions and the pods placed on it, each a link to that pod (ADR0039).

## Command helper

Coach one reviewable kubectl, AWS, Google Cloud, Azure or in-pod command from a goal, review its
risk and verification, run an in-pod command through your own Kubernetes connection, or copy a
cloud command to run under your own signed-in CLI and record the result (ADR0039).

## Data pipeline

- **Flow:** the evaluated cohort, stored-query matches, surviving symptoms and saved correlation; then packet-linked investigation and report progress. Expand **Evidence work** to open the existing investigation controls. Read the cohort limits before comparing counts.
- **Events:** search by alert, native resource or event ID; filter by source revision and validation result. Inspect an event for its validation, filtering, reduction and processing trail. Original payloads and complete records are under a disclosure. Select events here for an explicit evaluation or rule trial; selection survives filter changes.
- **Rules:** choose the exact source revision, edit and trial a draft, then explicitly publish and activate it. Changing tabs does not publish anything. Saved generations remain available.
- **Automation:** configure the existing personal processing schedule, source allow-list and optional retained-evidence capture. Saving settings, activating a schedule and running it remain distinct actions.
- **Correlation:** inspect saved dependency groups or correlate selected events using the graph's selected time and collection.

## Sources

Search names, environments or URIs. Selecting a revision shows its envelope source, immutable revision, latest loaded receipt, quarantine count and the seven adapter field mappings. **Inspect source events** and **Configure rules** carry that exact revision into the next screen. **Add source** opens registration. **Record test event** opens the existing import form with the selected revision; it does not submit an event.

A saved format alone is not a working producer connection. Live context owns telemetry retention; Connections owns account and service standing. Source revisions remain immutable.

## Navigation and access

Cross-screen links use the native manifest tool navigation when embedded, keeping the cockpit rail aligned with the content. Standalone pages use the same local route with source/event parameters. Pipeline tabs support left/right arrows, Home and End. At phone widths, split panels stack and controls wrap.

Records, source details, event trails and incident rows clear when current access is refused. Late ticket replies cannot restore the old view. Browsing these screens performs reads; existing explicit action controls retain their original authorization checks.

## Files and ticket workspaces

The **Files** navigation entry opens the core personal file browser under your signed-in account. For files a workflow generated, open its ticket and select **Work Artifacts**. The core ticket explorer groups accepted files by producing run and folder, with search, refresh, expand/collapse, producing bot/step, file details and downloads. The configured editor remains available there.

**Download** saves a file to your computer. Enable your browser's “ask where to save” setting to choose a destination each time. **My files** opens application-saved personal files; it does not automatically copy ticket artifacts into that store. Folder browsing reuses the core accepted-work inventory and download permissions.
