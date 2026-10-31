# Spider-18 power and electrical spec — solved on the engine (2026-10-30)

**What this is.** The electrical and power numbers for the six-legged robot of ADR-202 (core
`docs/research/spider-18-design-brief.md`, §1.3 "Loads and power"), solved by ngspice in this
package's engine container instead of estimated. The brief's figures were estimates; where a number
below differs, the solved number supersedes it. Every number is labelled **measured on the engine**
(the solver's own reading from the run named), **estimated** (arithmetic on solved numbers, or a class
figure that went INTO the model), or **the brief's**.

**The circuit.** The starter example `hexapod-power` (`src-routes/examples.ts`, 38 parts, 79 wires,
`tests/hexapod-power.test.js` validates it against the contract and the breadboard). It models:

| Part of the robot | Modelled as | Numbers (and what they are) |
|---|---|---|
| 3S 2200 mAh LiPo | `battery` B1 with an internal resistance | 11.1 V nominal (the brief's; 12.6 V full and 9.9 V cutoff are two more solves), 45 mΩ (**estimated**: three 2200 mAh 25C-class cells at 12–15 mΩ each plus leads, not measured), 2200 mAh (the brief's) |
| bus servo adapter and the daisy-chained bus leads | `resistor` RBUS 20 mΩ, in series with the servo bus | **estimated** allowance |
| 18 × Feetech STS3215 12 V bus servo | this lab's `servo` part — a position loop on a geared DC motor; the pulse width stands in for the serial position command | catalog row `servo-bus-sts3215-12v`, which READS embodied's `sts3215-12v` row for identity, mass, price, 30 kg·cm stall and 0.222 s/60° and adds this lab's electrical block: 12 V, **2.7 A stall and 0.18 A no-load from the Feetech page** (https://www.feetechrc.com/525603.html), 0.05 A idle (**estimated**, not published), 70 000 g·cm² reflected rotor inertia (**estimated**: a 0.6 g·cm² cored rotor behind 1:345). The solver derives R = 12 / 2.7 = 4.44 Ω, Kt = 2.942 / 2.7 = 1.09 N·m/A, Ke = 2.38 V·s/rad |
| the tripod stance | `load` on the femur and tibia of L1, R2, L3 | 850 mN·m each (the brief's worst static femur moment; "tibia similar"); the twelve other servos hold their target with no load |
| the stall | R1_femur commanded a 360° step by a `sequencer` from 1.0 to 1.5 s while a `load` of 10 N·m coulomb friction (a jammed foot) sits on its shaft | the command is the stand-in for a controller still driving a caught leg; the friction value only has to exceed the servo's torque |
| 5 V 5 A buck (Pololu D36V50F5 class) | `regulator` REG1, 5 V out, 1 V dropout, 5 A max | the lab's regulator is behavioural: its output is an ideal source, its input carries only 5 mA quiescent — so what the pack sees of the buck is a separate stand-in: `resistor` RBUCK_IDLE 24.64 Ω (4.5 W / 0.9 at 11.1 V) and RBUCK_BUSY 12.32 Ω switched in at 0.5 s (9 W / 0.9). **Estimated** 90 % efficiency; a resistor, not a constant-power load |
| Raspberry Pi 5 | `resistor` RPI_IDLE 8.333 Ω (3 W at 5 V) and RPI_BUSY 2.778 Ω (9 W more) behind a `switch` closing at 0.5 s | the brief's 3 W idle / 12 W busy |
| LD19 LiDAR | `resistor` RLIDAR 16.67 Ω (0.3 A at 5 V) | the brief's |
| BNO055 IMU | omitted | negligible (a few mA at 3.3 V from the Pi) |

Transient 0–2 s, 0.5 ms output step: 0–0.5 s stance with the Pi idle, 0.5 s the Pi goes busy,
1.0–1.5 s the stall, 1.5–2 s back to the stance.

## The command

```sh
cd circuit-lab
docker start oshal-circuit-lab-engine        # or: sh engine/install-engine.sh (builds, starts, self-tests it)
node --test tests/hexapod-power.test.js      # finds the running container; or set CIRCUIT_LAB_ENGINE_ADDR=<host>:7413
```

The case "SOLVED on the real engine" solves the example three times (11.1, 12.6, 9.9 V) through the
real engine client (the engine's build hash is verified first, as the api does) and prints the numbers
below as TAP diagnostics (`# 11.1 V: …`). Run on 2026-10-30 against image `oshal-circuit-lab-engine:local`
(engine build `2418e9a86ecf…`, ngspice 39): 9 of 9 cases pass, no solver warnings, about 1.2 s of
engine time per solve. The windows: stance = 0.3–0.5 s, Pi busy = 0.7–1.0 s, stall = 1.05–1.5 s.

## The numbers (pack at 11.1 V nominal unless said)

| Quantity | Value | Label |
|---|---|---|
| Servo bus current, tripod stance (six servos holding 0.85 N·m, twelve idle) | **5.62 A** (mean of `i(RBUS)` over the stance window) | measured on the engine |
| … per loaded servo / per idle servo | 0.830 A / 0.052 A | measured on the engine |
| Pack current in the stance, Pi idle | 6.06 A (bus 5.62 A + the buck stand-in 0.45 A) | measured on the engine (the stand-in is estimated) |
| Pack terminal voltage in the stance | 10.83 V, a sag of 0.27 V from 11.1 V (= 6.06 A × 45 mΩ); the servo bus sits at 10.71 V after the leads | measured on the engine |
| Pack current with the Pi busy (12 W) | 6.93 A at 10.79 V | measured on the engine (the stand-in is estimated) |
| The 5 V rail under the Pi's busy step | **holds 5.000 V** (minimum over 0.6–2 s); the regulator carries 2.70 A (2.4 A Pi + 0.3 A LiDAR), under its 5 A, not in dropout | measured on the engine |
| Stall: the jammed servo's current | **2.35 A** mean over the 0.5 s, peak 2.35 A (= the sagged 10.47 V bus over 4.44 Ω) | measured on the engine |
| Stall: bus current | 8.06 A mean, **8.87 A** peak (the stall on top of the stance) | measured on the engine |
| Stall: pack current | 9.36 A mean, 10.17 A peak; the run's absolute peak 10.83 A is the first millisecond of the step | measured on the engine |
| Pack terminal voltage in the stall | **10.64 V** minimum, a sag of 0.46 V; the bus dips to 10.47 V | measured on the engine |
| After the stall | the jammed servo keeps pushing against the jam at 0.73 A (it crept 3.7° during the step and cannot bring the shaft back); the pack sits at 7.59 A | measured on the engine |
| Stance at a full pack (12.6 V) | bus 5.62 A, pack 6.13 A at 12.32 V; stall peak 2.67 A, pack minimum 12.11 V; rail 5.000 V | measured on the engine |
| Stance at the cutoff (9.9 V) | bus 5.61 A, pack 6.01 A at 9.63 V; stall peak 2.09 A, pack minimum 9.47 V; the 5 V rail still holds (9.47 − 1 V dropout > 5 V) | measured on the engine |
| Runtime at the stance draw from 2200 mAh | **21.8 min** with the Pi idle (2.2 Ah / 6.06 A), 19.0 min with the Pi busy (2.2 Ah / 6.93 A); the servo bus alone would be 23.5 min | estimated (see the assumption) |
| Runtime the solver reports for the run as a whole | 17.5 min (2.2 Ah / the run's 7.55 A average, which includes the stall and the busy Pi) | measured on the engine |

**The runtime assumption.** The whole 2200 mAh is taken as usable from 12.6 V down to the 9.9 V cutoff
at a constant draw equal to the solved stance current; no Peukert loss, no voltage curve (the pack is an
ideal source behind 45 mΩ at one voltage per solve), and the buck stand-in sized at the nominal voltage.
Against the brief's "about 20–30 minutes of walking": the static stance alone already costs 19–22 min,
because a proportional servo loop holds torque with current (0.85 N·m / 1.09 N·m per A = 0.78 A per
loaded servo before its 0.05 A idle). Walking, which adds motion to the holding, will be shorter than
that — **estimated**, and not something this solve can measure.

**Two readings worth knowing.** The loaded servos settle 3.4° below their target (the loop holds
0.85 N·m at about a third of full drive) and the solver reports them `tracking`, not `stalled`; the stance
current is set by the torque, not the pack voltage (5.61–5.62 A across 9.9–12.6 V), while the stall
current scales with the bus voltage (2.09 / 2.35 / 2.67 A at 9.9 / 11.1 / 12.6 V — the rated 2.7 A only
at a full pack).

## What the solve could not tell

- **Dynamic walking draw.** The loads are constant torques and the targets are fixed; nothing swings
  a leg. The gait's current (acceleration, the swing legs' slewing at up to 270°/s, the stance legs
  trading load) is for the plant lane's simulation to supply as a torque-and-speed profile; this
  example can then be re-run with `load` torques that follow it, but it was not run that way here.
- **The buck's real input current.** The lab's regulator draws nothing from its input, so the pack-side
  Pi current is the resistor stand-in (constant resistance at the nominal voltage, 90 % efficiency
  assumed). A real buck is a constant-power load, so its current rises as the pack falls where the
  stand-in's falls: at the 9.9 V cutoff it would draw about a quarter more than the stand-in does there
  (1.12 × the nominal current against the stand-in's 0.89 ×), and about a fifth less at 12.6 V. The 5 V
  rail answer itself does not depend on this.
- **The pack's voltage curve and heating.** Three operating points were solved, not a discharge; the
  45 mΩ is a class estimate; cell heating, Peukert loss and connector drops are not in the model.
- **The servos' overload protection and heating.** A real STS3215 raises overload protection after
  some seconds at or near stall (the owner row's bench-test note); the model stalls indefinitely. The
  servo electronics' idle current (0.05 A, 0.6 A of the stance bus across twelve idle servos) is a class
  estimate — the single largest estimate inside a measured number.
- **Inrush at power-on** (the servos' input capacitance is not modelled), the IMU, and the bus
  adapter's own supply.

## Verdict

The brief's §1.3 power line is superseded by the table above: the stance bus is 5.6 A (the brief said
"4–6 A average walking"); a stall peaks at 2.1–2.7 A per servo depending on the pack voltage (the brief's
2.7 A is the full-pack figure); the pack sags 0.27 V in the stance and 0.46 V in a stall through 45 mΩ;
the 5 V 5 A buck holds the Pi at 5 V at every pack voltage down to the cutoff with 2.3 A of margin;
2200 mAh gives about 20 min of standing, so walking will be under the brief's 20–30 min — the plant lane's
gait profile is what turns that into a measured number.
