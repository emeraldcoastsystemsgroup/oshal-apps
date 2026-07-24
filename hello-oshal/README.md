# hello-oshal — the minimal working example

The smallest real OSHAL app package: one self-contained route + one ribbon tile. Use it to
prove the install loop, and copy it as the starting point for a new extension.

```
node scripts/oshal-app.js install hello-oshal
# → deployed-apps/hello-oshal/ ; the loader mounts /api/hello-oshal
# GET /api/hello-oshal/ping  → {"ok":true,"app":"hello-oshal",...}
```

Files:
- `oshal-app.yaml` — the definition file (name, one `ui.static` tile, one `route`).
- `routes/hello.js` — the compiled-JS route (self-contained; no framework imports).

See [../BUILDING-EXTENSIONS.md](../BUILDING-EXTENSIONS.md) for the full authoring guide.
