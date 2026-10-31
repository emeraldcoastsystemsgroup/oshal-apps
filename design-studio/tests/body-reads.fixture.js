/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D6, lane @ds-app: the bound reads the route suite and the browser fixture share - engine reply excerpts in the shape tools/design-studio-stages.js records them (the design's servo row and joint rows, the plant's timestep and the eighteen joint ranges parsed from the MJCF, the certificate, the node, the senses). Fixture numbers, labelled as such: the suites trace every body-contract value back to them, which is the proof that the contract copies nothing of its own.
 */
'use strict';

const LEGS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
/** The fixture's joint ranges in radians, one pair per joint type (the plant's MJCF would carry these on every leg). */
const RANGE = { coxa: [-1.0472, 1.0472], femur: [-2.0944, 2.0944], tibia: [-2.4435, 2.4435] };

const reads = {
  design: {
    route: '/api/embodied/build/hexapod?fit=spider-18', readAt: '2026-10-30T20:00:00.000Z', revision: 'fixture-design-1',
    servo: { id: 'sts3215-12v', name: 'fixture bus servo', stallNm: 2.942, noLoadRadS: 4.7166 },
    limitsDeg: { coxaDeg: [-60, 60], femurDeg: [-120, 120], tibiaDeg: [-140, 140] }, servoCount: 18,
    joints: [{ joint: 'coxa', nm: 1.15, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }, { joint: 'femur', nm: 1.43, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }, { joint: 'tibia', nm: 1.0, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }],
    massBudget: { totalG: 2019, targetG: 2100, withinTarget: true }, printed: 13, programs: 13,
  },
  simulate: {
    route: '/api/embodied/physics/reports', readAt: '2026-10-30T20:00:01.000Z',
    report: { file: 'hexapod-walk-shape-seed1.json', task: 'hexapod-walk', seed: 1, mode: 'shape', policyFile: 'hexapod-walk-ppo-shape-seed1.zip' },
    certificate: { file: 'hexapod-walk-ppo-shape-seed1.certificate.json', policyFile: 'hexapod-walk-ppo-shape-seed1.zip', policySha256: 'fixture-sha-d15f6a7d2048e7ce', buildHash: 'fixture-build-7346d37a', ok: true, checked: 1631, refusedCount: 0, certifiedAt: '2026-10-30T15:33:00.000Z' },
    plant: { route: '/api/embodied/physics/hexapod/mjcf?fit=spider-18&jump=legs-hop', readAt: '2026-10-30T20:00:01.000Z', physicsDt: 0.002, joints: LEGS.flatMap((leg) => ['coxa', 'femur', 'tibia'].map((j) => ({ name: `${leg}-${j}`, rangeRad: RANGE[j] }))), actuators: LEGS.flatMap((leg) => ['coxa', 'femur', 'tibia'].map((j) => `${leg}-${j}`)) },
    brain: 'walker',
  },
  controller: {
    route: '/api/embodied/physics/status', readAt: '2026-10-30T20:00:02.000Z',
    engine: { connected: true, engine: 'mujoco', version: '3.3.5', buildHash: 'fixture-build-7346d37a' },
    node: { nodeId: 'spider-pi', kind: 'hexapod', online: true, engine: 'hexapod-node', version: '0.1.0', endpoint: 'http://spider-pi.local:7421', tickHz: 50 },
  },
  sensors: {
    route: '/api/embodied/build/hexapod?fit=spider-18', readAt: '2026-10-30T20:00:03.000Z',
    senses: [{ name: 'lidar', present: true, row: { id: 'ld19-lidar', name: 'fixture LiDAR ring' }, mount: 'Head (LiDAR nose)' }, { name: 'imu', present: true, row: { id: 'bno055-imu', name: 'fixture IMU' }, mount: null }, { name: 'joints', present: true, count: 18, reader: 'the node (joint feedback on the servo bus)' }],
  },
};

module.exports = { reads, LEGS, RANGE };
