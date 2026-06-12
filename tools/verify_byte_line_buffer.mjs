import assert from "node:assert/strict";
import { ByteLineBuffer } from "../docs/byte_line_buffer.js";

const prefix = new TextEncoder().encode("IMG_BEGIN\n");
const binary = new Uint8Array([
  0x48, 0x50, 0x01, 0x00, 0x00, 0x03, 0x00, 0x09, 0x00, 0xff, 0x80, 0x00,
]);
const combined = new Uint8Array(prefix.length + binary.length);
combined.set(prefix);
combined.set(binary, prefix.length);

const receiver = new ByteLineBuffer();
receiver.push(combined.subarray(0, 5));
assert.equal(receiver.shiftLine(), null);
receiver.push(combined.subarray(5));

assert.equal(new TextDecoder().decode(receiver.shiftLine()), "IMG_BEGIN");
assert.deepEqual(receiver.takeRemaining(), binary);
assert.equal(receiver.takeRemaining().length, 0);

console.log("PASS: binary bytes after IMG_BEGIN are preserved exactly");
