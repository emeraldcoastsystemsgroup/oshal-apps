/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The drone-to-drone transport catalog (ESP-NOW, ESP-NOW long
 *                     |                             | range, Wi-Fi Direct, Wi-Fi mesh, BLE coded PHY, LoRa 915,
 *                     |                             | Wi-Fi HaLow) as datasheet-class radio numbers, and the
 *                     |                             | log-distance link budget every plan is sized from: path loss
 *                     |                             | from the free-space intercept and an environment exponent,
 *                     |                             | margin above sensitivity after a fade allowance, the range
 *                     |                             | at a required margin solved in closed form. No radio is
 *                     |                             | modelled beyond what a datasheet states; the range test in
 *                     |                             | the hardware document replaces these numbers before flight.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Provenance corrected against Espressif's own documents: ESP-NOW
 *                     |                             | peers are at most 20 paired / 17 encrypted (not 20 encrypted);
 *                     |                             | long-range mode gains about 4 dB over 802.11b (not 9), so its
 *                     |                             | row is -100 dBm; Espressif's open-field ESP32-C6 test is quoted
 *                     |                             | on both ESP-NOW rows with its latencies; Wi-Fi rows use the
 *                     |                             | IEEE minimum sensitivities; LoRa's 50-byte time on air is about
 *                     |                             | 330 ms; planning figures are labelled as planning figures.
 */

/** @description The transports the designer can size a chain on. */
export type TransportId = 'esp-now' | 'esp-now-lr' | 'wifi-direct' | 'wifi-mesh' | 'ble-coded' | 'lora-915' | 'wifi-halow';

/** @description One transport: the radio numbers a link budget needs and the facts a designer trades. */
export interface Transport {
  id: TransportId;
  name: string;
  band: string;
  freqMhz: number;
  txPowerDbm: number;
  /** Per side; both ends are assumed to carry the same antenna. */
  antennaGainDbi: number;
  /** Receiver sensitivity at the data rate the throughput figure assumes. */
  sensitivityDbm: number;
  /** Fade allowance for a small airframe in motion (multipath, antenna pattern nulls). */
  fadeMarginDb: number;
  maxFrameBytes: number;
  /** Planning throughput at the sensitivity's rate, kbps, one hop, one direction (not a measurement). */
  throughputKbps: number;
  latencyMs: number;
  topology: 'p2p' | 'star' | 'mesh';
  maxPeers: number;
  module: string;
  multiHop: 'native' | 'application' | 'awkward';
  notes: string[];
  source: string;
}

/** @description Speed of light, m/s. */
const C = 299_792_458;

/** @description The default environment exponent: air-to-air, line of sight, both ends above the clutter. */
export const DEFAULT_PATH_LOSS_EXPONENT = 2.2;

/** @description The catalog. Every radio number states its provenance in `source`; planning figures say so. */
export const TRANSPORTS: readonly Transport[] = [
  {
    id: 'esp-now', name: 'ESP-NOW (2.4 GHz, 1 Mbps)', band: '2.4 GHz ISM', freqMhz: 2437, txPowerDbm: 20, antennaGainDbi: 0,
    sensitivityDbm: -96, fadeMarginDb: 10, maxFrameBytes: 250, throughputKbps: 250, latencyMs: 20, topology: 'mesh', maxPeers: 20,
    module: 'ESP32-C6 / ESP32-S3 module on the flight controller UART (MAVLink), PCB antenna', multiHop: 'application',
    notes: ['Connectionless: any peer can address any peer; the relay logic is the application (this package).', 'At most 20 paired peers per node, of which at most 17 encrypted (the default allows 7); a v1 frame carries 250 bytes, a v2 frame 1470.', 'Espressif\'s own open-field test (ESP32-C6 dev boards, PCB antennas, near the ground) delivered close to 100 % to 150 m and about 60 % at 300 m, under 20 ms average latency; the model here is the air-to-air assumption the range test must confirm.', 'Shares 2.4 GHz with Wi-Fi and most video links; choose the 900 MHz ELRS variant so the kill switch does not share the band.'],
    source: 'ESP-IDF ESP-NOW guide (peer and frame limits); ESP32-C6 datasheet (802.11b transmit up to +21 dBm); -96 dBm at 1 Mbps is a conservative planning figure; Espressif developer blog, ESP-NOW for outdoor applications (the field test)',
  },
  {
    id: 'esp-now-lr', name: 'ESP-NOW long-range mode (2.4 GHz, 250 kbps)', band: '2.4 GHz ISM', freqMhz: 2437, txPowerDbm: 20, antennaGainDbi: 2,
    sensitivityDbm: -100, fadeMarginDb: 10, maxFrameBytes: 250, throughputKbps: 100, latencyMs: 25, topology: 'mesh', maxPeers: 20,
    module: 'Same ESP32 module with a 2 dBi dipole, Wi-Fi LR (Espressif proprietary PHY) enabled', multiHop: 'application',
    notes: ['Espressif-only PHY (every ESP32 except the C2): every node must be an ESP32, so the base is an ESP32 bridge on the ground station.', 'The PHY runs at 256 or 512 kbps; Espressif states about 4 dB more sensitivity than 802.11b and 2 to 2.5 times the distance. With a 2 dBi dipole each side the budget here is 8 dB above the ESP-NOW row.', 'Espressif\'s open-field test (ESP32-C6 dev boards, PCB antennas) delivered close to 100 % to 450 m and about 40 % at 900 m, under 25 ms latency.'],
    source: 'ESP-IDF Wi-Fi guide, long-range mode (the rates, the 4 dB gain, the 2 to 2.5 times distance); -100 dBm = the ESP-NOW planning figure less 4 dB; Espressif developer blog, ESP-NOW for outdoor applications (the field test)',
  },
  {
    id: 'wifi-direct', name: 'Wi-Fi Direct (802.11n P2P, MCS0)', band: '2.4 GHz ISM', freqMhz: 2437, txPowerDbm: 20, antennaGainDbi: 0,
    sensitivityDbm: -82, fadeMarginDb: 10, maxFrameBytes: 1500, throughputKbps: 20_000, latencyMs: 10, topology: 'star', maxPeers: 8,
    module: 'Raspberry Pi Zero 2 W companion (wlan0 in P2P group-owner or client role)', multiHop: 'awkward',
    notes: ['One group owner per group: a relay that must be a client of the inner group AND the owner of the outer group needs two radios or a non-standard concurrent mode.', 'Best for the LAST hop where bandwidth matters (a video tip), not for the chain.'],
    source: '-82 dBm = the IEEE 802.11n minimum sensitivity for 20 MHz MCS0 (real receivers do better; the range test decides); Wi-Fi Direct group roles',
  },
  {
    id: 'wifi-mesh', name: 'Wi-Fi mesh (ESP-WIFI-MESH / 802.11s, 6 Mbps base rate)', band: '2.4 GHz ISM', freqMhz: 2437, txPowerDbm: 20, antennaGainDbi: 0,
    sensitivityDbm: -82, fadeMarginDb: 10, maxFrameBytes: 1500, throughputKbps: 5_000, latencyMs: 20, topology: 'mesh', maxPeers: 10,
    module: 'ESP32 companion (ESP-WIFI-MESH tree) or a Linux companion with 802.11s (mesh point) support', multiHop: 'native',
    notes: ['Multi-hop routing is the stack\'s: the chain becomes a tree rooted at the base; this package still decides WHERE each node flies.', 'A node that loses its parent re-selects one before traffic flows again; the on-board rule covers that window.'],
    source: '-82 dBm = the IEEE 802.11g minimum sensitivity at 6 Mbps (real receivers do better; the range test decides); ESP-WIFI-MESH and 802.11s as the two multi-hop stacks',
  },
  {
    id: 'ble-coded', name: 'BLE 5 coded PHY (125 kbps, S=8)', band: '2.4 GHz ISM', freqMhz: 2440, txPowerDbm: 8, antennaGainDbi: 0,
    sensitivityDbm: -103, fadeMarginDb: 10, maxFrameBytes: 244, throughputKbps: 60, latencyMs: 30, topology: 'p2p', maxPeers: 8,
    module: 'nRF52840 / nRF5340 on the companion, or the ESP32-C6 BLE radio', multiHop: 'application',
    notes: ['A relay is a central to its outer neighbour and a peripheral to its inner one — supported by the SoftDevice, but each link is a connection interval, so latency adds per hop.', 'Bluetooth Mesh (flooding) exists but its relay count and latency make it a poor fit for a line; use point-to-point connections.'],
    source: 'Nordic nRF52840 product specification (+8 dBm, -103 dBm at 125 kbps coded PHY); the ESP32-C6 BLE radio states up to +20 dBm and -106 dBm at 125 kbps',
  },
  {
    id: 'lora-915', name: 'LoRa 915 MHz (SF9, BW125)', band: '915 MHz ISM (US)', freqMhz: 915, txPowerDbm: 20, antennaGainDbi: 2,
    sensitivityDbm: -129, fadeMarginDb: 10, maxFrameBytes: 222, throughputKbps: 1.76, latencyMs: 330, topology: 'p2p', maxPeers: 1,
    module: 'SX1276 / SX1262 module (Heltec, RAK) on the companion SPI; 2 dBi whip', multiHop: 'application',
    notes: ['Kilometre hops and a few bytes per second: commands and heartbeats fit, telemetry streams and pictures do not.', 'Half duplex on one channel: every hop halves the chain\'s share of the air; duty-cycle rules apply in some regions.', 'Time on air at SF9 / BW125 / CR 4/5 is about 330 ms for a 50-byte frame (the Semtech time-on-air formula); the latency figure is per hop.'],
    source: 'Semtech SX1276 datasheet sensitivity table (about -129 dBm at SF9 / BW125, about -137 dBm at SF12), +20 dBm on PA_BOOST; 1.76 kbps = the SF9 / BW125 / CR 4/5 bit rate',
  },
  {
    id: 'wifi-halow', name: 'Wi-Fi HaLow (802.11ah, 1 MHz MCS0)', band: '902-928 MHz (US)', freqMhz: 915, txPowerDbm: 20, antennaGainDbi: 2,
    sensitivityDbm: -98, fadeMarginDb: 10, maxFrameBytes: 1500, throughputKbps: 1_500, latencyMs: 15, topology: 'star', maxPeers: 8,
    module: 'Morse Micro MM6108 module (SDIO/SPI) on a Linux companion', multiHop: 'awkward',
    notes: ['Sub-GHz range with real throughput; a relay needs station and access-point roles at once, so confirm the module firmware supports that before choosing it for a chain.', 'Costs several times an ESP32; justified when the tip streams pictures over kilometres.'],
    source: '-98 dBm is a conservative planning figure for 1 MHz MCS0 (the 1 MHz repetition mode goes lower); the range test decides',
  },
];

/**
 * @description Look a transport up by id.
 * @param id - Candidate id.
 * @returns The transport, or null.
 */
export function findTransport(id: unknown): Transport | null {
  return TRANSPORTS.find((t) => t.id === id) ?? null;
}

/**
 * @description Free-space path loss at one metre for the transport's frequency, dB.
 * @param freqMhz - Carrier frequency.
 * @returns 20·log10(4π·f/c).
 */
export function interceptDb(freqMhz: number): number {
  return 20 * Math.log10((4 * Math.PI * freqMhz * 1e6) / C);
}

/**
 * @description Log-distance path loss, dB, for a link of `distanceM` metres.
 * @param t - Transport.
 * @param distanceM - Link length (clamped at one metre).
 * @param exponent - Environment exponent (2 free space; 2.2 air-to-air; 2.7+ near clutter).
 * @returns Path loss in dB.
 */
export function pathLossDb(t: Transport, distanceM: number, exponent = DEFAULT_PATH_LOSS_EXPONENT): number {
  return interceptDb(t.freqMhz) + 10 * exponent * Math.log10(Math.max(1, distanceM));
}

/**
 * @description Link margin above sensitivity after the fade allowance, dB. Negative = no link.
 * @param t - Transport.
 * @param distanceM - Link length.
 * @param exponent - Environment exponent.
 * @returns Margin in dB.
 */
export function marginDb(t: Transport, distanceM: number, exponent = DEFAULT_PATH_LOSS_EXPONENT): number {
  const rx = t.txPowerDbm + 2 * t.antennaGainDbi - pathLossDb(t, distanceM, exponent);
  return rx - t.sensitivityDbm - t.fadeMarginDb;
}

/**
 * @description The distance at which the margin equals `requiredMarginDb`, metres (closed form).
 * @param t - Transport.
 * @param requiredMarginDb - Margin the design keeps (0 = the modelled edge of the link).
 * @param exponent - Environment exponent.
 * @returns Range in metres, never below one metre.
 */
export function rangeAtMarginM(t: Transport, requiredMarginDb: number, exponent = DEFAULT_PATH_LOSS_EXPONENT): number {
  const allowed = t.txPowerDbm + 2 * t.antennaGainDbi - t.sensitivityDbm - t.fadeMarginDb - requiredMarginDb;
  return Math.max(1, 10 ** ((allowed - interceptDb(t.freqMhz)) / (10 * exponent)));
}

/** @description A full budget for one link. */
export interface LinkBudget {
  transport: TransportId;
  distanceM: number;
  exponent: number;
  pathLossDb: number;
  rxPowerDbm: number;
  marginDb: number;
  requiredMarginDb: number;
  ok: boolean;
  /** Where the modelled margin reaches zero. */
  hardRangeM: number;
  /** Where the modelled margin equals the required margin. */
  designRangeM: number;
}

/**
 * @description Compute the budget of one link at a distance.
 * @param t - Transport.
 * @param distanceM - Link length.
 * @param requiredMarginDb - The design margin.
 * @param exponent - Environment exponent.
 * @returns The budget.
 */
export function linkBudget(t: Transport, distanceM: number, requiredMarginDb: number, exponent = DEFAULT_PATH_LOSS_EXPONENT): LinkBudget {
  const pl = pathLossDb(t, distanceM, exponent);
  const rx = t.txPowerDbm + 2 * t.antennaGainDbi - pl;
  const m = rx - t.sensitivityDbm - t.fadeMarginDb;
  return {
    transport: t.id, distanceM, exponent, pathLossDb: round1(pl), rxPowerDbm: round1(rx), marginDb: round1(m), requiredMarginDb,
    ok: m >= requiredMarginDb, hardRangeM: Math.round(rangeAtMarginM(t, 0, exponent)), designRangeM: Math.round(rangeAtMarginM(t, requiredMarginDb, exponent)),
  };
}

/**
 * @description Compare every transport at one distance and margin — the designer's first table.
 * @param distanceM - The distance a hop would have to cover.
 * @param requiredMarginDb - The design margin.
 * @param exponent - Environment exponent.
 * @returns One budget per transport, in catalog order.
 */
export function compareTransports(distanceM: number, requiredMarginDb: number, exponent = DEFAULT_PATH_LOSS_EXPONENT): LinkBudget[] {
  return TRANSPORTS.map((t) => linkBudget(t, distanceM, requiredMarginDb, exponent));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
