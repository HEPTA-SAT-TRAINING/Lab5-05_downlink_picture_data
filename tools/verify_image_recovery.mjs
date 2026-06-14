import assert from "node:assert/strict";
import { crc16CcittFalse } from "../docs/crc16.js";
import { ImageAssembler } from "../docs/image_assembler.js";
import {
  PACKET_TYPE_DATA,
  PACKET_TYPE_END,
  PACKET_TYPE_PARITY,
  PACKET_TYPE_START,
} from "../docs/packet.js";

const payloadSize = 4;
const image = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const data = [
  image.slice(0, 4),
  image.slice(4, 8),
  image.slice(8),
];
const total = data.length + 3;
const parity = new Uint8Array(payloadSize);
for (const payload of data) {
  payload.forEach((byte, index) => {
    parity[index] ^= byte;
  });
}

function startPacket() {
  const payload = new Uint8Array(11);
  const view = new DataView(payload.buffer);
  payload[0] = 1;
  view.setUint16(1, 7, true);
  view.setUint32(3, image.length, true);
  view.setUint16(7, crc16CcittFalse(image), true);
  view.setUint16(9, payloadSize, true);
  return { type: PACKET_TYPE_START, seq: 0, total, payload };
}

function packet(type, seq, payload = new Uint8Array(0)) {
  return { type, seq, total, payload };
}

const physicalPackets = [
  startPacket(),
  startPacket(),
  ...data.map((payload, index) => packet(PACKET_TYPE_DATA, index + 1, payload)),
  packet(PACKET_TYPE_PARITY, data.length + 1, parity),
  packet(PACKET_TYPE_END, total - 1),
];

for (let lostIndex = 0; lostIndex < physicalPackets.length; lostIndex++) {
  const assembler = new ImageAssembler();
  physicalPackets.forEach((current, index) => {
    if (index !== lostIndex) {
      assembler.accept(current);
    }
  });
  const result = assembler.finalize();
  assert.deepEqual(result.image, image);
}

const withoutParity = new ImageAssembler();
withoutParity.accept(startPacket());
data.forEach((payload, index) => {
  withoutParity.accept(packet(PACKET_TYPE_DATA, index + 1, payload));
});
withoutParity.accept(packet(PACKET_TYPE_END, total - 1));
assert.deepEqual(withoutParity.finalize().image, image);

const missingTwo = new ImageAssembler();
missingTwo.accept(startPacket());
missingTwo.accept(packet(PACKET_TYPE_DATA, 1, data[0]));
missingTwo.accept(packet(PACKET_TYPE_PARITY, data.length + 1, parity));
assert.throws(() => missingTwo.finalize(), /2 DATA packet\(s\) missing/);

console.log("PASS: image assembler tolerates loss of any single protocol packet");
