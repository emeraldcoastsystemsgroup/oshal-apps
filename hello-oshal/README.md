# hello-oshal — the minimal working example

The smallest real OSHAL app package: one self-contained route + one themed ribbon surface. Use it to
prove the install loop, and copy it as the starting point for a new extension.

```
node scripts/oshal-app.js install hello-oshal
# → deployed-apps/hello-oshal/ ; the loader mounts /api/hello-oshal
# GET /api/hello-oshal/ping  → {"ok":true,"app":"hello-oshal",...}
```

Files:
- `oshal-app.yaml` — the definition file (name, one `ui.static` tile, one `route`).
- `routes/hello.js` — the compiled-JS route (self-contained; no framework imports).
- `tests/hello.test.js` — real loopback HTTP tests; run `node --test hello-oshal/tests/hello.test.js` from the store root.
- `tests/test-lab.yaml` — versioned AI Test Lab registration for package readiness and the HTTP suite.

Version 1.2.0 requires the core `test-catalog` capability. Installation registers the suite;
the Test Lab reports the Node runner as pending until an approved runner is available. It does
not treat registration as a passing test. The existing service-authenticated smoke remains the
installation readiness probe. Install this release after a core with that capability is available.

See [../BUILDING-EXTENSIONS.md](../BUILDING-EXTENSIONS.md) for the full authoring guide.
