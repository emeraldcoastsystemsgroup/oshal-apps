/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — run an ATmega328P Intel HEX in avr8js
 *                     |                             | (MIT) for N seconds at 16 MHz with timers 0 / 1 / 2 and the
 *                     |                             | USART, and print one JSON object: every Arduino digital
 *                     |                             | pin's edges as [seconds, level] (Uno numbering D0–D13,
 *                     |                             | A0–A5), each pin's final mode, the serial text the sketch
 *                     |                             | printed, the cycles run. Usage: node avr8js_run.js <hex> <s>
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The INPUT half (BACKLOG B1): the ADC peripheral is now wired
 *                     |                             | so analogRead completes (it used to hang the run forever)
 *                     |                             | and its reads are counted per channel, and `--serve` keeps
 *                     |                             | ONE CPU alive on stdin/stdout — each line advances it to a
 *                     |                             | given time with pin levels and channel voltages applied
 *                     |                             | first, which is what lets the solver and the sketch step
 *                     |                             | together instead of the sketch running open-loop.
 */
'use strict';
const fs = require('node:fs');
const readline = require('node:readline');
const avr = require(process.env.AVR8JS_DIR || '/opt/circuit-lab/avr8js');

const F_CPU = 16e6;
const FLASH_BYTES = 0x8000;
const MAX_EDGES = 200000;
// Uno numbering: PORTD 0-7 → D0-D7, PORTB 0-5 → D8-D13, PORTC 0-5 → A0-A5
const NAMES = { D: (i) => 'D' + i, B: (i) => (i <= 5 ? 'D' + (8 + i) : null), C: (i) => (i <= 5 ? 'A' + i : null) };
const PIN_INDEX = {};
for (const key of Object.keys(NAMES)) for (let i = 0; i < 8; i += 1) { const n = NAMES[key](i); if (n) PIN_INDEX[n] = [key, i]; }

/** Intel HEX → bytes into `flash` (types 00 data, 01 EOF, 02 / 04 extended addresses). */
function loadHex(text, flash) {
  let base = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const count = parseInt(line.slice(1, 3), 16), address = parseInt(line.slice(3, 7), 16), type = parseInt(line.slice(7, 9), 16);
    if (type === 1) break;
    if (type === 2) { base = parseInt(line.slice(9, 13), 16) << 4; continue; }
    if (type === 4) { base = parseInt(line.slice(9, 13), 16) << 16; continue; }
    if (type !== 0) continue;
    for (let i = 0; i < count; i += 1) flash[base + address + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
  }
}

/**
 * One ATmega328P with its ports, timers, USART and ADC, plus the bookkeeping both modes share:
 * `pins` is every OUTPUT pin's edge list, `edgeLog` the edges since the last flush (the co-simulation
 * reads that), `reads` how many conversions the sketch asked for on each analog channel.
 */
function machine(hexPath) {
  const program = new Uint16Array(FLASH_BYTES / 2);
  loadHex(fs.readFileSync(hexPath, 'utf8'), new Uint8Array(program.buffer));
  const cpu = new avr.CPU(program);
  const ports = { D: new avr.AVRIOPort(cpu, avr.portDConfig), B: new avr.AVRIOPort(cpu, avr.portBConfig), C: new avr.AVRIOPort(cpu, avr.portCConfig) };
  new avr.AVRTimer(cpu, avr.timer0Config); new avr.AVRTimer(cpu, avr.timer1Config); new avr.AVRTimer(cpu, avr.timer2Config);
  const usart = new avr.AVRUSART(cpu, avr.usart0Config, F_CPU);
  const adc = new avr.AVRADC(cpu, avr.adcConfig);
  const m = { cpu, ports, adc, pins: {}, modes: {}, edgeLog: [], reads: {}, serial: '', last: {}, edges: 0, external: new Set() };
  usart.onByteTransmit = (byte) => { if (m.serial.length < 4000) m.serial += String.fromCharCode(byte); };
  const defaultRead = adc.onADCRead;
  adc.onADCRead = (input) => {
    if (input && input.type === avr.ADCMuxInputType.SingleEnded) { const n = 'A' + input.channel; m.reads[n] = (m.reads[n] || 0) + 1; }
    defaultRead(input);  // the default reads channelValues and completes after sampleCycles — real timing, our voltage
  };
  const sample = (key, port) => {
    for (let i = 0; i < 8; i += 1) {
      const name = NAMES[key](i); if (!name) continue;
      const state = port.pinState(i);
      const mode = state === avr.PinState.Input ? 'input' : state === avr.PinState.InputPullUp ? 'input_pullup' : 'output';
      const level = state === avr.PinState.High || state === avr.PinState.InputPullUp ? 1 : 0;
      m.modes[name] = mode;
      // a pin the sketch pulled up with nothing external on it reads HIGH, as it does on a real board
      if (mode === 'input_pullup' && !m.external.has(name)) port.setPin(i, true);
      if (mode === 'output') {
        if (m.last[name] !== level) {
          const t = Number((cpu.cycles / F_CPU).toFixed(9));
          (m.pins[name] = m.pins[name] || []).push([t, level]);
          m.edgeLog.push([name, t, level]);
          m.last[name] = level; m.edges += 1;
        }
      } else if (m.last[name] !== undefined) { m.last[name] = undefined; }
    }
  };
  m.sample = () => { for (const [key, port] of Object.entries(ports)) sample(key, port); };
  for (const [key, port] of Object.entries(ports)) port.addListener(() => sample(key, port));
  return m;
}

/** Advance the CPU to `limit` cycles, stopping early when a pin toggles faster than the deck can carry. */
function advance(m, limit) {
  while (m.cpu.cycles < limit) {
    for (let i = 0; i < 50000 && m.cpu.cycles < limit; i += 1) { avr.avrInstruction(m.cpu); m.cpu.tick(); }
    if (m.edges > MAX_EDGES) return true;
  }
  return false;
}

/** The open-loop mode the worker has always used: run N seconds, print the whole timeline once. */
function oneShot(hexPath, secondsArg) {
  const seconds = Math.max(0.001, Math.min(Number(secondsArg) || 1, 60));
  const m = machine(hexPath);
  const truncated = advance(m, seconds * F_CPU);
  m.sample();
  process.stdout.write(JSON.stringify({
    seconds: Number((m.cpu.cycles / F_CPU).toFixed(6)), cycles: m.cpu.cycles, pins: m.pins, modes: m.modes,
    serial: m.serial, reads: m.reads, edges: m.edges, truncated,
  }));
}

/**
 * The co-simulation mode: hold one CPU and advance it a slice at a time. Each stdin line is
 * {t, digital:{D2:1}, analog:{A0:2.53}} — the levels and channel voltages the SOLVER produced are
 * applied BEFORE the slice runs, so digitalRead and analogRead inside it see the circuit. The reply
 * carries only the edges of that slice; the CPU, its RAM and its timers carry on.
 */
function serve(hexPath) {
  const m = machine(hexPath);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch (err) { process.stderr.write('bad slice request: ' + err.message); process.exit(3); }
    for (const [name, level] of Object.entries(req.digital || {})) {
      const at = PIN_INDEX[name];
      if (at) { m.external.add(name); m.ports[at[0]].setPin(at[1], !!level); }
    }
    for (const [name, volts] of Object.entries(req.analog || {})) {
      const channel = /^A(\d)$/.exec(name);
      if (channel) m.adc.channelValues[Number(channel[1])] = Number(volts);
    }
    const truncated = advance(m, Math.max(0, Number(req.t) || 0) * F_CPU);
    m.sample();
    const edges = m.edgeLog.splice(0, m.edgeLog.length);
    process.stdout.write(JSON.stringify({
      t: Number((m.cpu.cycles / F_CPU).toFixed(9)), cycles: m.cpu.cycles, edges, modes: m.modes,
      serial: m.serial, reads: m.reads, truncated,
    }) + '\n');
    if (truncated) { rl.close(); process.exit(0); }
  });
  rl.on('close', () => process.exit(0));
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--serve') {
    if (!args[1]) throw new Error('usage: avr8js_run.js --serve <sketch.hex>');
    return serve(args[1]);
  }
  if (!args[0]) throw new Error('usage: avr8js_run.js <sketch.hex> <seconds>  |  --serve <sketch.hex>');
  return oneShot(args[0], args[1]);
}

main();
