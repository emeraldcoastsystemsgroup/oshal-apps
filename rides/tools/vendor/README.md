# Vendored third-party assets

Not our code. Copied verbatim from the published npm tarball, unmodified, licence file included.

| what | version | licence | source |
|---|---|---|---|
| `leaflet/` | 1.9.4 | BSD-2-Clause (`leaflet/LICENSE`) | `https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz` → `package/dist/` |

## Why vendored and not a CDN tag

The rides surface is a cockpit iframe served by the OSHAL api, and three things make a
`<script src="https://unpkg.com/…">` the wrong call there:

1. **`OSHAL_STRICT_CSP`.** When the operator turns strict CSP on, `script-src` is `'self'` plus a
   nonce — an external host is refused and the map silently never initialises.
2. **Air-gapped and on-prem installs.** The deployment models this platform targets include boxes
   with no route to unpkg. A map that needs a CDN to draw its own controls is a map that is absent
   exactly where the install is hardest to debug.
3. **Supply chain.** A CDN tag is an unpinned live dependency executing in an authenticated session.
   The pinned bytes here change only when someone commits a change to them.

The `career-hunter/engine/jobhunter/templates/map.html` Flask page does use unpkg tags. That is a
separate standalone app on its own port, not a cockpit surface, and it is not the pattern to copy.

## Refreshing

```bash
curl -sSL -o leaflet.tgz https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz
tar -xzf leaflet.tgz
cp package/dist/leaflet.js package/dist/leaflet.css leaflet/
cp package/dist/images/* leaflet/images/
cp package/LICENSE leaflet/LICENSE
```

Bump the version in the table above in the same commit, and re-run `node --test "tests/*.test.js"`
from the package root — the surface suite asserts these files exist and that the surface loads them
from here rather than from a remote host.
