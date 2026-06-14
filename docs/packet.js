import { crc16CcittFalse } from "./crc16.js";

export const PACKET_MAGIC_0 = 0x48; // 'H'
export const PACKET_MAGIC_1 = 0x50; // 'P'
export const HEADER_SIZE = 11;
export const PAYLOAD_MAX = 512;

export const PACKET_TYPE_START = 0x01;
export const PACKET_TYPE_DATA = 0x02;
export const PACKET_TYPE_END = 0x03;
export const PACKET_TYPE_ERROR = 0x04;
export const PACKET_TYPE_PARITY = 0x05;

export const FORMAT_JPEG = 0x01;

export const ERROR_MESSAGES = {
  0x01: "image not available",
  0x02: "camera capture failed",
  0x03: "image size too large",
  0x04: "internal buffer error",
};

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {number}
 */
function readLe16(view, offset) {
  return view.getUint16(offset, true);
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {number}
 */
function readLe32(view, offset) {
  return view.getUint32(offset, true);
}

/**
 * Build CRC input buffer: TYPE + SEQ + TOTAL + LEN + PAYLOAD
 * @param {number} type
 * @param {number} seq
 * @param {number} total
 * @param {number} len
 * @param {Uint8Array} payload
 * @returns {Uint8Array}
 */
export function buildCrcInput(type, seq, total, len, payload) {
  const crcInput = new Uint8Array(1 + 2 + 2 + 2 + len);
  const view = new DataView(crcInput.buffer);
  crcInput[0] = type;
  view.setUint16(1, seq, true);
  view.setUint16(3, total, true);
  view.setUint16(5, len, true);
  if (len > 0) {
    crcInput.set(payload.subarray(0, len), 7);
  }
  return crcInput;
}

/**
 * @param {Uint8Array} headerAndPayload - at least HEADER_SIZE bytes
 * @returns {{ type: number, seq: number, total: number, len: number, crc: number, payload: Uint8Array }}
 */
export function parsePacket(headerAndPayload) {
  const view = new DataView(
    headerAndPayload.buffer,
    headerAndPayload.byteOffset,
    headerAndPayload.byteLength
  );

  if (headerAndPayload[0] !== PACKET_MAGIC_0 || headerAndPayload[1] !== PACKET_MAGIC_1) {
    throw new Error("Invalid MAGIC");
  }

  const type = headerAndPayload[2];
  const seq = readLe16(view, 3);
  const total = readLe16(view, 5);
  const len = readLe16(view, 7);
  const crc = readLe16(view, 9);

  if (len > PAYLOAD_MAX) {
    throw new Error(`LEN ${len} exceeds max ${PAYLOAD_MAX}`);
  }

  if (headerAndPayload.length < HEADER_SIZE + len) {
    throw new Error("Incomplete packet");
  }

  const payload =
    len > 0
      ? headerAndPayload.subarray(HEADER_SIZE, HEADER_SIZE + len)
      : new Uint8Array(0);

  const expectedCrc = crc16CcittFalse(buildCrcInput(type, seq, total, len, payload));
  if (expectedCrc !== crc) {
    throw new Error(
      `CRC mismatch: expected 0x${expectedCrc.toString(16).padStart(4, "0")}, got 0x${crc.toString(16).padStart(4, "0")}`
    );
  }

  return { type, seq, total, len, crc, payload };
}

/**
 * @param {Uint8Array} payload - START packet payload (11 bytes)
 * @returns {{ format: number, imageId: number, imageSize: number, imageCrc16: number, dataPayloadSize: number }}
 */
export function parseStartPayload(payload) {
  if (payload.length < 11) {
    throw new Error("START payload too short");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    format: payload[0],
    imageId: readLe16(view, 1),
    imageSize: readLe32(view, 3),
    imageCrc16: readLe16(view, 7),
    dataPayloadSize: readLe16(view, 9),
  };
}

/**
 * Incremental packet receiver with byte buffer and MAGIC sync.
 */
export class PacketReceiver {
  constructor() {
    /** @type {Uint8Array} */
    this.buffer = new Uint8Array(0);
    /** @type {string[]} */
    this.errors = [];
    this.footerCount = 0;
  }

  reset() {
    this.buffer = new Uint8Array(0);
    this.errors = [];
    this.footerCount = 0;
  }

  drainErrors() {
    const errors = this.errors;
    this.errors = [];
    return errors;
  }

  drainFooterCount() {
    const count = this.footerCount;
    this.footerCount = 0;
    return count;
  }

  /**
   * @param {Uint8Array} chunk
   * @returns {Array<ReturnType<typeof parsePacket>>}
   */
  push(chunk) {
    if (chunk.length === 0) {
      return [];
    }

    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const packets = [];

    while (true) {
      const magicIndex = this.findMagic();
      const footerIndex = this.findFooter();
      if (footerIndex >= 0 && (magicIndex < 0 || footerIndex < magicIndex)) {
        this.buffer = this.buffer.subarray(footerIndex + 9);
        this.footerCount += 1;
        break;
      }

      if (magicIndex < 0) {
        this.buffer = this.trailingMarkerPrefix();
        break;
      }

      if (magicIndex > 0) {
        this.buffer = this.buffer.subarray(magicIndex);
      }

      if (this.buffer.length < HEADER_SIZE) {
        break;
      }

      const len = readLe16(new DataView(this.buffer.buffer, this.buffer.byteOffset), 7);
      if (len > PAYLOAD_MAX) {
        // Skip bad MAGIC sync, advance by 1
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const packetSize = HEADER_SIZE + len;
      if (this.buffer.length < packetSize) {
        break;
      }

      const raw = this.buffer.subarray(0, packetSize);
      try {
        packets.push(parsePacket(raw));
      } catch (err) {
        const seq = readLe16(
          new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
          3
        );
        const message = err instanceof Error ? err.message : String(err);
        this.errors.push(`Discarded packet seq=${seq}: ${message}`);
        // False MAGIC in stream: skip one byte and resync
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      this.buffer = this.buffer.subarray(packetSize);
    }

    return packets;
  }

  /**
   * @returns {number}
   */
  findMagic() {
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === PACKET_MAGIC_0 && this.buffer[i + 1] === PACKET_MAGIC_1) {
        return i;
      }
    }
    return -1;
  }

  findFooter() {
    const marker = [0x0A, 0x49, 0x4D, 0x47, 0x5F, 0x45, 0x4E, 0x44, 0x0A];
    outer:
    for (let i = 0; i <= this.buffer.length - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) {
        if (this.buffer[i + j] !== marker[j]) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  }

  trailingMarkerPrefix() {
    const markers = [
      [PACKET_MAGIC_0, PACKET_MAGIC_1],
      [0x0A, 0x49, 0x4D, 0x47, 0x5F, 0x45, 0x4E, 0x44, 0x0A],
    ];
    let keep = 0;
    for (const marker of markers) {
      const maxLength = Math.min(this.buffer.length, marker.length - 1);
      for (let length = maxLength; length > keep; length--) {
        let matches = true;
        for (let i = 0; i < length; i++) {
          if (this.buffer[this.buffer.length - length + i] !== marker[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          keep = length;
          break;
        }
      }
    }
    return keep > 0
      ? this.buffer.slice(this.buffer.length - keep)
      : new Uint8Array(0);
  }
}
