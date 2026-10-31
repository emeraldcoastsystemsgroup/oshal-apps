"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the Feetech STS/SCS bus servo protocol for the
    |                                           | spider-18's eighteen STS3215 servos (ADR-202, lane L4), minimal and
    |                                           | dependency-free: it talks to any file-like port it is handed (a
    |                                           | pyserial Serial, the FdPort below over os.open, or a test fake), so
    |                                           | pyserial is NOT a requirement of the engine image or the Pi.
    |                                           | Protocol followed: "FEETECH SCS Protocol" (AIFITLAB wiki,
    |                                           | feetech-servo-motor-docs/feetech-scs-protocol, read 2026-10-29):
    |                                           | header FF FF, ID, Length = N + 2, Instruction, Parameters,
    |                                           | Checksum = ~(ID + Length + Instruction + Parameters) low byte;
    |                                           | PING 0x01, READ 0x02, WRITE 0x03, SYNC WRITE 0x83 to the broadcast
    |                                           | id 0xFE with Length (L + 1) * n + 4; the status frame is FF FF ID
    |                                           | Length Error Parameters Checksum; magnetic-encoder servos (the
    |                                           | STS3215 is one: a 12-bit magnetic encoder, 4096 steps a turn) carry
    |                                           | two-byte values low byte first. Addresses: Torque Enable 40, Goal
    |                                           | Position 42 then two reserved bytes then Goal Speed 46 (that page's
    |                                           | Example 4 writes six bytes from 0x2A as position, reserved, speed,
    |                                           | which is the sync-write row used here), Present Position 56 (0x38),
    |                                           | and from the page's SYNC READ example (eight bytes from 0x38 are
    |                                           | position, speed, load, voltage, temperature) Present Speed 58,
    |                                           | Present Load 60, Present Voltage 62, Present Temperature 63; the
    |                                           | 40/41/42/46/56 values agree with the LeRobot-Arena feetech.js
    |                                           | constants file. HARDWARE WAS NOT AVAILABLE: every packet here is
    |                                           | proven against hand-computed bytes on a fake port only, and the
    |                                           | load sign bit (bit 10) and the load-to-torque scale are the SDK's
    |                                           | conventions, unverified on a servo. The calibration table (per-id
    |                                           | offset and direction) is a placeholder until a robot is calibrated.
"""
from __future__ import annotations

import json
import math
import os
import select
import struct
import time
from dataclasses import dataclass, field

from hexapod_spec import ACTUATOR_COUNT, ACTUATOR_ORDER, LIMITS_RAD, clamp_targets, joint_of_index

HEADER = b"\xff\xff"
BROADCAST_ID = 0xFE
INST_PING = 0x01
INST_READ = 0x02
INST_WRITE = 0x03
INST_SYNC_WRITE = 0x83
ADDR_TORQUE_ENABLE = 40
ADDR_GOAL_POSITION = 42
ADDR_GOAL_SPEED = 46
ADDR_PRESENT_POSITION = 56
ADDR_PRESENT_SPEED = 58
ADDR_PRESENT_LOAD = 60
ADDR_PRESENT_VOLTAGE = 62
ADDR_PRESENT_TEMPERATURE = 63
GOAL_ROW_BYTES = 6  # position L/H, reserved L/H, speed L/H from ADDR_GOAL_POSITION
STEPS_PER_REV = 4096
CENTER_STEPS = 2048
MAX_SPEED_STEPS_PER_S = 3400  # the STS3215's rated no-load speed is about 50 rpm = 3413 steps/s
DEFAULT_SPEED_STEPS_PER_S = 1500
LOAD_SIGN_BIT = 0x400  # the SDK's convention: bits 0-9 magnitude, bit 10 direction. Unverified on hardware.
LOAD_FULL_SCALE = 1000.0
STALL_TORQUE_NM = 2.94  # the owned servo row sts3215-12v (parts-catalog.json)
LATCH_SERVO_ID = 19  # reserved: the latched-spring wind/trip servo, beyond the 18 leg ids
SERVO_IDS: tuple[int, ...] = tuple(range(1, ACTUATOR_COUNT + 1))  # id i+1 drives ACTUATOR_ORDER[i]
STATUS_OVERHEAD = 6  # FF FF ID LEN ERR ... CHK: everything but the parameters
DEFAULT_TIMEOUT_S = 0.05


class BusError(Exception):
    """@description A packet that could not be framed, sent or understood: the id, the reason, never silent."""


def checksum(body: bytes) -> int:
    """@description The protocol's checksum: the bitwise NOT of the sum of ID, Length, Instruction and every parameter,
    low byte only. @param body Those bytes, header excluded. @returns 0-255."""
    return (~sum(body)) & 0xFF


def frame(servo_id: int, instruction: int, params: bytes = b"") -> bytes:
    """@description One instruction packet: FF FF ID LEN INST PARAMS CHK with LEN = len(params) + 2.
    @param servo_id 0-253 or the broadcast id. @param instruction The instruction code. @param params Its parameters.
    @returns The bytes to write."""
    if not 0 <= servo_id <= BROADCAST_ID:
        raise BusError(f"servo id {servo_id} is outside 0-254")
    if len(params) > 250:
        raise BusError(f"{len(params)} parameter bytes do not fit one packet")
    body = bytes([servo_id, len(params) + 2, instruction]) + params
    return HEADER + body + bytes([checksum(body)])


def encode_u16(value: int) -> bytes:
    """@description A two-byte value low byte first, as the magnetic-encoder servos read it. @param value 0-65535. @returns Two bytes."""
    if not 0 <= value <= 0xFFFF:
        raise BusError(f"{value} does not fit two bytes")
    return struct.pack("<H", value)


def decode_u16(data: bytes) -> int:
    """@description The inverse of encode_u16. @param data Two bytes, low first. @returns 0-65535."""
    if len(data) != 2:
        raise BusError(f"expected two bytes, got {len(data)}")
    return struct.unpack("<H", data)[0]


def ping_packet(servo_id: int) -> bytes:
    """@description PING: FF FF ID 02 01 CHK. @param servo_id The servo. @returns The packet."""
    return frame(servo_id, INST_PING)


def read_packet(servo_id: int, address: int, count: int) -> bytes:
    """@description READ DATA: the start address and how many bytes. @param servo_id The servo. @param address Memory address. @param count Bytes. @returns The packet."""
    return frame(servo_id, INST_READ, bytes([address & 0xFF, count & 0xFF]))


def write_packet(servo_id: int, address: int, data: bytes) -> bytes:
    """@description WRITE DATA: the start address and the bytes. @param servo_id The servo. @param address Memory address. @param data The bytes. @returns The packet."""
    return frame(servo_id, INST_WRITE, bytes([address & 0xFF]) + data)


def sync_write_packet(address: int, rows: list[tuple[int, bytes]]) -> bytes:
    """@description SYNC WRITE to the broadcast id: the start address, the per-servo data length L, then (id, L bytes)
    for each servo; the Length byte is (L + 1) * n + 4, as the protocol states it.
    @param address The start address every row writes from. @param rows (servo id, data) pairs, every data the same length.
    @returns The packet."""
    if not rows:
        raise BusError("a sync write needs at least one row")
    width = len(rows[0][1])
    params = bytearray([address & 0xFF, width])
    for servo_id, data in rows:
        if len(data) != width:
            raise BusError(f"servo {servo_id}: every sync-write row must carry {width} bytes, got {len(data)}")
        if not 0 <= servo_id < BROADCAST_ID:
            raise BusError(f"servo id {servo_id} cannot be a sync-write row")
        params.append(servo_id)
        params += data
    packet = frame(BROADCAST_ID, INST_SYNC_WRITE, bytes(params))
    assert packet[3] == (width + 1) * len(rows) + 4, "the protocol's length formula"
    return packet


def goal_row(position_steps: int, speed_steps_per_s: int) -> bytes:
    """@description The six bytes from Goal Position: position, the two reserved bytes, speed (each low byte first).
    @param position_steps 0-4095. @param speed_steps_per_s 0-MAX_SPEED. @returns Six bytes."""
    position = min(STEPS_PER_REV - 1, max(0, int(round(position_steps))))
    speed = min(MAX_SPEED_STEPS_PER_S, max(0, int(round(speed_steps_per_s))))
    return encode_u16(position) + b"\x00\x00" + encode_u16(speed)


def parse_status(data: bytes) -> tuple[int, int, bytes]:
    """@description A status packet taken apart and checked: header, length against the bytes, checksum.
    @param data The whole packet. @returns (servo id, error byte, parameters)."""
    if len(data) < STATUS_OVERHEAD or data[:2] != HEADER:
        raise BusError(f"not a status packet: {data.hex()}")
    servo_id, length = data[2], data[3]
    if len(data) != length + 4:
        raise BusError(f"servo {servo_id}: status length {length} does not match {len(data)} bytes")
    if checksum(data[2:-1]) != data[-1]:
        raise BusError(f"servo {servo_id}: status checksum mismatch")
    return servo_id, data[4], bytes(data[5:-1])


def signed_load(raw: int) -> int:
    """@description A Present Load value as a signed magnitude (bit 10 the direction), the SDK's reading of the register.
    @param raw The 16-bit register. @returns -1023..1023."""
    magnitude = raw & (LOAD_SIGN_BIT - 1)
    return -magnitude if raw & LOAD_SIGN_BIT else magnitude


def load_to_torque_nm(raw: int) -> float:
    """@description The load register as a torque, taking the register as thousandths of the servo's stall torque
    (the SDK's scale; unverified on hardware). @param raw The register. @returns N·m, signed."""
    return signed_load(raw) / LOAD_FULL_SCALE * STALL_TORQUE_NM


@dataclass
class Calibration:
    """@description Per-servo encoder calibration: the step the servo reads at the spec's zero pose and which way a
    positive radian turns it. Defaults are placeholders (zero at the encoder centre, every direction +1) until the robot
    is calibrated; load a table with `from_json`."""

    offset_steps: dict[int, int] = field(default_factory=dict)
    direction: dict[int, int] = field(default_factory=dict)

    @classmethod
    def from_json(cls, path: str) -> "Calibration":
        """@description A calibration file: {"offsetSteps": {"1": 12, ...}, "direction": {"1": -1, ...}}. @param path The file. @returns The table."""
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        offsets = {int(k): int(v) for k, v in (raw.get("offsetSteps") or {}).items()}
        directions = {int(k): int(v) for k, v in (raw.get("direction") or {}).items()}
        for servo_id, d in directions.items():
            if d not in (1, -1):
                raise BusError(f"calibration: direction of servo {servo_id} must be 1 or -1")
        return cls(offsets, directions)

    def rad_to_steps(self, servo_id: int, radians: float) -> int:
        """@description A joint angle as the servo's goal step. @param servo_id 1-18. @param radians About the spec's zero. @returns 0-4095."""
        steps = CENTER_STEPS + self.offset_steps.get(servo_id, 0) + self.direction.get(servo_id, 1) * radians * STEPS_PER_REV / (2 * math.pi)
        return min(STEPS_PER_REV - 1, max(0, int(round(steps))))

    def steps_to_rad(self, servo_id: int, steps: int) -> float:
        """@description The inverse: a present-position step as the joint angle. @param servo_id 1-18. @param steps 0-4095. @returns Radians."""
        return self.direction.get(servo_id, 1) * (steps - CENTER_STEPS - self.offset_steps.get(servo_id, 0)) * (2 * math.pi) / STEPS_PER_REV


def targets_to_rows(targets_rad, calibration: Calibration, speed_steps_per_s: int = DEFAULT_SPEED_STEPS_PER_S) -> list[tuple[int, bytes]]:
    """@description Eighteen clamped targets as the sync-write rows (ids 1-18 in ACTUATOR_ORDER).
    @param targets_rad The targets. @param calibration The table. @param speed_steps_per_s One speed for every servo.
    @returns The rows for sync_write_packet."""
    clamped = clamp_targets(targets_rad)
    return [(servo_id, goal_row(calibration.rad_to_steps(servo_id, clamped[i]), speed_steps_per_s)) for i, servo_id in enumerate(SERVO_IDS)]


def limit_steps(servo_id: int, calibration: Calibration) -> tuple[int, int]:
    """@description The contract's limits of a servo's joint, in that servo's steps (ordered low to high).
    @param servo_id 1-18. @param calibration The table. @returns (low, high)."""
    lo, hi = LIMITS_RAD[joint_of_index(servo_id - 1)]
    a, b = calibration.rad_to_steps(servo_id, lo), calibration.rad_to_steps(servo_id, hi)
    return (min(a, b), max(a, b))


class FdPort:
    """@description A port over a raw file descriptor (os.open of /dev/ttyUSB0) with a read timeout via select, so the
    bus needs no pyserial. `open` configures the line (8N1, no flow control, the baud) through termios."""

    def __init__(self, fd: int, timeout_s: float = DEFAULT_TIMEOUT_S) -> None:
        self.fd = fd
        self.timeout_s = timeout_s

    @classmethod
    def open(cls, path: str, baud: int = 1_000_000, timeout_s: float = DEFAULT_TIMEOUT_S) -> "FdPort":
        """@description Open and configure a serial device. @param path The device. @param baud The bus rate. @param timeout_s Read timeout. @returns The port."""
        import termios  # Linux only, where the Pi runs
        fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        attrs = termios.tcgetattr(fd)
        rate = getattr(termios, f"B{baud}", None)
        if rate is None:
            raise BusError(f"baud {baud} is not a termios rate")
        attrs[0] = 0  # iflag: raw
        attrs[1] = 0  # oflag: raw
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL  # 8N1, no flow control
        attrs[3] = 0  # lflag: raw
        attrs[4] = attrs[5] = rate
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        termios.tcflush(fd, termios.TCIOFLUSH)
        return cls(fd, timeout_s)

    def write(self, data: bytes) -> int:
        return os.write(self.fd, data)

    def read(self, count: int) -> bytes:
        """@description Up to `count` bytes within the timeout; fewer when the line goes quiet. @param count Bytes wanted. @returns What arrived."""
        out = bytearray()
        deadline = time.monotonic() + self.timeout_s
        while len(out) < count:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            ready, _, _ = select.select([self.fd], [], [], remaining)
            if not ready:
                break
            chunk = os.read(self.fd, count - len(out))
            if not chunk:
                break
            out += chunk
        return bytes(out)

    def close(self) -> None:
        os.close(self.fd)


class ServoBus:
    """@description The bus: one port, the packets, the replies. Every method raises BusError rather than returning a
    half-read value; a sync write expects no reply (the protocol states none)."""

    def __init__(self, port, calibration: Calibration | None = None) -> None:
        self.port = port
        self.calibration = calibration or Calibration()
        self.sent = 0
        self.errors = 0

    def _write(self, packet: bytes) -> None:
        self.port.write(packet)
        self.sent += 1

    def _read_status(self, servo_id: int, param_count: int) -> bytes:
        """@description One status packet for `servo_id` with `param_count` parameters, checked. @returns The parameters."""
        want = STATUS_OVERHEAD + param_count
        data = self.port.read(want)
        if len(data) < want:
            self.errors += 1
            raise BusError(f"servo {servo_id}: no reply ({len(data)} of {want} bytes)")
        rid, error, params = parse_status(data[:want])
        if rid != servo_id:
            self.errors += 1
            raise BusError(f"servo {servo_id}: reply from servo {rid}")
        if error:
            self.errors += 1
            raise BusError(f"servo {servo_id}: status error 0x{error:02x}")
        return params

    def ping(self, servo_id: int) -> bool:
        """@description Whether a servo answers a PING. @param servo_id The servo. @returns True when it replied cleanly."""
        self._write(ping_packet(servo_id))
        try:
            self._read_status(servo_id, 0)
            return True
        except BusError:
            return False

    def torque(self, servo_ids, enabled: bool) -> None:
        """@description Torque Enable on or off for the servos, one sync write (no replies). @param servo_ids The ids. @param enabled On or off."""
        self._write(sync_write_packet(ADDR_TORQUE_ENABLE, [(sid, bytes([1 if enabled else 0])) for sid in servo_ids]))

    def write_goal(self, servo_id: int, position_steps: int, speed_steps_per_s: int) -> None:
        """@description One servo's goal position and speed (WRITE DATA; the reply is read and checked).
        @param servo_id The servo. @param position_steps 0-4095. @param speed_steps_per_s The speed."""
        self._write(write_packet(servo_id, ADDR_GOAL_POSITION, goal_row(position_steps, speed_steps_per_s)))
        self._read_status(servo_id, 0)

    def sync_write_targets(self, targets_rad, speed_steps_per_s: int = DEFAULT_SPEED_STEPS_PER_S) -> bytes:
        """@description All eighteen leg servos' goals in ONE packet, the targets clamped to the contract's limits.
        @param targets_rad Eighteen radians in ACTUATOR_ORDER. @param speed_steps_per_s One speed for all. @returns The packet sent."""
        packet = sync_write_packet(ADDR_GOAL_POSITION, targets_to_rows(targets_rad, self.calibration, speed_steps_per_s))
        self._write(packet)
        return packet

    def read_u16(self, servo_id: int, address: int) -> int:
        """@description One two-byte register. @param servo_id The servo. @param address The register. @returns Its value."""
        self._write(read_packet(servo_id, address, 2))
        return decode_u16(self._read_status(servo_id, 2))

    def read_position_steps(self, servo_id: int) -> int:
        """@description Present Position. @param servo_id The servo. @returns 0-4095."""
        return self.read_u16(servo_id, ADDR_PRESENT_POSITION)

    def read_position_rad(self, servo_id: int) -> float:
        """@description Present Position as the joint angle through the calibration. @param servo_id The servo. @returns Radians."""
        return self.calibration.steps_to_rad(servo_id, self.read_position_steps(servo_id))

    def read_load(self, servo_id: int) -> int:
        """@description Present Load, signed (bit 10 the direction). @param servo_id The servo. @returns -1023..1023."""
        return signed_load(self.read_u16(servo_id, ADDR_PRESENT_LOAD))

    def read_all_positions_rad(self) -> list[float]:
        """@description Every leg joint's present angle, ids 1-18 in ACTUATOR_ORDER. @returns Eighteen radians."""
        return [self.read_position_rad(sid) for sid in SERVO_IDS]

    def read_all_loads(self) -> list[int]:
        """@description Every leg joint's present load. @returns Eighteen signed loads."""
        return [self.read_load(sid) for sid in SERVO_IDS]

    def scan(self, servo_ids=SERVO_IDS) -> list[int]:
        """@description The ids that answer a ping. @param servo_ids The ids to try. @returns The ones that replied."""
        return [sid for sid in servo_ids if self.ping(sid)]


assert len(ACTUATOR_ORDER) == len(SERVO_IDS), "one servo id per actuator"
