# The controller protocol — `oshal-animatronics/1`

The page streams frames to the motion controller (an ESP32 or Arduino driving a PCA9685) over
Web Serial. The server composes every line; the page only paces and sends them. The firmware
applies frames; it never invents a motion. One parser reads both directions
(`src-routes/engine/protocol.ts`), and the browser loads that same compiled module at
`/api/animatronics/assets/protocol.js`, so encoder and parser exist exactly once.

## Framing

One ASCII line per message, `LF`-terminated: `<body>*<XX>` where `XX` is the two-digit
upper-case hex XOR of every byte of the body (NMEA style). A line with a missing or wrong
checksum is refused with `ERR ? bad checksum` and applied nowhere. 115 200 baud, 8N1.

Vectors (asserted by `tests/engine-protocol.test.js`; the firmware's parser must agree):

| body | checksum | line |
|---|---|---|
| `H` | `48` | `H*48` |
| `E` | `45` | `E*45` |
| `R` | `52` | `R*52` |
| `L 3 500 2400` | `6C` | `L 3 500 2400*6C` |
| `F 7 0=1500,1=1720` | `5C` | `F 7 0=1500,1=1720*5C` |
| `F 13` | `64` | `F 13*64` (an empty frame = heartbeat) |
| `HELLO oshal-animatronics/1 board=pca9685 channels=16` | `21` | — |
| `ESTOP` | `5D` | — |

## Host → controller

| line | meaning | reply |
|---|---|---|
| `H` | hello | `HELLO oshal-animatronics/1 board=<id> channels=<n>` |
| `L <ch> <minUs> <maxUs>` | controller-side pulse clamps for one output (defence in depth under the server's software limits) | `OK L <ch>` |
| `F <seq> <ch>=<us>,<ch>=<us>,…` | one frame: set these outputs now; outputs not named hold | `OK <seq>` or `ERR <seq> <reason>` |
| `F <seq>` | heartbeat (nothing moved this frame) | `OK <seq>` |
| `E` | **E-STOP**: every output off (PCA9685 OE high, PWM 0), latched | `ESTOP` |
| `R` | release the latch (the rig still has to be armed again on the server) | `OK R` |

Frames are **delta-encoded** by `frameLines()`: frame 0 carries every output, then only the
outputs whose pulse changed, with a full keyframe every 25 frames and an empty heartbeat when
nothing moved. Seven channels at 50 Hz come to well under the 11 520 B/s the baud allows; the
test asserts one second of the busiest template scenario fits.

## The bring-up an ARM sends

`POST /rigs/:id/arm {confirm:true}` answers the lines the page sends first: `H`, one `L` per
channel with its hard clamps, then `F 0 …` with every output at its neutral pulse. Only after
that do play, look-at and jog stream.

## Controller behaviour the firmware must keep

- Verify the checksum before anything else; refuse, never guess.
- Clamp every pulse to the `L` limits for that output and to the absolute 400–2800 µs floor and
  ceiling; refuse a channel beyond the board.
- `E` turns every output off and **latches**: frames answer `ERR <seq> estopped` until `R`.
- **Watchdog**: after 3000 ms without any valid line, outputs off (the host is gone). The page
  sends heartbeat frames while a stream holds still, so a live stream never trips it.
- Reply to every line; the page counts `OK` / `ERR` and shows the last error.

## Wiring rule (the one every servo project re-learns)

The PCA9685's **V+** servo rail is a separate terminal from its VCC logic pin. Feed V+ from a
5–6 V supply sized for the summed servo current (the app's supply budget tells you the idle,
peak-moving and all-stalled numbers), share **only ground** with the microcontroller, and never
power servos from the USB 5 V pin. The server refuses a rig whose supply is a USB port with more
than one servo, and refuses to arm it.

## Firmware

`firmware/esp32-pca9685/animatronics_controller.ino` is the reference implementation of this
protocol on the Adafruit PWM Servo Driver library. **Posture:** it is reference source. It was
not compiled or bench-run in the session that wrote it; the protocol it implements is proven by
the Node encoder / parser tests and the surface link tests. Bench proof — the sketch compiled,
flashed, and a template scenario played from the page with a scope on one output — is
BACKLOG B2, and until it is done no Test Lab case claims the firmware.
