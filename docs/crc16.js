/**
 * CRC-16/CCITT-FALSE
 * Polynomial: 0x1021, Init: 0xFFFF, RefIn/RefOut: false, XorOut: 0x0000
 */

/**
 * @param {Uint8Array} data
 * @returns {number} CRC-16 value (0..65535)
 */
export function crc16CcittFalse(data) {
  let crc = 0xffff;

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc;
}

/**
 * Self-test with standard vector "123456789" -> 0x29B1
 * @returns {boolean}
 */
export function verifyCrc16SelfTest() {
  const input = new TextEncoder().encode("123456789");
  const result = crc16CcittFalse(input);
  return result === 0x29b1;
}
