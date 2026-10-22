# ADR0022: 3D exploration over the authorized temporal graph

Status: source/browser tested and native24d62980 accepted; see deploy/evidence/operating-experience.json.
Date: 21 October 2026.

The product needs a usable 3D graph with predefined operational questions. Render the existing current-user, selected-time graph in a CPU canvas with deterministic XYZ layout, perspective depth, orbit, pan, zoom, directed edges and node selection. There is no continuous animation, external CDN or new data authority. Keep the existing 2D typed-column view and equivalent keyboard-accessible node list.

Presets: observed estate; outgoing dependency/routing paths; incoming dependents (potential impact); bidirectional placement/ownership; explicitly degraded observations; observations older than 15 minutes relative to the graph's selected time. Dependency traversal is at most four hops and 500 visited identities; placement is two hops. Display is at most 100 nodes and 500 edges, with truncation visible. Unresolved targets are not fabricated as resolved nodes. Unknown health is distinct from healthy; historical observations do not become live probes.

Existing topology GET admission and database owner isolation remain authoritative. The browser runs predefined traversals over that already bounded response; these are snapshot presets, not arbitrary server-side database queries. Refusal, refresh and access withdrawal dispose observers and remove private pixels and node lists. No inference, cluster access or infrastructure mutation is authorized by exploring a graph.

Proof: graph-space.test.cjs covers known directed graph answers, cycles, stale time, unknown health, invalid identities, bounds, deterministic depth and real shipped desktop/phone interaction. Existing SQL/temporal graph and Systems tests continue to exercise ownership and late-response clearing. Native acceptance is recorded independently in deployment evidence.
