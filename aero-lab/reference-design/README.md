# The Floater — reference design

The worked example this package exists to produce: a **solar dynastat**, a partially buoyant
solar aircraft that closes its 24-hour energy loop and can therefore stay up until the parts wear
out rather than until the battery runs down.

These are engine outputs, not hand-drafted files. `engine/export_build_files.py` generates the
whole set from a design vector, and every mesh here is validated closed and manifold before it is
written.

**Start at [index.html](index.html)** — it links everything below.

---

## What the aircraft is

A 3:1 prolate-spheroid helium hull carrying twin solar wings, a single tractor propeller, and a
lithium-ion pack. Buoyancy carries 80% of the weight (`f = 0.80`); the wing and propeller carry the
rest and do all the steering.

| | As-built, real sourced parts |
|---|---|
| Hull | 2991.4 × 997.1 mm — **117.8 × 39.3 in** — 1.557 m³ |
| Wing | 2.5 m span, 0.52 m², AR 12.0, NACA 2412 |
| All-up mass | **2272.4 g** |
| Cruise | 4.00 m/s, drawing 9.18 W total |
| Solar harvest | 615.9 Wh/day midsummer · 391.6 Wh/day equinox |
| Parts cost | **$518 core** · $581 hydrogen build · $738 helium (party tanks) |

**The energy loop closes — but not on the pack the BOM currently buys.** The 8-cell pack falls
**11.6 Wh short** on a midsummer day. The minimum closing pack is **98.0 Wh**, so ten cells
(2S5P, 100.8 Wh, **+$19.90**) clears it with 2.8 Wh to spare. Twelve cells (121 Wh) closes
comfortably at min SOC 0.164 and is the recommended build. **No pack in this BOM closes the
equinox** — that needs 180.3 Wh and a 128 × 42.7 in hull.

## Files

### Read these
| File | What |
|---|---|
| [FLOATER_REPORT.pdf](FLOATER_REPORT.pdf) | Dated 2026-08-03, 9-page run report — historical engine-status prose is superseded by this README and `../BACKLOG.md` |
| [FLOATER_REPORT.html](FLOATER_REPORT.html) | The same dated run report, browsable |
| [V2_CONFIG.md](V2_CONFIG.md) | The deep technical record — every configuration run, with its numbers |
| [BUILD_SHEET.md](BUILD_SHEET.md) | How to actually build it |
| [viewer.html](viewer.html) | Self-contained 3D viewer — the assembled craft, no network needed |

### Build it
| File | What |
|---|---|
| `wing.stl`, `wing_panel_left/right.stl` | Wing and its two panels |
| `hull.stl`, `vehicle_full.stl` | Envelope, and the 4,176-triangle assembly |
| `ribs.dxf`, `airfoil_template.dxf`, `airfoil.dat` | Rib set, cutting template, section coordinates |
| `hull_gore.dxf`, `hull_gore.svg` | Flat gore pattern for cutting film — 10 gores, 15 mm seam allowance, unroll identity −0.000% |
| `three_view.svg` | Three-view schematic |
| `BOM.csv` | Mass-ledger BOM |
| `BOM_v2.csv` | **Real sourced parts** — manufacturer, model, price, mass, and an honesty note per line |
| `BOM_v2_deltas.csv` | Where real parts differ from the certified ledger |
| `design_snapshot.json` | The full design vector and mass ledger |
| `verify_*.json` | Mesh/DXF/gore validation output |

## What is true, and what is not

**Verified:** every mesh is closed and manifold — 0 open edges, 0 non-manifold edges, 0 degenerate
facets, Euler χ = 2. The gore unroll is identity to −0.000%. The viewer is sha256-checked against
the STLs it embeds. `BOM_v2.csv` carries real manufacturers, part numbers and prices.

**Not true, and important:**

- **Nothing was built.** No hardware, no wind tunnel, no flight. Every number is simulation output.
- **The numbers here come from the *ideal* propulsion chain.** The buoyant trim defect is repaired:
  the current engine converges the f = 0.2/0.4/0.6/0.8 boundary at its unchanged `1e-8` force
  tolerance, and f = 0.8 consumes certified aero. That does **not** re-certify these energy numbers
  on real hardware physics. BEMT plus motor/ESC/harness and `PackEcm.step_power` are now available
  as the explicit integrated real authorities, but this reference output has not been regenerated
  from them. The first certified 72 h DESIGN_A real-chain probe failed persistence (`SOC 1.0000 ->
  0.9307`), so the promotion gate remains red; see [../BACKLOG.md](../BACKLOG.md) §A. These numbers
  stand on the named ideal run that produced them, not on a green real-drive gate.
- **Real parts are 274 g heavier than the certified ledger** — DIY pack 197 Wh/kg against 250
  (+92 g), motor/ESC/prop 120 g against 55.2 (+65 g), and an MPPT the ledger carried as 0 g
  (+57 g). That mass is why the as-built craft needs a bigger hull and a bigger pack.
- **The vent / ballonet is undesigned and unbilled.** A sealed envelope cannot take the diurnal
  superheat cycle at this scale (+25.6 K / +9.1 kPa measured). **Any sealed build is gated on it.**
- **Party helium does not fly.** 80% purity drops `f` 0.800 → 0.703 (measured), gas mass
  253 → 568 g, and the craft closes on no pack. Welding-grade only.
- **No structural analysis.** Nobody has checked whether the spar survives flight loads.

## Related

- [../BACKLOG.md](../BACKLOG.md) — the open engine defects, with done-when criteria
- [../README.md](../README.md) — the package, its surfaces, and how to run the engine
- The **ocean explorer** is a different machine from a different study — wave-driven, not solar —
  and lives in the `ocean-lab` package.
