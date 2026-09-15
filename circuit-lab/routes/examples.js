"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXAMPLES = void 0;
exports.findExample = findExample;
exports.listExamples = listExamples;
const w = (id, a, pa, b, pb) => ({ id, from: { part: a, pin: pa }, to: { part: b, pin: pb } });
const p = (id, type, x, y, props = {}, rotation = 0) => ({ id, type, x, y, rotation, props });
/** The starter circuits, in the order the surface lists them. */
exports.EXAMPLES = Object.freeze([
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
]);
/** @description Find an example by id. */
function findExample(id) {
    return exports.EXAMPLES.find((e) => e.id === id) ?? null;
}
/** @description The list the surface and the concierge see (no circuits). */
function listExamples() {
    return exports.EXAMPLES.map(({ id, title, description }) => ({ id, title, description }));
}
