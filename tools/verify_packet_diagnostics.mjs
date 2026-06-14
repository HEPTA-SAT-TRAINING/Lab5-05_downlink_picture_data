import assert from "node:assert/strict";
import {
  PacketReceiver,
  buildCrcInput,
  PACKET_TYPE_DATA,
} from "../docs/packet.js";
import { crc16CcittFalse } from "../docs/crc16.js";

function writeLe16(buffer, offset, value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function makePacket(seq, payload) {
  const packet = new Uint8Array(11 + payload.length);
  packet[0] = 0x48;
  packet[1] = 0x50;
  packet[2] = PACKET_TYPE_DATA;
  writeLe16(packet, 3, seq);
  writeLe16(packet, 5, 4);
  writeLe16(packet, 7, payload.length);
  const crc = crc16CcittFalse(
    buildCrcInput(PACKET_TYPE_DATA, seq, 4, payload.length, payload)
  );
  writeLe16(packet, 9, crc);
  packet.set(payload, 11);
  return packet;
}

const damaged = makePacket(1, new Uint8Array([0x10, 0x20, 0x30]));
damaged[11] ^= 0xff;
const valid = makePacket(2, new Uint8Array([0x40, 0x50, 0x60]));

const stream = new Uint8Array(damaged.length + valid.length);
stream.set(damaged);
stream.set(valid, damaged.length);

const receiver = new PacketReceiver();
const packets = receiver.push(stream);
const errors = receiver.drainErrors();

assert.equal(packets.length, 1);
assert.equal(packets[0].seq, 2);
assert.equal(errors.length, 1);
assert.match(errors[0], /^Discarded packet seq=1: CRC mismatch:/);
assert.deepEqual(receiver.drainErrors(), []);

const footer = new TextEncoder().encode("\nIMG_END\n");
receiver.reset();
receiver.push(footer.subarray(0, 4));
assert.equal(receiver.drainFooterCount(), 0);
receiver.push(footer.subarray(4));
assert.equal(receiver.drainFooterCount(), 1);

console.log("PASS: discarded packet diagnostics identify sequence and CRC error");
