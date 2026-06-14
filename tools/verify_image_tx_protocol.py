#!/usr/bin/env python3
"""Host-side verification for HeptaImageTx CRC and packet counts."""

from __future__ import annotations

import struct
import sys


def crc16_ccitt_false(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def calc_packet_crc(pkt_type: int, seq: int, total: int, length: int, payload: bytes) -> int:
    body = struct.pack("<BHHH", pkt_type, seq, total, length) + payload
    return crc16_ccitt_false(body)


TEST_JPEG = bytes([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x08, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0x7F, 0xFF, 0xD9,
])

PAYLOAD_MAX = 64


def main() -> int:
    failures = 0

    vector_crc = crc16_ccitt_false(b"123456789")
    if vector_crc != 0x29B1:
        print(f"FAIL: CRC test vector got 0x{vector_crc:04X}, expected 0x29B1")
        failures += 1
    else:
        print("PASS: CRC-16/CCITT-FALSE test vector")

    image_size = len(TEST_JPEG)
    image_crc = crc16_ccitt_false(TEST_JPEG)
    data_packet_count = (image_size + PAYLOAD_MAX - 1) // PAYLOAD_MAX
    total_packet_count = data_packet_count + 3

    expected_data_packet_count = 3
    expected_total_packet_count = expected_data_packet_count + 3
    if total_packet_count != expected_total_packet_count:
        print(
            "FAIL: test JPEG "
            f"total_packet_count={total_packet_count}, "
            f"expected {expected_total_packet_count}"
        )
        failures += 1
    else:
        print(
            "PASS: test JPEG packet count "
            f"(START + {data_packet_count} DATA + PARITY + END)"
        )

    start_payload = struct.pack("<BHIHH", 0x01, 0, image_size, image_crc, PAYLOAD_MAX)
    start_crc = calc_packet_crc(0x01, 0, total_packet_count, len(start_payload), start_payload)
    print(f"INFO: START packet CRC=0x{start_crc:04X}, image_crc=0x{image_crc:04X}")

    first_data_payload = TEST_JPEG[:PAYLOAD_MAX]
    data_len = len(first_data_payload)
    data_crc = calc_packet_crc(
        0x02,
        1,
        total_packet_count,
        data_len,
        first_data_payload,
    )
    print(f"INFO: DATA packet CRC=0x{data_crc:04X}, len={data_len}")

    parity = bytearray(PAYLOAD_MAX)
    for offset in range(0, image_size, PAYLOAD_MAX):
        for index, byte in enumerate(TEST_JPEG[offset:offset + PAYLOAD_MAX]):
            parity[index] ^= byte
    parity_seq = data_packet_count + 1
    parity_crc = calc_packet_crc(
        0x05, parity_seq, total_packet_count, len(parity), bytes(parity)
    )
    print(f"INFO: PARITY packet CRC=0x{parity_crc:04X}, len={len(parity)}")

    end_crc = calc_packet_crc(0x03, total_packet_count - 1, total_packet_count, 0, b"")
    print(f"INFO: END packet CRC=0x{end_crc:04X}")

    if TEST_JPEG[:2] != b"\xFF\xD8" or TEST_JPEG[-2:] != b"\xFF\xD9":
        print("FAIL: test JPEG missing SOI/EOI markers")
        failures += 1
    else:
        print("PASS: test JPEG SOI/EOI markers")

    if failures:
        print(f"\n{failures} check(s) failed")
        return 1

    print("\nAll protocol checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
