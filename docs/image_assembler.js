import { crc16CcittFalse } from "./crc16.js";
import {
  FORMAT_JPEG,
  PACKET_TYPE_DATA,
  PACKET_TYPE_END,
  PACKET_TYPE_PARITY,
  PACKET_TYPE_START,
  PAYLOAD_MAX,
  parseStartPayload,
} from "./packet.js";

export class ImageAssembler {
  constructor() {
    this.reset();
  }

  reset() {
    this.meta = null;
    this.total = 0;
    this.dataPacketCount = 0;
    this.dataPackets = new Map();
    this.parity = null;
    this.endReceived = false;
  }

  accept(packet) {
    if (packet.type === PACKET_TYPE_START) {
      this.acceptStart(packet);
      return;
    }
    if (!this.meta) {
      throw new Error("Image packet before START");
    }
    if (packet.total !== this.total) {
      throw new Error(`TOTAL mismatch: expected ${this.total}, got ${packet.total}`);
    }

    switch (packet.type) {
      case PACKET_TYPE_DATA:
        this.acceptData(packet);
        break;
      case PACKET_TYPE_PARITY:
        this.acceptParity(packet);
        break;
      case PACKET_TYPE_END:
        this.acceptEnd(packet);
        break;
      default:
        throw new Error(`Unexpected image packet TYPE 0x${packet.type.toString(16)}`);
    }
  }

  acceptStart(packet) {
    if (packet.seq !== 0) {
      throw new Error(`START must have SEQ 0, got ${packet.seq}`);
    }
    const meta = parseStartPayload(packet.payload);
    if (meta.format !== FORMAT_JPEG) {
      throw new Error(`Unsupported image format 0x${meta.format.toString(16)}`);
    }
    if (meta.imageSize === 0) {
      throw new Error("Image size must be greater than zero");
    }
    if (meta.dataPayloadSize === 0 || meta.dataPayloadSize > PAYLOAD_MAX) {
      throw new Error(`Invalid DATA payload size ${meta.dataPayloadSize}`);
    }

    const dataPacketCount = Math.ceil(meta.imageSize / meta.dataPayloadSize);
    const expectedTotal = dataPacketCount + 3;
    if (packet.total !== expectedTotal) {
      throw new Error(`TOTAL mismatch: expected ${expectedTotal}, got ${packet.total}`);
    }

    if (this.meta) {
      if (
        packet.total !== this.total ||
        meta.imageId !== this.meta.imageId ||
        meta.imageSize !== this.meta.imageSize ||
        meta.imageCrc16 !== this.meta.imageCrc16 ||
        meta.dataPayloadSize !== this.meta.dataPayloadSize
      ) {
        throw new Error("Conflicting duplicate START packet");
      }
      return;
    }

    this.meta = meta;
    this.total = packet.total;
    this.dataPacketCount = dataPacketCount;
  }

  acceptData(packet) {
    if (packet.seq < 1 || packet.seq > this.dataPacketCount) {
      throw new Error(`DATA SEQ ${packet.seq} is out of range`);
    }
    const expectedLength = this.expectedDataLength(packet.seq);
    if (packet.payload.length !== expectedLength) {
      throw new Error(
        `DATA SEQ ${packet.seq} length mismatch: expected ${expectedLength}, got ${packet.payload.length}`
      );
    }

    const existing = this.dataPackets.get(packet.seq);
    if (existing) {
      if (!equalBytes(existing, packet.payload)) {
        throw new Error(`Conflicting duplicate DATA packet SEQ ${packet.seq}`);
      }
      return;
    }
    this.dataPackets.set(packet.seq, packet.payload.slice());
  }

  acceptParity(packet) {
    const expectedSeq = this.dataPacketCount + 1;
    if (packet.seq !== expectedSeq) {
      throw new Error(`PARITY SEQ mismatch: expected ${expectedSeq}, got ${packet.seq}`);
    }
    if (packet.payload.length !== this.meta.dataPayloadSize) {
      throw new Error(
        `PARITY length mismatch: expected ${this.meta.dataPayloadSize}, got ${packet.payload.length}`
      );
    }
    if (this.parity && !equalBytes(this.parity, packet.payload)) {
      throw new Error("Conflicting duplicate PARITY packet");
    }
    this.parity = packet.payload.slice();
  }

  acceptEnd(packet) {
    if (packet.seq !== this.total - 1 || packet.payload.length !== 0) {
      throw new Error(`Invalid END packet SEQ ${packet.seq}`);
    }
    this.endReceived = true;
  }

  receivedBytes() {
    let total = 0;
    for (const payload of this.dataPackets.values()) {
      total += payload.length;
    }
    return total;
  }

  finalize() {
    if (!this.meta) {
      throw new Error("START packet was not received");
    }

    const missing = [];
    for (let seq = 1; seq <= this.dataPacketCount; seq++) {
      if (!this.dataPackets.has(seq)) {
        missing.push(seq);
      }
    }
    if (missing.length > 1 || (missing.length === 1 && !this.parity)) {
      throw new Error(
        `Cannot recover image: ${missing.length} DATA packet(s) missing`
      );
    }

    if (missing.length === 1) {
      const recovered = this.parity.slice();
      for (const payload of this.dataPackets.values()) {
        for (let i = 0; i < payload.length; i++) {
          recovered[i] ^= payload[i];
        }
      }
      const missingSeq = missing[0];
      this.dataPackets.set(
        missingSeq,
        recovered.slice(0, this.expectedDataLength(missingSeq))
      );
    }

    const image = new Uint8Array(this.meta.imageSize);
    let offset = 0;
    for (let seq = 1; seq <= this.dataPacketCount; seq++) {
      const payload = this.dataPackets.get(seq);
      image.set(payload, offset);
      offset += payload.length;
    }

    const computedCrc = crc16CcittFalse(image);
    if (computedCrc !== this.meta.imageCrc16) {
      throw new Error(
        `Image CRC mismatch: expected 0x${hex16(this.meta.imageCrc16)}, got 0x${hex16(computedCrc)}`
      );
    }
    return { image, meta: this.meta, recoveredSeq: missing[0] ?? null, computedCrc };
  }

  expectedDataLength(seq) {
    if (seq < this.dataPacketCount) {
      return this.meta.dataPayloadSize;
    }
    return this.meta.imageSize - (this.dataPacketCount - 1) * this.meta.dataPayloadSize;
  }
}

function equalBytes(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function hex16(value) {
  return value.toString(16).padStart(4, "0");
}
