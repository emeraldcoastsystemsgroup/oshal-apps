"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the Feetech bus protocol (ADR-202, lane L4)
    |                                           | on a fake port: framing and checksum against hand-computed bytes
    |                                           | (the protocol page's own PING and READ examples among them), the
    |                                           | sync-write layout for all eighteen ids, the status parse and its
    |                                           | refusals, the encoder-to-radian round trip through offsets and
    |                                           | directions, the clamp to the contract's limits, the load sign and
    |                                           | torque scale, torque enable, and the latch servo's goal write.
    |                                           | Runs itself (python file.py): the engine image has no pytest.
    |                                           | No hardware was involved; this is the protocol on bytes only.
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
import hexapod_bus as B  # noqa: E402
from hexapod_spec import ACTUATOR_COUNT, LIMITS_RAD, clamp_targets  # noqa: E402

STEP_RAD = 2 * math.pi / B.STEPS_PER_REV


class FakePort:
    """A port that records every write and serves queued replies, byte-exact."""

    def __init__(self) -> None:
        self.written: list[bytes] = []
        self.inbox = bytearray()

    def write(self, data: bytes) -> int:
        self.written.append(bytes(data))
        return len(data)

    def read(self, count: int) -> bytes:
        out = bytes(self.inbox[:count])
        del self.inbox[:count]
        return out

    def reply(self, data: bytes) -> None:
        self.inbox += data


def status(servo_id: int, error: int, params: bytes) -> bytes:
    body = bytes([servo_id, len(params) + 2, error]) + params
    return B.HEADER + body + bytes([B.checksum(body)])


def test_ping_and_read_frames_are_the_protocol_pages_examples() -> None:
    assert B.ping_packet(1).hex() == "ffff010201fb", "PING id 1: ~(01+02+01) = FB"
    assert B.read_packet(1, B.ADDR_PRESENT_POSITION, 2).hex() == "ffff0104023802be", "READ two bytes at 0x38 from id 1: ~(01+04+02+38+02) = BE"
    assert B.write_packet(3, B.ADDR_TORQUE_ENABLE, b"\x01").hex() == "ffff0304032801cc", "WRITE torque enable 1 to id 3: ~(03+04+03+28+01) = CC"
    assert B.checksum(bytes([0x01, 0x02, 0x01])) == 0xFB
    assert B.encode_u16(0x0518) == b"\x18\x05" and B.decode_u16(b"\x18\x05") == 0x0518, "low byte first"
    for bad in (-1, 70000):
        try:
            B.encode_u16(bad)
            raise AssertionError("encode_u16 accepted an out-of-range value")
        except B.BusError:
            pass


def test_sync_write_layout_is_hand_computed_and_covers_all_eighteen_ids() -> None:
    two = B.sync_write_packet(B.ADDR_GOAL_POSITION, [(1, B.goal_row(2048, 1000)), (2, B.goal_row(1024, 500))])
    assert two.hex() == "fffffe12832a06" + "010008" + "0000e803" + "020004" + "0000f401" + "4d", two.hex()
    assert two[3] == (6 + 1) * 2 + 4 == 0x12, "Length = (L + 1) * n + 4"
    rows = B.targets_to_rows([0.0] * ACTUATOR_COUNT, B.Calibration(), 1500)
    packet = B.sync_write_packet(B.ADDR_GOAL_POSITION, rows)
    assert packet[:7] == bytes([0xFF, 0xFF, 0xFE, (6 + 1) * 18 + 4, 0x83, 0x2A, 0x06])
    assert packet[3] == 130 and len(packet) == 4 + 130
    for i in range(ACTUATOR_COUNT):
        row = packet[7 + i * 7: 7 + (i + 1) * 7]
        assert row[0] == i + 1, "ids 1-18 in ACTUATOR_ORDER"
        assert row[1:7] == B.encode_u16(2048) + b"\x00\x00" + B.encode_u16(1500), "zero pose at the encoder centre, the reserved bytes zero, the speed"
    assert B.checksum(packet[2:-1]) == packet[-1]
    assert B.goal_row(5000, 99999) == B.encode_u16(4095) + b"\x00\x00" + B.encode_u16(B.MAX_SPEED_STEPS_PER_S), "a goal row never leaves the encoder or the speed range"
    for bad_rows in ([], [(1, b"\x00"), (2, b"\x00\x00")], [(B.BROADCAST_ID, b"\x00")]):
        try:
            B.sync_write_packet(B.ADDR_GOAL_POSITION, bad_rows)
            raise AssertionError(f"sync_write_packet accepted {bad_rows!r}")
        except B.BusError:
            pass


def test_status_parse_reads_and_every_refusal() -> None:
    port = FakePort()
    bus = B.ServoBus(port)
    port.reply(bytes.fromhex("ffff0104001805dd"))  # the page's READ example reply: 0x0518 low byte first
    assert bus.read_position_steps(1) == 0x0518 == 1304
    assert port.written[-1] == B.read_packet(1, B.ADDR_PRESENT_POSITION, 2)
    port.reply(status(7, 0, B.encode_u16(0x400 | 250)))
    assert bus.read_load(7) == -250, "bit 10 is the load's direction"
    port.reply(status(1, 0, b""))
    assert bus.ping(1) is True
    assert bus.ping(2) is False, "silence is not a reply"
    port.reply(status(2, 0, b"") )
    try:
        bus.read_u16(1, B.ADDR_PRESENT_POSITION)
        raise AssertionError("a reply from another id was accepted")
    except B.BusError:
        pass
    port.inbox.clear()
    port.reply(status(1, 0x20, B.encode_u16(1)))
    try:
        bus.read_u16(1, B.ADDR_PRESENT_LOAD)
        raise AssertionError("a status error byte was accepted")
    except B.BusError as error:
        assert "0x20" in str(error)
    bad = bytearray(status(1, 0, B.encode_u16(1)))
    bad[-1] ^= 0xFF
    try:
        B.parse_status(bytes(bad))
        raise AssertionError("a bad checksum was accepted")
    except B.BusError:
        pass
    for junk in (b"", b"\xff\xfe\x01\x02\x00\xfc", status(1, 0, b"") + b"\x00"):
        try:
            B.parse_status(junk)
            raise AssertionError(f"parse_status accepted {junk!r}")
        except B.BusError:
            pass
    assert bus.errors == 3 and bus.sent == 6


def test_encoder_and_radian_round_trip_through_offsets_and_directions() -> None:
    cal = B.Calibration(offset_steps={1: 12, 2: -40}, direction={2: -1})
    assert cal.rad_to_steps(1, 0.0) == 2048 + 12 and cal.rad_to_steps(2, 0.0) == 2048 - 40 and cal.rad_to_steps(5, 0.0) == 2048
    assert cal.rad_to_steps(1, math.pi / 2) == 2048 + 12 + 1024, "a quarter turn is 1024 steps"
    assert cal.rad_to_steps(2, math.pi / 2) == 2048 - 40 - 1024, "direction -1 turns the other way"
    for sid in (1, 2, 5):
        for rad in (-2.0, -0.5, 0.0, 0.3, 1.0, 2.4):
            back = cal.steps_to_rad(sid, cal.rad_to_steps(sid, rad))
            assert abs(back - rad) <= STEP_RAD / 2 + 1e-12, (sid, rad, back)
    assert cal.rad_to_steps(1, 9.0) == 4095 and cal.rad_to_steps(1, -9.0) == 0, "a step never leaves the encoder"
    lo, hi = B.limit_steps(2, cal)
    assert lo < hi and lo == cal.rad_to_steps(2, LIMITS_RAD["femur"][1]) and hi == cal.rad_to_steps(2, LIMITS_RAD["femur"][0]), "a reversed servo's limits swap order"
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "cal.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"offsetSteps": {"3": 7}, "direction": {"3": -1}}, fh)
        loaded = B.Calibration.from_json(path)
        assert loaded.offset_steps == {3: 7} and loaded.direction == {3: -1}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"direction": {"3": 2}}, fh)
        try:
            B.Calibration.from_json(path)
            raise AssertionError("a direction of 2 was accepted")
        except B.BusError:
            pass


def test_targets_are_clamped_to_the_contracts_limits_before_any_byte_is_written() -> None:
    wild = [9.0, -9.0, 9.0] * 6
    clamped = clamp_targets(wild)
    assert clamped[0] == LIMITS_RAD["coxa"][1] and clamped[1] == LIMITS_RAD["femur"][0] and clamped[2] == LIMITS_RAD["tibia"][1]
    port = FakePort()
    bus = B.ServoBus(port)
    packet = bus.sync_write_targets(wild, 1200)
    assert port.written == [packet]
    cal = B.Calibration()
    assert B.decode_u16(packet[8:10]) == cal.rad_to_steps(1, LIMITS_RAD["coxa"][1]) == 2048 + round(60 / 360 * 4096)
    assert B.decode_u16(packet[15:17]) == cal.rad_to_steps(2, LIMITS_RAD["femur"][0])
    for bad in ([float("nan")] * 18, [0.0] * 17):
        try:
            bus.sync_write_targets(bad)
            raise AssertionError("a bad target set reached the port")
        except ValueError:
            pass
    assert len(port.written) == 1


def test_load_sign_torque_scale_torque_enable_and_the_latch_write() -> None:
    assert B.signed_load(100) == 100 and B.signed_load(0x400 | 100) == -100 and B.signed_load(0x400) == 0
    assert abs(B.load_to_torque_nm(1000) - B.STALL_TORQUE_NM) < 1e-12 and abs(B.load_to_torque_nm(0x400 | 500) + B.STALL_TORQUE_NM / 2) < 1e-12
    port = FakePort()
    bus = B.ServoBus(port)
    bus.torque(B.SERVO_IDS, True)
    packet = port.written[-1]
    assert packet[:7] == bytes([0xFF, 0xFF, 0xFE, (1 + 1) * 18 + 4, 0x83, B.ADDR_TORQUE_ENABLE, 0x01])
    assert list(packet[7:-1:2]) == list(B.SERVO_IDS) and set(packet[8:-1:2]) == {1}
    bus.torque([19], False)
    assert port.written[-1][7:9] == bytes([19, 0])
    port.reply(status(B.LATCH_SERVO_ID, 0, b""))
    bus.write_goal(B.LATCH_SERVO_ID, 3072, 600)
    assert port.written[-1] == B.write_packet(19, B.ADDR_GOAL_POSITION, B.goal_row(3072, 600))
    assert port.written[-1].hex() == "ffff1309032a000c0000580250", "WRITE six bytes from 0x2A to id 19: 3072 = 0x0C00, 600 = 0x0258, ~(13+09+03+2a+0c+58+02) = 50"
    assert len(port.inbox) == 0, "the WRITE's status reply was consumed"
    assert B.LATCH_SERVO_ID == 19 and B.LATCH_SERVO_ID not in B.SERVO_IDS, "the latch servo's id is reserved beyond the eighteen legs"


if __name__ == "__main__":  # the shipped engine image has no pytest
    import traceback

    names = sorted(name for name, value in list(globals().items()) if name.startswith("test_") and callable(value))
    if not names:
        print("FAIL: no test_* function was discovered in this module", file=sys.stderr)
        raise SystemExit(2)
    failures = 0
    for name in names:
        try:
            globals()[name]()
        except BaseException:  # every failure shape is reported
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print(f"{len(names) - failures} passed, {failures} failed")
    raise SystemExit(1 if failures else 0)
