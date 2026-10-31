/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A seventh starter: the spider-18 power system (ADR-202) — a 3S
 *                     |                             | LiPo with its internal resistance feeding eighteen STS3215 bus
 *                     |                             | servos over the bus leads (six holding the brief's tripod-stance
 *                     |                             | torque through loads, twelve idle, one commanded a step against
 *                     |                             | a jammed shaft for 0.5 s — a stall) and a 5 V regulator feeding
 *                     |                             | a Raspberry Pi 5 (3 W, stepping to 12 W) and a LiDAR. Built by a
 *                     |                             | small builder in embodied's canonical actuator order; the
 *                     |                             | numbers it carries are named as the brief's or the catalog's.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A sixth starter: Blink — an Arduino Uno's sketch toggles an LED
 *                     |                             | through a resistor on D13.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A fifth starter: a battery-driven motor turning a crank-slider
 *                     |                             | through a belt — the non-rigid mechanics on one canvas.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — four starter circuits a person or the
 *                     |                             | concierge can open as a new design: a switched LED, an RC
 *                     |                             | charge, a battery-driven motor through a 3:1 gearbox, and
 *                     |                             | a PWM-driven motor behind a MOSFET with a flyback diode.
 *                     |                             | Each is a plain contract circuit laid out on the canvas
 *                     |                             | grid; the routes validate them like any other input.
 */

export interface Example { id: string; title: string; description: string; parts: unknown[]; wires: unknown[]; sim: Record<string, unknown> }

const w = (id: string, a: string, pa: string, b: string, pb: string) => ({ id, from: { part: a, pin: pa }, to: { part: b, pin: pb } });
const p = (id: string, type: string, x: number, y: number, props: Record<string, unknown> = {}, rotation = 0) => ({ id, type, x, y, rotation, props });

/** The spider-18 legs and joints in embodied's canonical actuator order (ADR-202): left side front to rear, then right; coxa, femur, tibia. */
const HEXAPOD_LEGS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
const HEXAPOD_JOINTS = ['coxa', 'femur', 'tibia'];
/** The tripod on the ground in the solved stance (L1, R2, L3): their femur and tibia servos carry the brief's static stance torque. */
const HEXAPOD_STANCE_LEGS = ['L1', 'R2', 'L3'];
/** The brief's worst static stance moment per loaded servo (femur 0.85 N*m, tibia similar), mN*m. */
const HEXAPOD_STANCE_MNM = 850;
/** The swing-leg servo whose foot is caught: commanded a 360-degree step at 1.0 s against a jammed shaft, back at 1.5 s. */
const HEXAPOD_STALL_SERVO = 'R1_femur';
/**
 * The STS3215 at 12 V, the numbers catalog/drivers.json row `servo-bus-sts3215-12v` resolves to (it reads embodied's
 * stall torque and speed; the currents, the idle and the reflected inertia are this lab's). Restated here because an
 * example must load without the owner package installed; tests/hexapod-power.test.js holds the two equal.
 */
const STS3215_NAMEPLATE = { nominalVolts: 12, stallAmps: 2.7, runAmps: 0.18, stallTorqueMnm: 2942, noLoadDegPerS: 270, travelDeg: 360, minPulseMs: 1, maxPulseMs: 2, idleAmps: 0.05, rotorInertiaGcm2: 70000 };

/** @description The servo id of a leg joint, `L1_femur`, in the canonical order. */
export function hexapodServoId(leg: string, joint: string): string { return `${leg}_${joint}`; }

/** A sequencer frame: a pulse of `widthMs` in a 100 ms frame (10 frames a second; the width is what the servo decodes). */
const hexapodFrame = (widthMs: number): string => `1:${widthMs / 1000} 0:${(100 - widthMs) / 1000}`;

/**
 * @description The eighteen servos on a 6 x 3 grid (a column per leg, a row per joint) with a torque load on each
 * stance femur and tibia and the jam on the stall servo's shaft.
 * @returns The servo and load parts.
 */
function hexapodServoParts(): unknown[] {
  const parts: unknown[] = [];
  HEXAPOD_LEGS.forEach((leg, li) => HEXAPOD_JOINTS.forEach((joint, ji) => {
    const id = hexapodServoId(leg, joint), x = 420 + 100 * li, y = 100 + 120 * ji;
    parts.push(p(id, 'servo', x, y, { ...STS3215_NAMEPLATE }));
    if (joint !== 'coxa' && HEXAPOD_STANCE_LEGS.includes(leg)) parts.push(p(`LD_${id}`, 'load', x, y + 60, { inertiaGcm2: 10, torqueMnm: HEXAPOD_STANCE_MNM }));
    if (id === HEXAPOD_STALL_SERVO) parts.push(p('JAM', 'load', x, y + 60, { inertiaGcm2: 10, frictionMnm: 10000 }));
  }));
  return parts;
}

/**
 * @description Every servo's three leads — the hold pulse (or the stall sequencer) on sig, the bus on v+, ground —
 * and the shaft couplings to the loads.
 * @returns The wires.
 */
function hexapodServoWires(): unknown[] {
  const wires: unknown[] = [];
  for (const leg of HEXAPOD_LEGS) for (const joint of HEXAPOD_JOINTS) {
    const id = hexapodServoId(leg, joint);
    wires.push(id === HEXAPOD_STALL_SERVO ? w(`s_${id}`, 'SEQ1', 'out', id, 'sig') : w(`s_${id}`, 'VHOLD', '+', id, 'sig'));
    wires.push(w(`v_${id}`, 'RBUS', 'b', id, 'v+'), w(`g_${id}`, id, 'gnd', 'GND', 'gnd'));
    if (joint !== 'coxa' && HEXAPOD_STANCE_LEGS.includes(leg)) wires.push(w(`t_${id}`, id, 'shaft', `LD_${id}`, 'shaft'));
    if (id === HEXAPOD_STALL_SERVO) wires.push(w(`t_${id}`, id, 'shaft', 'JAM', 'shaft'));
  }
  return wires;
}

/**
 * @description The supply side: the 3S pack with its internal resistance, the bus leads, the hold pulse, the stall
 * sequencer, the 5 V regulator and its loads (the Pi idle and busy, the LiDAR), and the buck's input power on the
 * pack as a stand-in, because the lab's regulator draws only its quiescent current from its input.
 * @returns Parts and wires.
 */
function hexapodSupply(): { parts: unknown[]; wires: unknown[] } {
  const stall = [...Array(10).fill(hexapodFrame(1)), ...Array(5).fill(hexapodFrame(2)), ...Array(5).fill(hexapodFrame(1))].join(' ');
  const parts = [
    // the brief's 3S 2200 mAh LiPo at its 11.1 V nominal; 45 mohm is a class estimate for three 2200 mAh 25C cells and their leads
    p('B1', 'battery', 60, 240, { volts: 11.1, internalOhms: 0.045, capacityMah: 2200 }),
    // the bus servo adapter and the daisy-chained bus leads: a 20 mohm allowance, not a measurement
    p('RBUS', 'resistor', 200, 140, { ohms: 0.02, ratedWatts: 5 }),
    p('VHOLD', 'source', 60, 60, { kind: 'pulse', volts: 5, frequencyHz: 50, dutyPercent: 5 }),
    p('SEQ1', 'sequencer', 200, 60, { highVolts: 5, pattern: stall, repeat: true }),
    p('GND', 'ground', 60, 420),
    // the 5 V 5 A buck as this lab's regulator for the rail: a behavioural model whose input carries only its 5 mA
    // quiescent, so what the PACK sees of the buck is the stand-in below — a resistor for its input power at the
    // nominal pack voltage with the Pi and LiDAR idle (4.5 W / 0.9 at 11.1 V), and one more in parallel for the
    // Pi's busy step (9 W / 0.9), switched at the same 0.5 s
    p('REG1', 'regulator', 200, 340, { outputVolts: 5, dropoutVolts: 1, maxAmps: 5 }),
    p('RBUCK_IDLE', 'resistor', 320, 140, { ohms: 24.64, ratedWatts: 10 }),
    p('SW_BUCK', 'switch', 320, 200, { closed: false, toggleAtSeconds: 0.5 }),
    p('RBUCK_BUSY', 'resistor', 400, 200, { ohms: 12.32, ratedWatts: 15 }),
    p('RLIDAR', 'resistor', 320, 260, { ohms: 16.67, ratedWatts: 3 }),
    p('RPI_IDLE', 'resistor', 320, 340, { ohms: 8.333, ratedWatts: 5 }),
    p('SW_BUSY', 'switch', 320, 420, { closed: false, toggleAtSeconds: 0.5 }),
    p('RPI_BUSY', 'resistor', 400, 420, { ohms: 2.778, ratedWatts: 15 }),
  ];
  const wires = [
    w('w_bus', 'B1', '+', 'RBUS', 'a'), w('w_bneg', 'B1', '-', 'GND', 'gnd'), w('w_hold', 'VHOLD', '-', 'GND', 'gnd'), w('w_seq', 'SEQ1', 'ref', 'GND', 'gnd'),
    w('w_reg_in', 'B1', '+', 'REG1', 'in'), w('w_reg_g', 'REG1', 'gnd', 'GND', 'gnd'),
    w('w_buck_a', 'B1', '+', 'RBUCK_IDLE', 'a'), w('w_buck_b', 'RBUCK_IDLE', 'b', 'GND', 'gnd'),
    w('w_buck_c', 'B1', '+', 'SW_BUCK', 'a'), w('w_buck_d', 'SW_BUCK', 'b', 'RBUCK_BUSY', 'a'), w('w_buck_e', 'RBUCK_BUSY', 'b', 'GND', 'gnd'),
    w('w_lidar_a', 'REG1', 'out', 'RLIDAR', 'a'), w('w_lidar_b', 'RLIDAR', 'b', 'GND', 'gnd'),
    w('w_pi_a', 'REG1', 'out', 'RPI_IDLE', 'a'), w('w_pi_b', 'RPI_IDLE', 'b', 'GND', 'gnd'),
    w('w_busy_a', 'REG1', 'out', 'SW_BUSY', 'a'), w('w_busy_b', 'SW_BUSY', 'b', 'RPI_BUSY', 'a'), w('w_busy_c', 'RPI_BUSY', 'b', 'GND', 'gnd'),
  ];
  return { parts, wires };
}

/**
 * @description The spider-18 power system (ADR-202): the whole electrical system of the hexapod in one solve so the
 * pack current, the sag, a stall peak and the 5 V rail are solved numbers rather than the brief's estimates.
 * @returns The example.
 */
function hexapodPowerExample(): Example {
  const supply = hexapodSupply();
  return {
    id: 'hexapod-power', title: 'Hexapod power (spider-18)',
    description: 'A 3S 2200 mAh LiPo (11.1 V nominal, 45 mohm) feeds eighteen STS3215 bus servos over the bus leads and a 5 V regulator feeding a Raspberry Pi 5 and a LiDAR (the buck input power stands on the pack as a resistor, since the lab regulator draws only its quiescent current). Six servos of a tripod stance each hold 0.85 N m through a load, twelve idle; R1_femur is commanded a step against a jammed shaft from 1.0 to 1.5 s (a stall); the Pi steps from 3 W to 12 W at 0.5 s. Read the pack current and sag, the stall peak and the 5 V rail.',
    parts: [...supply.parts, ...hexapodServoParts()],
    wires: [...supply.wires, ...hexapodServoWires()],
    sim: { stopSeconds: 2, stepSeconds: 0.0005 },
  };
}

/** The starter circuits, in the order the surface lists them. */
export const EXAMPLES: readonly Example[] = Object.freeze([
  {
    id: 'led-switch', title: 'Switched LED', description: 'A 9 V battery, a switch that closes at 5 ms, a 470 ohm resistor and a red LED. Read the LED current and the resistor power.',
    parts: [p('B1', 'battery', 100, 200, { volts: 9, internalOhms: 0.5, capacityMah: 500 }), p('S1', 'switch', 260, 100, { closed: false, toggleAtSeconds: 0.005 }), p('R1', 'resistor', 420, 100, { ohms: 470 }),
      p('D1', 'led', 580, 200, { color: 'red', maxMa: 20 }, 90), p('GND', 'ground', 340, 320)],
    wires: [w('w1', 'B1', '+', 'S1', 'a'), w('w2', 'S1', 'b', 'R1', 'a'), w('w3', 'R1', 'b', 'D1', 'a'), w('w4', 'D1', 'k', 'GND', 'gnd'), w('w5', 'B1', '-', 'GND', 'gnd')],
    sim: { stopSeconds: 0.02 },
  },
  {
    id: 'rc-charge', title: 'RC charge', description: 'A 5 V supply charges a 100 uF capacitor through 1 kohm: the time constant is 100 ms, so the capacitor sits at 63 percent after one.',
    parts: [p('B1', 'battery', 100, 200, { volts: 5, internalOhms: 0 }), p('R1', 'resistor', 300, 100, { ohms: 1000 }), p('C1', 'capacitor', 480, 200, { farads: 100e-6, ratedVolts: 16 }, 90), p('GND', 'ground', 300, 320)],
    wires: [w('w1', 'B1', '+', 'R1', 'a'), w('w2', 'R1', 'b', 'C1', 'a'), w('w3', 'C1', 'b', 'GND', 'gnd'), w('w4', 'B1', '-', 'GND', 'gnd')],
    sim: { stopSeconds: 0.5 },
  },
  {
    id: 'motor-gearbox', title: 'Motor with a 3:1 gearbox', description: 'A 12 V battery spins a DC motor whose 20-tooth pinion drives a 60-tooth gear carrying a flywheel load. Watch the spin-up, the gear ratio and the current.',
    parts: [p('B1', 'battery', 100, 200, { volts: 12, internalOhms: 0.2, capacityMah: 2000 }), p('S1', 'switch', 260, 100, { closed: true }), p('M1', 'motor', 460, 200),
      p('G1', 'gear', 620, 200, { teeth: 20, moduleMm: 1.5 }), p('G2', 'gear', 740, 200, { teeth: 60, moduleMm: 1.5 }), p('L1', 'load', 740, 340, { inertiaGcm2: 200, frictionMnm: 2, viscousMnmPerKrpm: 0.5 }), p('GND', 'ground', 300, 320)],
    wires: [w('w1', 'B1', '+', 'S1', 'a'), w('w2', 'S1', 'b', 'M1', '+'), w('w3', 'M1', '-', 'GND', 'gnd'), w('w4', 'B1', '-', 'GND', 'gnd'),
      w('s1', 'M1', 'shaft', 'G1', 'shaft'), w('m1', 'G1', 'teeth', 'G2', 'teeth'), w('s2', 'G2', 'shaft', 'L1', 'shaft')],
    sim: { stopSeconds: 0.5, stepSeconds: 0.0005 },
  },
  {
    id: 'pwm-motor', title: 'PWM motor drive', description: 'A 1 kHz, 50 percent pulse source switches a MOSFET that grounds a 12 V motor; a flyback diode carries the freewheeling current. Change the duty and watch the speed.',
    parts: [p('B1', 'battery', 100, 160, { volts: 12, internalOhms: 0.2, capacityMah: 2000 }), p('M1', 'motor', 400, 120), p('D1', 'diode', 520, 120, {}, 270), p('Q1', 'nmos', 400, 300),
      p('V1', 'source', 200, 320, { kind: 'pulse', volts: 5, frequencyHz: 1000, dutyPercent: 50 }), p('G1', 'gear', 620, 120, { teeth: 12 }), p('G2', 'gear', 720, 120, { teeth: 36 }), p('GND', 'ground', 400, 440)],
    wires: [w('w1', 'B1', '+', 'M1', '+'), w('w2', 'M1', '-', 'Q1', 'd'), w('w3', 'Q1', 's', 'GND', 'gnd'), w('w4', 'B1', '-', 'GND', 'gnd'), w('w5', 'V1', '+', 'Q1', 'g'), w('w6', 'V1', '-', 'GND', 'gnd'),
      w('w7', 'D1', 'a', 'M1', '-'), w('w8', 'D1', 'k', 'M1', '+'), w('s1', 'M1', 'shaft', 'G1', 'shaft'), w('m1', 'G1', 'teeth', 'G2', 'teeth')],
    sim: { stopSeconds: 0.2, stepSeconds: 0.00002 },
  },
  {
    id: 'crank-slider', title: 'Belt-driven crank-slider', description: 'A 12 V motor drives a 20 mm pulley; a belt to a 40 mm pulley halves the speed; the pulley turns a crank-slider with a 100 g slider on a damper. Watch the slider stroke, the belt slip and the motor current pulse twice per turn.',
    parts: [p('B1', 'battery', 100, 200, { volts: 12, internalOhms: 0.2, capacityMah: 2000 }), p('S1', 'switch', 260, 100, { closed: true }), p('M1', 'motor', 460, 200),
      p('PL1', 'pulley', 560, 200, { radiusMm: 20, gripN: 6 }), p('PL2', 'pulley', 700, 200, { radiusMm: 40, gripN: 6 }), p('CR1', 'crank', 820, 320, { radiusMm: 20, rodMm: 80, sliderMassG: 100, dampingNsPerM: 0.5 }), p('GND', 'ground', 300, 320)],
    wires: [w('w1', 'B1', '+', 'S1', 'a'), w('w2', 'S1', 'b', 'M1', '+'), w('w3', 'M1', '-', 'GND', 'gnd'), w('w4', 'B1', '-', 'GND', 'gnd'),
      w('s1', 'M1', 'shaft', 'PL1', 'shaft'), w('b1', 'PL1', 'belt', 'PL2', 'belt'), w('s2', 'PL2', 'shaft', 'CR1', 'shaft')],
    sim: { stopSeconds: 0.4, stepSeconds: 0.0002 },
  },
  {
    id: 'arduino-blink', title: 'Arduino Blink', description: "An Arduino Uno runs the classic Blink sketch: D13 drives a red LED through 220 ohm, 500 ms on and 500 ms off. Edit the sketch in the inspector — change the delays or the pin — and run again; the LED current follows the firmware.",
    parts: [p('MCU1', 'arduino', 200, 240, { sketch: 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n' }),
      p('R1', 'resistor', 420, 180, { ohms: 220 }), p('D1', 'led', 560, 260, { color: 'red', maxMa: 20 }, 90), p('GND', 'ground', 380, 400)],
    wires: [w('w1', 'MCU1', 'D13', 'R1', 'a'), w('w2', 'R1', 'b', 'D1', 'a'), w('w3', 'D1', 'k', 'GND', 'gnd'), w('w4', 'MCU1', 'GND', 'GND', 'gnd')],
    sim: { stopSeconds: 2.5, stepSeconds: 0.001 },
  },
  hexapodPowerExample(),
]);

/** @description Find an example by id. */
export function findExample(id: unknown): Example | null {
  return EXAMPLES.find((e) => e.id === id) ?? null;
}

/** @description The list the surface and the concierge see (no circuits). */
export function listExamples(): Array<Pick<Example, 'id' | 'title' | 'description'>> {
  return EXAMPLES.map(({ id, title, description }) => ({ id, title, description }));
}
